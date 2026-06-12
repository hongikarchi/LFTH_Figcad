import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import {
  CORE_SCHEMA_VERSION,
  ElementSchema,
  ElemTypeSchema,
  LevelSchema,
  quantize,
  type DocMeta,
  type Element,
  type ElemType,
  type Id,
  type Level,
  type Pt,
  type WallElement,
} from './schema';

export interface DocChange {
  added: Id[];
  updated: Id[];
  removed: Id[];
}

export type DocObserver = (change: DocChange) => void;

/** 이 클라이언트의 로컬 변경 origin — UndoManager trackedOrigins와 일치 */
export const LOCAL_ORIGIN: object = { figcad: 'local' };

/**
 * 문서 스토어 — 앱 코드가 문서를 만지는 유일한 표면 (불변 규칙 2).
 * M2: 내부 = Y.Doc (공개 API는 M1과 동일 — 도구/씬/UI 무수정).
 *
 * Y.Doc 레이아웃:
 *   meta     Y.Map — schemaVersion, projectName, units
 *   levels   Y.Map<Id, Level(JSON)>      — 동시 편집 드묾 → plain 값
 *   types    Y.Map<Id, ElemType(JSON)>
 *   elements Y.Map<Id, Y.Map>            — 필드별 독립 LWW (한 명이 끝점, 다른 명이 높이 → 둘 다 생존)
 *
 * 읽기는 plain 미러(Map)에서 — Yjs observer가 미러를 갱신하고 DocChange를 emit.
 * 로컬/원격 변경이 같은 경로를 타므로 emit 코드 경로가 하나다.
 */
export class DocStore {
  readonly ydoc: Y.Doc;
  private yMeta: Y.Map<unknown>;
  private yLevels: Y.Map<unknown>;
  private yTypes: Y.Map<unknown>;
  private yElements: Y.Map<unknown>;

  // 읽기 미러 (Yjs 이벤트로만 갱신)
  private levels = new Map<Id, Level>();
  private types = new Map<Id, ElemType>();
  private elements = new Map<Id, Element>();
  private observers = new Set<DocObserver>();

  constructor(ydoc?: Y.Doc) {
    this.ydoc = ydoc ?? new Y.Doc();
    this.yMeta = this.ydoc.getMap('meta');
    this.yLevels = this.ydoc.getMap('levels');
    this.yTypes = this.ydoc.getMap('types');
    this.yElements = this.ydoc.getMap('elements');

    // 기존 콘텐츠(프로바이더/캐시에서 온 doc) 미러 초기화
    for (const id of this.yLevels.keys()) this.mirrorLevel(id);
    for (const id of this.yTypes.keys()) this.mirrorType(id);
    for (const id of this.yElements.keys()) this.mirrorElement(id);

    this.yLevels.observe((e) => {
      const change: DocChange = { added: [], updated: [], removed: [] };
      for (const [id, c] of e.changes.keys) {
        if (c.action === 'delete') {
          this.levels.delete(id);
          change.removed.push(id);
        } else {
          this.mirrorLevel(id);
          (c.action === 'add' ? change.added : change.updated).push(id);
        }
      }
      this.emit(change);
    });
    this.yTypes.observe((e) => {
      const change: DocChange = { added: [], updated: [], removed: [] };
      for (const [id, c] of e.changes.keys) {
        if (c.action === 'delete') {
          this.types.delete(id);
          change.removed.push(id);
        } else {
          this.mirrorType(id);
          (c.action === 'add' ? change.added : change.updated).push(id);
        }
      }
      this.emit(change);
    });
    this.yElements.observeDeep((events) => {
      const change: DocChange = { added: [], updated: [], removed: [] };
      const touched = new Set<Id>();
      for (const e of events) {
        if (e.target === this.yElements) {
          for (const [id, c] of e.changes.keys) {
            if (c.action === 'delete') {
              this.elements.delete(id);
              change.removed.push(id);
            } else {
              this.mirrorElement(id);
              (c.action === 'add' ? change.added : change.updated).push(id);
            }
            touched.add(id);
          }
        } else {
          // 중첩 Y.Map(요소 필드) 변경 — path[0] = 요소 id
          const id = e.path[0] as Id;
          if (!touched.has(id)) {
            this.mirrorElement(id);
            change.updated.push(id);
            touched.add(id);
          }
        }
      }
      this.emit(change);
    });
  }

  private mirrorLevel(id: Id): void {
    const parsed = LevelSchema.safeParse(this.yLevels.get(id));
    if (parsed.success) this.levels.set(id, parsed.data);
  }
  private mirrorType(id: Id): void {
    const parsed = ElemTypeSchema.safeParse(this.yTypes.get(id));
    if (parsed.success) this.types.set(id, parsed.data);
  }
  private mirrorElement(id: Id): void {
    const ymap = this.yElements.get(id);
    if (!(ymap instanceof Y.Map)) return;
    const parsed = ElementSchema.safeParse(ymap.toJSON());
    if (parsed.success) this.elements.set(id, parsed.data as Element);
  }

  get meta(): DocMeta {
    return {
      schemaVersion: (this.yMeta.get('schemaVersion') as number) ?? CORE_SCHEMA_VERSION,
      projectName: (this.yMeta.get('projectName') as string) ?? '새 프로젝트',
      units: 'mm',
    };
  }

  private transact(fn: () => void): void {
    this.ydoc.transact(fn, LOCAL_ORIGIN);
  }

  // --- 조회 (미러에서 — O(1)/O(n), Yjs 변환 비용 없음) ---

  getLevel(id: Id): Level | undefined {
    return this.levels.get(id);
  }
  getType(id: Id): ElemType | undefined {
    return this.types.get(id);
  }
  getElement(id: Id): Element | undefined {
    return this.elements.get(id);
  }
  listLevels(): Level[] {
    return [...this.levels.values()].sort((a, b) => a.order - b.order);
  }
  listTypes(kind?: ElemType['kind']): ElemType[] {
    const all = [...this.types.values()];
    return kind ? all.filter((t) => t.kind === kind) : all;
  }
  listElements(): Element[] {
    return [...this.elements.values()];
  }
  /** 벽 끝점 목록 — 스냅 후보 */
  wallEndpoints(levelId: Id, exclude?: Id): Pt[] {
    const pts: Pt[] = [];
    for (const el of this.elements.values()) {
      if (el.kind !== 'wall' || el.levelId !== levelId || el.id === exclude) continue;
      pts.push(el.a, el.b);
    }
    return pts;
  }

  // --- ops (변경은 전부 여기 — transact + LOCAL_ORIGIN) ---

  addLevel(level: Omit<Level, 'id'>, fixedId?: Id): Id {
    const id = fixedId ?? nanoid(12);
    const parsed = LevelSchema.parse({
      ...level,
      id,
      elevation: quantize(level.elevation),
      height: quantize(level.height),
    });
    this.transact(() => this.yLevels.set(id, parsed));
    return id;
  }

  addType(type: Omit<ElemType, 'id'>, fixedId?: Id): Id {
    const id = fixedId ?? nanoid(12);
    const parsed = ElemTypeSchema.parse({
      ...type,
      id,
      ...(type.thickness !== undefined ? { thickness: quantize(type.thickness) } : {}),
    });
    this.transact(() => this.yTypes.set(id, parsed));
    return id;
  }

  createWall(params: {
    levelId: Id;
    typeId: Id;
    a: Pt;
    b: Pt;
    height?: number;
    baseOffset?: number;
  }): Id {
    if (
      quantize(params.a[0]) === quantize(params.b[0]) &&
      quantize(params.a[1]) === quantize(params.b[1])
    ) {
      throw new Error('zero-length wall');
    }
    const id = nanoid(12);
    const wall = ElementSchema.parse({
      id,
      kind: 'wall',
      levelId: params.levelId,
      typeId: params.typeId,
      a: [quantize(params.a[0]), quantize(params.a[1])],
      b: [quantize(params.b[0]), quantize(params.b[1])],
      ...(params.height !== undefined ? { height: quantize(params.height) } : {}),
      ...(params.baseOffset !== undefined ? { baseOffset: quantize(params.baseOffset) } : {}),
    }) as WallElement;
    this.transact(() => {
      const ymap = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(wall)) ymap.set(k, v);
      this.yElements.set(id, ymap);
    });
    return id;
  }

  updateElement(id: Id, patch: Partial<Omit<WallElement, 'id' | 'kind'>>): void {
    const prev = this.elements.get(id);
    if (!prev) return;
    const next = { ...prev, ...patch } as Element;
    if (next.kind === 'wall') {
      next.a = [quantize(next.a[0]), quantize(next.a[1])];
      next.b = [quantize(next.b[0]), quantize(next.b[1])];
      if (next.a[0] === next.b[0] && next.a[1] === next.b[1]) return; // 퇴화 거부
      if (next.height !== undefined) next.height = quantize(next.height);
      if (next.baseOffset !== undefined) next.baseOffset = quantize(next.baseOffset);
    }
    const parsed = ElementSchema.parse(next) as Record<string, unknown>;
    const ymap = this.yElements.get(id);
    if (!(ymap instanceof Y.Map)) return;
    // 변경된 키만 기록 — 필드별 LWW의 핵심 (건드리지 않은 필드는 타인 편집과 병합)
    this.transact(() => {
      for (const k of Object.keys(patch)) {
        const v = parsed[k];
        if (v === undefined) ymap.delete(k);
        else ymap.set(k, v);
      }
    });
  }

  deleteElements(ids: Id[]): void {
    this.transact(() => {
      for (const id of ids) {
        if (this.yElements.has(id)) this.yElements.delete(id);
        // M3: 호스트된 개구부 연쇄 삭제가 여기 추가된다
      }
    });
  }

  /** 사용자별 undo — 이 클라이언트(LOCAL_ORIGIN)의 변경만 되돌린다 (Figma 의미론) */
  createUndoManager(): Y.UndoManager {
    return new Y.UndoManager([this.yElements, this.yLevels, this.yTypes], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 350,
    });
  }

  // --- 구독 ---

  observe(cb: DocObserver): () => void {
    this.observers.add(cb);
    return () => this.observers.delete(cb);
  }

  private emit(change: DocChange): void {
    if (!change.added.length && !change.updated.length && !change.removed.length) return;
    for (const cb of this.observers) cb(change);
  }
}

/**
 * m001: 새 문서 시드 — 기본 레벨 + 빌트인 벽 타입.
 * 고정 id 사용 → 두 클라이언트가 동시에 시드해도 같은 키에 수렴 (중복 생성 불가).
 * 이미 시드된 문서면 기존 id 반환.
 */
export const SEED_IDS = {
  level: 'L-001',
  wall200: 'T-w200',
  wall100: 'T-w100',
} as const;

export function seedDocument(store: DocStore): { levelId: Id; wallTypeIds: Id[] } {
  if (!store.getLevel(SEED_IDS.level)) {
    store.ydoc.transact(() => {
      store.addLevel({ name: '1층', elevation: 0, height: 3000, order: 0 }, SEED_IDS.level);
      store.addType(
        { kind: 'wall', name: '콘크리트벽 200', thickness: 200, color: '#eceae5' },
        SEED_IDS.wall200,
      );
      store.addType(
        { kind: 'wall', name: '칸막이벽 100', thickness: 100, color: '#f5f3ee' },
        SEED_IDS.wall100,
      );
    });
  }
  return { levelId: SEED_IDS.level, wallTypeIds: [SEED_IDS.wall200, SEED_IDS.wall100] };
}
