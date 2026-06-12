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
  type GridLine,
  type Id,
  type Level,
  type OpeningElement,
  type Pt,
  type SlabElement,
  type WallElement,
} from './schema';

/** 선분 교차점 (없으면 null) — 그리드 교차 스냅용 */
export function lineIntersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): [number, number] | null {
  const d1x = a2[0] - a1[0];
  const d1y = a2[1] - a1[1];
  const d2x = b2[0] - b1[0];
  const d2y = b2[1] - b1[1];
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / denom;
  const u = ((b1[0] - a1[0]) * d1y - (b1[1] - a1[1]) * d1x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a1[0] + d1x * t, a1[1] + d1y * t];
}

/** 단순 폴리곤 검증 — 인접하지 않은 변끼리 교차하면 false */
export function isSimplePolygon(pts: Pt[]): boolean {
  if (pts.length < 3) return false;
  const n = pts.length;
  const segs = pts.map((p, i) => [p, pts[(i + 1) % n]!] as const);
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const intersects = (p1: Pt, p2: Pt, p3: Pt, p4: Pt) => {
    const d1 = cross(p3, p4, p1);
    const d2 = cross(p3, p4, p2);
    const d3 = cross(p1, p2, p3);
    const d4 = cross(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // 인접 (랩어라운드)
      if (intersects(segs[i]![0], segs[i]![1], segs[j]![0], segs[j]![1])) return false;
    }
  }
  return true;
}

export interface DocChange {
  added: Id[];
  updated: Id[];
  removed: Id[];
}

export type DocObserver = (change: DocChange) => void;

/** addType 입력 — 유니온 분배 (Omit<유니온>은 공통 키만 남아서 사용 불가) */
export type ElemTypeInput = ElemType extends infer T
  ? T extends { id: string }
    ? Omit<T, 'id'>
    : never
  : never;

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
  /** 벽 끝점 + 그리드 교차점 — 스냅 후보 */
  wallEndpoints(levelId: Id, exclude?: Id): Pt[] {
    const pts: Pt[] = [];
    const grids: GridLine[] = [];
    for (const el of this.elements.values()) {
      if (el.id === exclude) continue;
      if (el.kind === 'wall' && el.levelId === levelId) pts.push(el.a, el.b);
      else if (el.kind === 'grid') grids.push(el);
    }
    // 그리드 교차점도 스냅 후보 (구조 그리드의 존재 이유)
    for (let i = 0; i < grids.length; i++) {
      for (let j = i + 1; j < grids.length; j++) {
        const p = lineIntersect(grids[i]!.a, grids[i]!.b, grids[j]!.a, grids[j]!.b);
        if (p) pts.push([quantize(p[0]), quantize(p[1])]);
      }
    }
    return pts;
  }

  /** 벽에 호스트된 개구부 id 목록 */
  openingsOf(wallId: Id): OpeningElement[] {
    const out: OpeningElement[] = [];
    for (const el of this.elements.values()) {
      if (el.kind === 'opening' && el.hostId === wallId) out.push(el);
    }
    return out;
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

  updateLevel(id: Id, patch: Partial<Omit<Level, 'id'>>): void {
    const prev = this.levels.get(id);
    if (!prev) return;
    const next = LevelSchema.parse({
      ...prev,
      ...patch,
      id,
      ...(patch.elevation !== undefined ? { elevation: quantize(patch.elevation) } : {}),
      ...(patch.height !== undefined ? { height: quantize(patch.height) } : {}),
    });
    this.transact(() => this.yLevels.set(id, next));
  }

  /** 레벨 삭제 — 그 레벨의 요소 전부 연쇄 삭제 (같은 transaction) */
  deleteLevel(id: Id): void {
    if (!this.levels.has(id)) return;
    const victims: Id[] = [];
    for (const el of this.elements.values()) {
      if ('levelId' in el && el.levelId === id) victims.push(el.id);
      if (el.kind === 'opening') {
        const host = this.elements.get(el.hostId);
        if (host && 'levelId' in host && host.levelId === id) victims.push(el.id);
      }
    }
    this.transact(() => {
      for (const v of victims) this.yElements.delete(v);
      this.yLevels.delete(id);
    });
  }

  addType(type: ElemTypeInput, fixedId?: Id): Id {
    const id = fixedId ?? nanoid(12);
    const quantized: Record<string, unknown> = { ...type, id };
    if ('thickness' in type && typeof type.thickness === 'number') {
      quantized['thickness'] = quantize(type.thickness);
    }
    const parsed = ElemTypeSchema.parse(quantized);
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
    this.setElement(id, wall);
    return id;
  }

  createOpening(params: {
    hostId: Id;
    typeId: Id;
    offset: number;
    widthOverride?: number;
    heightOverride?: number;
    sillOverride?: number;
    flip?: boolean;
  }): Id {
    const host = this.elements.get(params.hostId);
    if (host?.kind !== 'wall') throw new Error('host wall not found');
    const id = nanoid(12);
    const opening = ElementSchema.parse({
      id,
      kind: 'opening',
      typeId: params.typeId,
      hostId: params.hostId,
      offset: quantize(params.offset),
      ...(params.widthOverride !== undefined
        ? { widthOverride: quantize(params.widthOverride) }
        : {}),
      ...(params.heightOverride !== undefined
        ? { heightOverride: quantize(params.heightOverride) }
        : {}),
      ...(params.sillOverride !== undefined
        ? { sillOverride: quantize(params.sillOverride) }
        : {}),
      ...(params.flip !== undefined ? { flip: params.flip } : {}),
    }) as OpeningElement;
    this.setElement(id, opening);
    return id;
  }

  createSlab(params: { levelId: Id; typeId: Id; boundary: Pt[]; thicknessOverride?: number }): Id {
    const boundary = params.boundary.map(
      ([x, y]) => [quantize(x), quantize(y)] as Pt,
    );
    if (!isSimplePolygon(boundary)) throw new Error('self-intersecting boundary');
    const id = nanoid(12);
    const slab = ElementSchema.parse({
      id,
      kind: 'slab',
      levelId: params.levelId,
      typeId: params.typeId,
      boundary,
      ...(params.thicknessOverride !== undefined
        ? { thicknessOverride: quantize(params.thicknessOverride) }
        : {}),
    }) as SlabElement;
    this.setElement(id, slab);
    return id;
  }

  createGridLine(params: { a: Pt; b: Pt; label?: string }): Id {
    const a: Pt = [quantize(params.a[0]), quantize(params.a[1])];
    const b: Pt = [quantize(params.b[0]), quantize(params.b[1])];
    if (a[0] === b[0] && a[1] === b[1]) throw new Error('zero-length grid line');
    const id = nanoid(12);
    const grid = ElementSchema.parse({
      id,
      kind: 'grid',
      label: params.label ?? this.nextGridLabel(a, b),
      a,
      b,
    }) as GridLine;
    this.setElement(id, grid);
    return id;
  }

  /** 그리드 자동 라벨 — 세로축(상하 주행)은 숫자, 가로축은 알파벳 (한국 실무 관례) */
  private nextGridLabel(a: Pt, b: Pt): string {
    const vertical = Math.abs(b[1] - a[1]) >= Math.abs(b[0] - a[0]);
    const used = new Set<string>();
    for (const el of this.elements.values()) {
      if (el.kind === 'grid') used.add(el.label);
    }
    if (vertical) {
      for (let i = 1; ; i++) if (!used.has(String(i))) return String(i);
    } else {
      for (let i = 0; ; i++) {
        const label = String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : '');
        if (!used.has(label)) return label;
      }
    }
  }

  updateElement(id: Id, patch: Record<string, unknown>): void {
    const prev = this.elements.get(id);
    if (!prev) return;
    const next = { ...prev, ...patch } as Element;
    // 좌표·치수 양자화 + 퇴화 거부 (kind별)
    if (next.kind === 'wall') {
      next.a = [quantize(next.a[0]), quantize(next.a[1])];
      next.b = [quantize(next.b[0]), quantize(next.b[1])];
      if (next.a[0] === next.b[0] && next.a[1] === next.b[1]) return;
      if (next.height !== undefined) next.height = quantize(next.height);
      if (next.baseOffset !== undefined) next.baseOffset = quantize(next.baseOffset);
    } else if (next.kind === 'opening') {
      next.offset = quantize(next.offset);
      for (const k of ['widthOverride', 'heightOverride', 'sillOverride'] as const) {
        if (next[k] !== undefined) next[k] = quantize(next[k]!);
      }
    } else if (next.kind === 'slab') {
      next.boundary = next.boundary.map(([x, y]) => [quantize(x), quantize(y)] as Pt);
      if (!isSimplePolygon(next.boundary)) return;
      if (next.thicknessOverride !== undefined)
        next.thicknessOverride = quantize(next.thicknessOverride);
    } else if (next.kind === 'grid') {
      next.a = [quantize(next.a[0]), quantize(next.a[1])];
      next.b = [quantize(next.b[0]), quantize(next.b[1])];
      if (next.a[0] === next.b[0] && next.a[1] === next.b[1]) return;
    }
    const parsed = ElementSchema.parse(next) as unknown as Record<string, unknown>;
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
    // 벽 삭제 → 호스트된 개구부 연쇄 삭제 (같은 transaction = 원자적)
    const all = new Set(ids);
    for (const id of ids) {
      const el = this.elements.get(id);
      if (el?.kind === 'wall') {
        for (const o of this.openingsOf(id)) all.add(o.id);
      }
    }
    this.transact(() => {
      for (const id of all) {
        if (this.yElements.has(id)) this.yElements.delete(id);
      }
    });
  }

  private setElement(id: Id, el: Element): void {
    this.transact(() => {
      const ymap = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(el)) ymap.set(k, v);
      this.yElements.set(id, ymap);
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
  door900: 'T-d900',
  window1200: 'T-win12',
  slab150: 'T-s150',
} as const;

export interface SeedRefs {
  levelId: Id;
  wallTypeIds: Id[];
  doorTypeId: Id;
  windowTypeId: Id;
  slabTypeId: Id;
}

export function seedDocument(store: DocStore): SeedRefs {
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
      store.addType(
        {
          kind: 'opening',
          name: '외여닫이문 900',
          color: '#b08d57',
          opening: { kind: 'door', width: 900, height: 2100, sillHeight: 0 },
        },
        SEED_IDS.door900,
      );
      store.addType(
        {
          kind: 'opening',
          name: '창 1200×1200',
          color: '#9cc3d5',
          opening: { kind: 'window', width: 1200, height: 1200, sillHeight: 900 },
        },
        SEED_IDS.window1200,
      );
      store.addType(
        { kind: 'slab', name: '슬라브 150', thickness: 150, color: '#dcdad5' },
        SEED_IDS.slab150,
      );
    });
  } else {
    // 구버전 문서(M2 이전 시드)에 새 타입 보충 — 고정 id라 멱등
    store.ydoc.transact(() => {
      if (!store.getType(SEED_IDS.door900))
        store.addType(
          {
            kind: 'opening',
            name: '외여닫이문 900',
            color: '#b08d57',
            opening: { kind: 'door', width: 900, height: 2100, sillHeight: 0 },
          },
          SEED_IDS.door900,
        );
      if (!store.getType(SEED_IDS.window1200))
        store.addType(
          {
            kind: 'opening',
            name: '창 1200×1200',
            color: '#9cc3d5',
            opening: { kind: 'window', width: 1200, height: 1200, sillHeight: 900 },
          },
          SEED_IDS.window1200,
        );
      if (!store.getType(SEED_IDS.slab150))
        store.addType(
          { kind: 'slab', name: '슬라브 150', thickness: 150, color: '#dcdad5' },
          SEED_IDS.slab150,
        );
    });
  }
  return {
    levelId: SEED_IDS.level,
    wallTypeIds: [SEED_IDS.wall200, SEED_IDS.wall100],
    doorTypeId: SEED_IDS.door900,
    windowTypeId: SEED_IDS.window1200,
    slabTypeId: SEED_IDS.slab150,
  };
}
