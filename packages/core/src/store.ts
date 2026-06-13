import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import {
  CommentSchema,
  CORE_SCHEMA_VERSION,
  DrawingViewSchema,
  ElementSchema,
  ElemTypeSchema,
  LevelSchema,
  quantize,
  type BeamElement,
  type ColumnElement,
  type CurtainWallElement,
  type DocMeta,
  type Element,
  type ElemType,
  type GridLine,
  type Id,
  type Level,
  type DimBind,
  type DimensionElement,
  type OpeningElement,
  type Pt,
  type RailingElement,
  type RoofElement,
  type SlabElement,
  type Comment,
  type DrawingView,
  type ZoneElement,
  type StairElement,
  type TextElement,
  type WallElement,
} from './schema';
import { resolveDimAnchor } from './select';

/** 좌표쌍 양자화 단축 */
const q2 = (p: readonly [number, number] | [number, number]): Pt => [
  quantize(p[0]),
  quantize(p[1]),
];

/** 단면 치수 양자화 (rect=width/depth, circle=diameter) — 타입 ops 경계에서 */
function quantizeSection(section: Record<string, unknown>): Record<string, unknown> {
  const out = { ...section };
  for (const k of ['width', 'depth', 'diameter']) {
    if (typeof out[k] === 'number') out[k] = quantize(out[k] as number);
  }
  return out;
}

/** 무한 직선 교차점 (평행이면 null) — trim/extend용 */
export function infiniteLineIntersect(
  a1: Pt,
  a2: Pt,
  b1: Pt,
  b2: Pt,
): [number, number] | null {
  const d1x = a2[0] - a1[0];
  const d1y = a2[1] - a1[1];
  const d2x = b2[0] - b1[0];
  const d2y = b2[1] - b1[1];
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / denom;
  return [a1[0] + d1x * t, a1[1] + d1y * t];
}

/** 점을 직선(axisA→axisB)에 대해 반사 */
export function reflectPoint(p: Pt, axisA: Pt, axisB: Pt): [number, number] {
  const dx = axisB[0] - axisA[0];
  const dy = axisB[1] - axisA[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return [p[0], p[1]];
  const t = ((p[0] - axisA[0]) * dx + (p[1] - axisA[1]) * dy) / len2;
  const fx = axisA[0] + dx * t;
  const fy = axisA[1] + dy * t;
  return [2 * fx - p[0], 2 * fy - p[1]];
}

/** 점을 center 기준 angleRad 회전 */
export function rotatePoint(p: Pt, center: Pt, angleRad: number): [number, number] {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const x = p[0] - center[0];
  const y = p[1] - center[1];
  return [center[0] + x * cos - y * sin, center[1] + x * sin + y * cos];
}

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

/** 문서 전체 plain JSON — AI 드라이런·백업·export 공용 */
export interface DocSnapshot {
  meta: DocMeta;
  levels: Level[];
  types: ElemType[];
  elements: Element[];
  /** 협업 코멘트 (v2). v1 스냅샷엔 부재 — 읽을 때 [] 기본 */
  comments?: Comment[];
  /** 도면 뷰 (v3). 구버전 스냅샷엔 부재 — 읽을 때 [] 기본 */
  views?: DrawingView[];
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
  private yComments: Y.Map<unknown>;
  private yViews: Y.Map<unknown>;

  // 읽기 미러 (Yjs 이벤트로만 갱신)
  private levels = new Map<Id, Level>();
  private types = new Map<Id, ElemType>();
  private elements = new Map<Id, Element>();
  private comments = new Map<Id, Comment>();
  private views = new Map<Id, DrawingView>();
  private observers = new Set<DocObserver>();

  constructor(ydoc?: Y.Doc) {
    this.ydoc = ydoc ?? new Y.Doc();
    this.yMeta = this.ydoc.getMap('meta');
    this.yLevels = this.ydoc.getMap('levels');
    this.yTypes = this.ydoc.getMap('types');
    this.yElements = this.ydoc.getMap('elements');
    this.yComments = this.ydoc.getMap('comments');
    this.yViews = this.ydoc.getMap('views');

    // 기존 콘텐츠(프로바이더/캐시에서 온 doc) 미러 초기화
    for (const id of this.yLevels.keys()) this.mirrorLevel(id);
    for (const id of this.yTypes.keys()) this.mirrorType(id);
    for (const id of this.yElements.keys()) this.mirrorElement(id);
    for (const id of this.yComments.keys()) this.mirrorComment(id);
    for (const id of this.yViews.keys()) this.mirrorView(id);

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
    // 코멘트 = 평면 JSON 엔트리(요소 아님). 변경 시 빈 DocChange로 emit해
    // 웹이 패널·핀을 재동기화하게 한다 (요소 diff엔 안 섞임).
    this.yComments.observe((e) => {
      for (const [id, c] of e.changes.keys) {
        if (c.action === 'delete') this.comments.delete(id);
        else this.mirrorComment(id);
      }
      this.notifyAll(); // 코멘트 변경 → 옵저버 강제 통지 (emit은 빈 change를 무시함)
    });
    // 도면 뷰 = 평면 JSON 엔트리(요소 아님). 변경 시 빈 통지로 도면 패널 재파생.
    this.yViews.observe((e) => {
      for (const [id, c] of e.changes.keys) {
        if (c.action === 'delete') this.views.delete(id);
        else this.mirrorView(id);
      }
      this.notifyAll();
    });
  }

  private mirrorComment(id: Id): void {
    const parsed = CommentSchema.safeParse(this.yComments.get(id));
    if (parsed.success) this.comments.set(id, parsed.data);
  }

  private mirrorView(id: Id): void {
    const parsed = DrawingViewSchema.safeParse(this.yViews.get(id));
    if (parsed.success) this.views.set(id, parsed.data);
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
    if ('section' in type && type.section && typeof type.section === 'object') {
      quantized['section'] = quantizeSection(type.section as Record<string, unknown>);
    }
    const parsed = ElemTypeSchema.parse(quantized);
    this.transact(() => this.yTypes.set(id, parsed));
    return id;
  }

  /** 타입 수정 — kind/id 변경 불가, 수치 양자화. 참조 인스턴스는 자동 반영(파생이 타입을 읽음) */
  updateType(id: Id, patch: Record<string, unknown>): void {
    const prev = this.types.get(id);
    if (!prev) return;
    const next: Record<string, unknown> = { ...prev, ...patch, id, kind: prev.kind };
    if (typeof next['thickness'] === 'number') next['thickness'] = quantize(next['thickness']);
    if (next['section'] && typeof next['section'] === 'object')
      next['section'] = quantizeSection(next['section'] as Record<string, unknown>);
    if (prev.kind === 'opening' && typeof next['opening'] === 'object' && next['opening']) {
      const o = next['opening'] as Record<string, unknown>;
      for (const k of ['width', 'height', 'sillHeight']) {
        if (typeof o[k] === 'number') o[k] = quantize(o[k] as number);
      }
      next['opening'] = { ...(prev as { opening: object }).opening, ...o };
    }
    const parsed = ElemTypeSchema.parse(next);
    this.transact(() => this.yTypes.set(id, parsed));
  }

  /** 타입 삭제 — 참조하는 요소가 있으면 거부(false). 고아 참조 방지 */
  deleteType(id: Id): boolean {
    if (!this.types.has(id)) return false;
    for (const el of this.elements.values()) {
      if ('typeId' in el && el.typeId === id) return false;
    }
    this.transact(() => this.yTypes.delete(id));
    return true;
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

  createColumn(params: {
    levelId: Id;
    typeId: Id;
    at: Pt;
    height?: number;
    baseOffset?: number;
  }): Id {
    const id = nanoid(12);
    const column = ElementSchema.parse({
      id,
      kind: 'column',
      levelId: params.levelId,
      typeId: params.typeId,
      at: [quantize(params.at[0]), quantize(params.at[1])],
      ...(params.height !== undefined ? { height: quantize(params.height) } : {}),
      ...(params.baseOffset !== undefined ? { baseOffset: quantize(params.baseOffset) } : {}),
    }) as ColumnElement;
    this.setElement(id, column);
    return id;
  }

  createBeam(params: { levelId: Id; typeId: Id; a: Pt; b: Pt; zOffset?: number }): Id {
    if (
      quantize(params.a[0]) === quantize(params.b[0]) &&
      quantize(params.a[1]) === quantize(params.b[1])
    ) {
      throw new Error('zero-length beam');
    }
    const id = nanoid(12);
    const beam = ElementSchema.parse({
      id,
      kind: 'beam',
      levelId: params.levelId,
      typeId: params.typeId,
      a: [quantize(params.a[0]), quantize(params.a[1])],
      b: [quantize(params.b[0]), quantize(params.b[1])],
      ...(params.zOffset !== undefined ? { zOffset: quantize(params.zOffset) } : {}),
    }) as BeamElement;
    this.setElement(id, beam);
    return id;
  }

  createCurtainWall(params: {
    levelId: Id;
    typeId: Id;
    a: Pt;
    b: Pt;
    uSpacing: number;
    vSpacing: number;
    height?: number;
    baseOffset?: number;
  }): Id {
    if (quantize(params.a[0]) === quantize(params.b[0]) && quantize(params.a[1]) === quantize(params.b[1])) {
      throw new Error('zero-length curtainwall');
    }
    const id = nanoid(12);
    const cw = ElementSchema.parse({
      id,
      kind: 'curtainwall',
      levelId: params.levelId,
      typeId: params.typeId,
      a: [quantize(params.a[0]), quantize(params.a[1])],
      b: [quantize(params.b[0]), quantize(params.b[1])],
      uSpacing: Math.max(quantize(params.uSpacing), 100),
      vSpacing: Math.max(quantize(params.vSpacing), 100),
      ...(params.height !== undefined ? { height: quantize(params.height) } : {}),
      ...(params.baseOffset !== undefined ? { baseOffset: quantize(params.baseOffset) } : {}),
    }) as CurtainWallElement;
    this.setElement(id, cw);
    return id;
  }

  createStair(params: { levelId: Id; typeId: Id; a: Pt; b: Pt; baseOffset?: number }): Id {
    if (
      quantize(params.a[0]) === quantize(params.b[0]) &&
      quantize(params.a[1]) === quantize(params.b[1])
    ) {
      throw new Error('zero-length stair');
    }
    const id = nanoid(12);
    const stair = ElementSchema.parse({
      id,
      kind: 'stair',
      levelId: params.levelId,
      typeId: params.typeId,
      a: [quantize(params.a[0]), quantize(params.a[1])],
      b: [quantize(params.b[0]), quantize(params.b[1])],
      ...(params.baseOffset !== undefined ? { baseOffset: quantize(params.baseOffset) } : {}),
    }) as StairElement;
    this.setElement(id, stair);
    return id;
  }

  createRailing(params: { levelId: Id; typeId: Id; a: Pt; b: Pt; baseOffset?: number }): Id {
    if (
      quantize(params.a[0]) === quantize(params.b[0]) &&
      quantize(params.a[1]) === quantize(params.b[1])
    ) {
      throw new Error('zero-length railing');
    }
    const id = nanoid(12);
    const railing = ElementSchema.parse({
      id,
      kind: 'railing',
      levelId: params.levelId,
      typeId: params.typeId,
      a: [quantize(params.a[0]), quantize(params.a[1])],
      b: [quantize(params.b[0]), quantize(params.b[1])],
      ...(params.baseOffset !== undefined ? { baseOffset: quantize(params.baseOffset) } : {}),
    }) as RailingElement;
    this.setElement(id, railing);
    return id;
  }

  createRoof(params: {
    levelId: Id;
    typeId: Id;
    boundary: Pt[];
    baseOffset?: number;
    thicknessOverride?: number;
    slope?: { dir: Pt; pitch: number };
  }): Id {
    const boundary = params.boundary.map(([x, y]) => [quantize(x), quantize(y)] as Pt);
    if (!isSimplePolygon(boundary)) throw new Error('self-intersecting roof boundary');
    const id = nanoid(12);
    const roof = ElementSchema.parse({
      id,
      kind: 'roof',
      levelId: params.levelId,
      typeId: params.typeId,
      boundary,
      ...(params.baseOffset !== undefined ? { baseOffset: quantize(params.baseOffset) } : {}),
      ...(params.thicknessOverride !== undefined
        ? { thicknessOverride: quantize(params.thicknessOverride) }
        : {}),
      ...(params.slope !== undefined
        ? {
            slope: {
              dir: [quantize(params.slope.dir[0]), quantize(params.slope.dir[1])] as Pt,
              pitch: quantize(params.slope.pitch),
            },
          }
        : {}),
    }) as RoofElement;
    this.setElement(id, roof);
    return id;
  }

  createZone(params: { levelId: Id; boundary: Pt[]; name: string; number?: string; height?: number }): Id {
    const boundary = params.boundary.map(([x, y]) => [quantize(x), quantize(y)] as Pt);
    if (!isSimplePolygon(boundary)) throw new Error('self-intersecting zone boundary');
    const id = nanoid(12);
    const zone = ElementSchema.parse({
      id,
      kind: 'zone',
      levelId: params.levelId,
      boundary,
      name: params.name,
      ...(params.number !== undefined ? { number: params.number } : {}),
      ...(params.height !== undefined ? { height: quantize(params.height) } : {}),
    }) as ZoneElement;
    this.setElement(id, zone);
    return id;
  }

  createText(params: { levelId: Id; at: Pt; text: string; size?: number }): Id {
    const id = nanoid(12);
    const el = ElementSchema.parse({
      id,
      kind: 'text',
      levelId: params.levelId,
      at: [quantize(params.at[0]), quantize(params.at[1])],
      text: params.text,
      ...(params.size !== undefined ? { size: quantize(params.size) } : {}),
    }) as TextElement;
    this.setElement(id, el);
    return id;
  }

  createDimension(params: {
    levelId: Id;
    a: Pt;
    b: Pt;
    offset?: number;
    bindA?: DimBind;
    bindB?: DimBind;
  }): Id {
    const a: Pt = [quantize(params.a[0]), quantize(params.a[1])];
    const b: Pt = [quantize(params.b[0]), quantize(params.b[1])];
    if (a[0] === b[0] && a[1] === b[1]) throw new Error('zero-length dimension');
    const id = nanoid(12);
    // 바인딩 미지정 시 끝점과 mm-정확 일치하는 요소를 찾아 자동 캡처 (이동 추종)
    const bindA = params.bindA ?? this.bindFor(a, params.levelId);
    const bindB = params.bindB ?? this.bindFor(b, params.levelId);
    const el = ElementSchema.parse({
      id,
      kind: 'dimension',
      levelId: params.levelId,
      a,
      b,
      ...(params.offset !== undefined ? { offset: quantize(params.offset) } : {}),
      ...(bindA ? { bindA } : {}),
      ...(bindB ? { bindB } : {}),
    }) as DimensionElement;
    this.setElement(id, el);
    return id;
  }

  /** 점과 mm-정확 일치하는 요소 끝점 찾기 (치수 바인딩 캡처) — 마이터 조인의 정확일치 철학 */
  private bindFor(p: Pt, levelId: Id): DimBind | undefined {
    for (const el of this.elements.values()) {
      if (el.kind === 'dimension' || el.kind === 'text' || el.kind === 'opening') continue;
      // 그리드는 levelId 없음(전층) → 'levelId' in el 이 false라 자연히 통과
      if ('levelId' in el && el.levelId !== levelId) continue;
      if ('a' in el && 'b' in el) {
        if (el.a[0] === p[0] && el.a[1] === p[1]) return { id: el.id, anchor: 'a' };
        if (el.b[0] === p[0] && el.b[1] === p[1]) return { id: el.id, anchor: 'b' };
      } else if (el.kind === 'column') {
        if (el.at[0] === p[0] && el.at[1] === p[1]) return { id: el.id, anchor: 'a' };
      }
    }
    return undefined;
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
    } else if (next.kind === 'column') {
      next.at = [quantize(next.at[0]), quantize(next.at[1])];
      if (next.height !== undefined) next.height = quantize(next.height);
      if (next.baseOffset !== undefined) next.baseOffset = quantize(next.baseOffset);
    } else if (next.kind === 'beam') {
      next.a = [quantize(next.a[0]), quantize(next.a[1])];
      next.b = [quantize(next.b[0]), quantize(next.b[1])];
      if (next.a[0] === next.b[0] && next.a[1] === next.b[1]) return;
      if (next.zOffset !== undefined) next.zOffset = quantize(next.zOffset);
    } else if (next.kind === 'curtainwall') {
      next.a = [quantize(next.a[0]), quantize(next.a[1])];
      next.b = [quantize(next.b[0]), quantize(next.b[1])];
      if (next.a[0] === next.b[0] && next.a[1] === next.b[1]) return;
      next.uSpacing = Math.max(quantize(next.uSpacing), 100);
      next.vSpacing = Math.max(quantize(next.vSpacing), 100);
      if (next.height !== undefined) next.height = quantize(next.height);
      if (next.baseOffset !== undefined) next.baseOffset = quantize(next.baseOffset);
    } else if (next.kind === 'stair' || next.kind === 'railing') {
      next.a = [quantize(next.a[0]), quantize(next.a[1])];
      next.b = [quantize(next.b[0]), quantize(next.b[1])];
      if (next.a[0] === next.b[0] && next.a[1] === next.b[1]) return;
      if (next.baseOffset !== undefined) next.baseOffset = quantize(next.baseOffset);
    } else if (next.kind === 'roof') {
      next.boundary = next.boundary.map(([x, y]) => [quantize(x), quantize(y)] as Pt);
      if (!isSimplePolygon(next.boundary)) return;
      if (next.baseOffset !== undefined) next.baseOffset = quantize(next.baseOffset);
      if (next.thicknessOverride !== undefined)
        next.thicknessOverride = quantize(next.thicknessOverride);
      if (next.slope !== undefined)
        next.slope = {
          dir: [quantize(next.slope.dir[0]), quantize(next.slope.dir[1])] as Pt,
          pitch: quantize(next.slope.pitch),
        };
    } else if (next.kind === 'zone') {
      next.boundary = next.boundary.map(([x, y]) => [quantize(x), quantize(y)] as Pt);
      if (!isSimplePolygon(next.boundary)) return;
      if (next.height !== undefined) next.height = quantize(next.height);
    } else if (next.kind === 'text') {
      next.at = [quantize(next.at[0]), quantize(next.at[1])];
      if (next.size !== undefined) next.size = quantize(next.size);
    } else if (next.kind === 'dimension') {
      next.a = [quantize(next.a[0]), quantize(next.a[1])];
      next.b = [quantize(next.b[0]), quantize(next.b[1])];
      if (next.offset !== undefined) next.offset = quantize(next.offset);
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

  // ===== 협업 코멘트 (M9-B) — 별도 'comments' 채널. 평면 엔트리(루트+답글),
  // 엔트리별 LWW라 동시 답글 무클로버. undo 비추적(지오메트리 undo와 분리). =====

  /** 루트 코멘트 — at(평면 fallback)·levelId 필수. anchorId 지정 시 그 요소 추종(삭제 시 at) */
  addComment(params: {
    levelId: Id;
    at: Pt;
    author: string;
    text: string;
    anchorId?: Id;
    anchorWhich?: 'a' | 'b';
  }): Id {
    const id = nanoid(12);
    const c = CommentSchema.parse({
      id,
      levelId: params.levelId,
      at: [quantize(params.at[0]), quantize(params.at[1])],
      author: params.author,
      text: params.text,
      ts: Date.now(),
      ...(params.anchorId ? { anchorId: params.anchorId } : {}),
      ...(params.anchorWhich ? { anchorWhich: params.anchorWhich } : {}),
    });
    this.transact(() => this.yComments.set(id, c));
    return id;
  }

  /** 답글 — 루트(parentId)에 매단다. at/levelId는 부모 복사(스키마 균일) */
  replyComment(parentId: Id, params: { author: string; text: string }): Id | null {
    const parent = this.comments.get(parentId);
    if (!parent || parent.parentId) return null; // 루트만 답글 대상
    const id = nanoid(12);
    const c = CommentSchema.parse({
      id,
      parentId,
      at: parent.at,
      levelId: parent.levelId,
      author: params.author,
      text: params.text,
      ts: Date.now(),
    });
    this.transact(() => this.yComments.set(id, c));
    return id;
  }

  /** 해결/미해결 토글 (루트만) */
  resolveComment(id: Id, resolved: boolean): void {
    const c = this.comments.get(id);
    if (!c || c.parentId) return;
    this.transact(() => this.yComments.set(id, { ...c, resolved }));
  }

  /** 코멘트 삭제 — 루트면 답글 연쇄 삭제 */
  deleteComment(id: Id): void {
    const replies = [...this.comments.values()].filter((c) => c.parentId === id).map((c) => c.id);
    this.transact(() => {
      this.yComments.delete(id);
      for (const r of replies) this.yComments.delete(r);
    });
  }

  listComments(): Comment[] {
    return [...this.comments.values()];
  }
  getComment(id: Id): Comment | undefined {
    return this.comments.get(id);
  }

  // ===== 도면 뷰 (M11) — 별도 'views' 채널. 2D 라인워크는 deriveDrawing으로 파생,
  // 여기엔 뷰 정의(절단높이·선·범위·축척)만. undo 비추적(코멘트와 동일 — 도면 config). =====

  /** mm 양자화 후 검증 — 모든 view 쓰기 경로 공유 */
  private parseView(input: DrawingView): DrawingView {
    return DrawingViewSchema.parse({
      ...input,
      cutHeight: input.cutHeight != null ? quantize(input.cutHeight) : undefined,
      depth: input.depth != null ? quantize(input.depth) : undefined,
      scale: input.scale != null ? Math.round(input.scale) : undefined,
      line: input.line
        ? [
            [quantize(input.line[0][0]), quantize(input.line[0][1])],
            [quantize(input.line[1][0]), quantize(input.line[1][1])],
          ]
        : undefined,
    });
  }

  createView(params: Omit<DrawingView, 'id'>): Id {
    const id = nanoid(12);
    const v = this.parseView({ ...params, id } as DrawingView);
    this.transact(() => this.yViews.set(id, v));
    return id;
  }

  updateView(id: Id, patch: Partial<Omit<DrawingView, 'id'>>): void {
    const cur = this.views.get(id);
    if (!cur) return;
    const v = this.parseView({ ...cur, ...patch, id });
    this.transact(() => this.yViews.set(id, v));
  }

  deleteView(id: Id): void {
    if (!this.views.has(id)) return;
    this.transact(() => this.yViews.delete(id));
  }

  listViews(): DrawingView[] {
    return [...this.views.values()];
  }
  getView(id: Id): DrawingView | undefined {
    return this.views.get(id);
  }

  // ===== 편집 ops (M3.5) — 전부 단일 transact = undo 1스텝, 협업 원자적 =====

  /** 검증 후 새 id로 요소 기록 (transact 내부에서 호출) — 유니온이라 런타임 zod 검증 */
  private writeNew(el: Record<string, unknown>): Id {
    const id = nanoid(12);
    const parsed = ElementSchema.parse({ ...el, id }) as Element;
    const ymap = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(parsed)) ymap.set(k, v);
    this.yElements.set(id, ymap);
    return id;
  }

  /** 선택 집합 정규화: 벽이 포함되면 그 벽의 개구부도 함께 (중복 제거) */
  private withHostedOpenings(ids: Id[]): Element[] {
    const map = new Map<Id, Element>();
    for (const id of ids) {
      const el = this.elements.get(id);
      if (!el) continue;
      map.set(id, el);
      if (el.kind === 'wall') {
        for (const o of this.openingsOf(id)) map.set(o.id, o);
      }
    }
    return [...map.values()];
  }

  /** 평면 변환을 요소 집합에 적용해 복사 생성. 벽의 개구부는 새 벽으로 재호스트 */
  private transformCopy(
    ids: Id[],
    xform: (p: Pt) => [number, number],
    flipOpenings: boolean,
  ): Id[] {
    const els = this.withHostedOpenings(ids);
    const created: Id[] = [];
    const wallIdMap = new Map<Id, Id>(); // 원본 벽 → 새 벽
    this.transact(() => {
      for (const el of els) {
        if (el.kind === 'wall') {
          const newId = this.writeNew({ ...el, a: q2(xform(el.a)), b: q2(xform(el.b)) });
          wallIdMap.set(el.id, newId);
          created.push(newId);
        } else if (el.kind === 'slab' || el.kind === 'zone') {
          created.push(this.writeNew({ ...el, boundary: el.boundary.map((p) => q2(xform(p))) }));
        } else if (el.kind === 'grid') {
          // 라벨은 자동 재발급 (중복 방지)
          const a = q2(xform(el.a));
          const b = q2(xform(el.b));
          created.push(this.writeNew({ ...el, a, b, label: this.nextGridLabel(a, b) }));
        } else if (el.kind === 'column' || el.kind === 'text') {
          created.push(this.writeNew({ ...el, at: q2(xform(el.at)) }));
        } else if (
          el.kind === 'beam' ||
          el.kind === 'curtainwall' ||
          el.kind === 'stair' ||
          el.kind === 'railing'
        ) {
          created.push(this.writeNew({ ...el, a: q2(xform(el.a)), b: q2(xform(el.b)) }));
        } else if (el.kind === 'dimension') {
          // 복사본은 바인딩 해제 → 변환된 위치의 자유 치수. 단 출처는 stored가 아닌
          // 해석된(렌더에 보이는) 좌표 — 바인딩 요소가 이미 이동했어도 보이는 위치를 복사.
          const ra = resolveDimAnchor(this, el.bindA, el.a);
          const rb = resolveDimAnchor(this, el.bindB, el.b);
          created.push(
            this.writeNew({
              ...el,
              a: q2(xform(ra)),
              b: q2(xform(rb)),
              bindA: undefined,
              bindB: undefined,
            }),
          );
        } else if (el.kind === 'roof') {
          const next: Record<string, unknown> = {
            ...el,
            boundary: el.boundary.map((p) => q2(xform(p))),
          };
          if (el.slope) {
            // 경사 방향은 벡터 — 변환의 선형부만 적용 (xform(v) - xform(0))
            const o = xform([0, 0]);
            const td = xform(el.slope.dir);
            next['slope'] = { dir: q2([td[0] - o[0], td[1] - o[1]]), pitch: el.slope.pitch };
          }
          created.push(this.writeNew(next));
        }
      }
      // 개구부는 벽 매핑 후 처리 — 등거리 변환이라 offset 보존, 반사면 flip 토글
      for (const el of els) {
        if (el.kind !== 'opening') continue;
        const newHost = wallIdMap.get(el.hostId);
        if (!newHost) continue; // 호스트가 복사 대상이 아니면 개구부 단독 복사 안 함
        created.push(
          this.writeNew({
            ...el,
            hostId: newHost,
            ...(flipOpenings ? { flip: !el.flip } : {}),
          }),
        );
      }
    });
    return created;
  }

  /** 제자리 이동 (벽의 개구부는 자동 추종 — hostId+offset 상대 좌표) */
  moveElements(ids: Id[], delta: Pt): void {
    const els = ids.map((id) => this.elements.get(id)).filter((e): e is Element => !!e);
    this.transact(() => {
      for (const el of els) {
        const ymap = this.yElements.get(el.id);
        if (!(ymap instanceof Y.Map)) continue;
        if (
          el.kind === 'wall' ||
          el.kind === 'grid' ||
          el.kind === 'beam' ||
          el.kind === 'curtainwall' ||
          el.kind === 'stair' ||
          el.kind === 'railing' ||
          el.kind === 'dimension'
        ) {
          ymap.set('a', q2([el.a[0] + delta[0], el.a[1] + delta[1]]));
          ymap.set('b', q2([el.b[0] + delta[0], el.b[1] + delta[1]]));
        } else if (el.kind === 'slab' || el.kind === 'roof' || el.kind === 'zone') {
          ymap.set(
            'boundary',
            el.boundary.map((p) => q2([p[0] + delta[0], p[1] + delta[1]])),
          );
        } else if (el.kind === 'column' || el.kind === 'text') {
          ymap.set('at', q2([el.at[0] + delta[0], el.at[1] + delta[1]]));
        }
        // opening 단독 이동은 SelectTool 드래그(offset)로
        // 주의: 바인딩된 치수는 a/b가 fallback일 뿐 — derive가 참조 요소 좌표 사용(이동 무시)
      }
    });
  }

  /** 복사 (delta 간격) — 생성된 id 반환 */
  duplicateElements(ids: Id[], delta: Pt): Id[] {
    return this.transformCopy(ids, (p) => [p[0] + delta[0], p[1] + delta[1]], false);
  }

  /** 배열 복사 — count개, 누적 delta */
  arrayElements(ids: Id[], delta: Pt, count: number): Id[] {
    const created: Id[] = [];
    this.transact(() => {
      for (let i = 1; i <= count; i++) {
        created.push(
          ...this.transformCopy(ids, (p) => [p[0] + delta[0] * i, p[1] + delta[1] * i], false),
        );
      }
    });
    return created;
  }

  /** 대칭 복사 (axisA→axisB 축) — 개구부 flip 토글 */
  mirrorElements(ids: Id[], axisA: Pt, axisB: Pt): Id[] {
    return this.transformCopy(ids, (p) => reflectPoint(p, axisA, axisB), true);
  }

  /** 제자리 회전 (center, 라디안) */
  rotateElements(ids: Id[], center: Pt, angleRad: number): void {
    const els = ids.map((id) => this.elements.get(id)).filter((e): e is Element => !!e);
    this.transact(() => {
      for (const el of els) {
        const ymap = this.yElements.get(el.id);
        if (!(ymap instanceof Y.Map)) continue;
        if (
          el.kind === 'wall' ||
          el.kind === 'grid' ||
          el.kind === 'beam' ||
          el.kind === 'curtainwall' ||
          el.kind === 'stair' ||
          el.kind === 'railing' ||
          el.kind === 'dimension'
        ) {
          ymap.set('a', q2(rotatePoint(el.a, center, angleRad)));
          ymap.set('b', q2(rotatePoint(el.b, center, angleRad)));
        } else if (el.kind === 'slab' || el.kind === 'roof' || el.kind === 'zone') {
          ymap.set(
            'boundary',
            el.boundary.map((p) => q2(rotatePoint(p, center, angleRad))),
          );
          if (el.kind === 'roof' && el.slope) {
            // 경사 방향 벡터도 원점 기준 회전 (위치 평행이동 영향 없음)
            ymap.set('slope', {
              dir: q2(rotatePoint(el.slope.dir, [0, 0], angleRad)),
              pitch: el.slope.pitch,
            });
          }
        } else if (el.kind === 'column' || el.kind === 'text') {
          ymap.set('at', q2(rotatePoint(el.at, center, angleRad)));
        }
      }
    });
  }

  /**
   * 벽 분할 — point의 중심선 투영 지점에서 두 벽으로.
   * 개구부는 중심이 속한 쪽으로 재호스트 (뒤쪽 벽은 offset 재계산).
   * 분할점이 끝에서 100mm 이내면 거부(null).
   */
  splitWall(id: Id, point: Pt): [Id, Id] | null {
    const wall = this.elements.get(id);
    if (wall?.kind !== 'wall') return null;
    const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    if (len < 200) return null;
    const dir = [(wall.b[0] - wall.a[0]) / len, (wall.b[1] - wall.a[1]) / len] as const;
    const s = Math.round(
      (point[0] - wall.a[0]) * dir[0] + (point[1] - wall.a[1]) * dir[1],
    );
    if (s < 100 || s > len - 100) return null;
    const p: Pt = [
      quantize(wall.a[0] + dir[0] * s),
      quantize(wall.a[1] + dir[1] * s),
    ];
    const openings = this.openingsOf(id);
    let id1 = '' as Id;
    let id2 = '' as Id;
    this.transact(() => {
      id1 = this.writeNew({ ...wall, a: wall.a, b: p });
      id2 = this.writeNew({ ...wall, a: p, b: wall.b });
      for (const o of openings) {
        if (o.offset <= s) {
          this.writeNew({ ...o, hostId: id1 });
        } else {
          this.writeNew({ ...o, hostId: id2, offset: o.offset - s });
        }
      }
      for (const o of openings) this.yElements.delete(o.id);
      // 원본 벽 끝점에 바인딩된 치수 재바인딩 — 끝점은 보존되므로 추종 유지
      // (a끝 = id1.a, b끝 = id2.b). 안 하면 원본 id 삭제로 고아화.
      for (const el of this.elements.values()) {
        if (el.kind !== 'dimension') continue;
        const ymap = this.yElements.get(el.id);
        if (!(ymap instanceof Y.Map)) continue;
        if (el.bindA?.id === id)
          ymap.set('bindA', el.bindA.anchor === 'a' ? { id: id1, anchor: 'a' } : { id: id2, anchor: 'b' });
        if (el.bindB?.id === id)
          ymap.set('bindB', el.bindB.anchor === 'a' ? { id: id1, anchor: 'a' } : { id: id2, anchor: 'b' });
      }
      this.yElements.delete(id);
    });
    return [id1, id2];
  }

  /**
   * 연장/자르기 — end 끝을 target 벽의 무한 중심선과의 교차점으로 이동.
   * 평행이면 false. a끝 이동 시 개구부 offset 보정 (offset은 a 기준).
   */
  trimExtendWall(id: Id, end: 'a' | 'b', target: { a: Pt; b: Pt }): boolean {
    const wall = this.elements.get(id);
    if (wall?.kind !== 'wall') return false;
    const hit = infiniteLineIntersect(wall.a, wall.b, target.a, target.b);
    if (!hit) return false;
    const newEnd = q2(hit);
    const other = end === 'a' ? wall.b : wall.a;
    if (Math.hypot(newEnd[0] - other[0], newEnd[1] - other[1]) < 50) return false; // 퇴화
    this.transact(() => {
      const ymap = this.yElements.get(id);
      if (!(ymap instanceof Y.Map)) return;
      if (end === 'a') {
        // offset 기준점(a)이 이동 — 새 a에서 본 거리로 보정
        const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
        if (len > 0) {
          const dir = [(wall.b[0] - wall.a[0]) / len, (wall.b[1] - wall.a[1]) / len] as const;
          const shift =
            (wall.a[0] - newEnd[0]) * dir[0] + (wall.a[1] - newEnd[1]) * dir[1];
          for (const o of this.openingsOf(id)) {
            const oMap = this.yElements.get(o.id);
            if (oMap instanceof Y.Map) oMap.set('offset', quantize(o.offset + shift));
          }
        }
        ymap.set('a', newEnd);
      } else {
        ymap.set('b', newEnd);
      }
    });
    return true;
  }

  // --- 스냅샷 (AI 드라이런 + JSON export/import 공용) ---

  /** 문서 전체를 plain JSON으로 — 파라미터가 전부라 이게 완전한 백업이다 */
  snapshot(): DocSnapshot {
    return {
      meta: this.meta,
      levels: [...this.levels.values()],
      types: [...this.types.values()],
      elements: [...this.elements.values()],
      comments: [...this.comments.values()],
      views: [...this.views.values()],
    };
  }

  /**
   * 외부 Y.Doc을 observer 없이 1회 읽어 스냅샷 생성 — 서버(DO) 커밋처럼
   * 장수명 doc을 반복 읽는 곳용 (DocStore 인스턴스화는 해제 불가 observer를 남김).
   * 스키마 위반 요소는 조용히 제외 — 커밋/백업은 "렌더 가능한 문서"의 보존이다.
   * 주의: snapshot()의 미러는 위반 *덮어쓰기* 시 직전 유효 버전을 유지하지만
   * 여기는 현재 값 기준 제외 — 외부/비호환 클라이언트가 쓴 경우에만 갈라진다
   * (DocStore ops 경로로는 위반 데이터가 생기지 않음).
   */
  static snapshotOf(ydoc: Y.Doc): DocSnapshot {
    const yMeta = ydoc.getMap('meta');
    const levels: Level[] = [];
    for (const v of ydoc.getMap('levels').values()) {
      const p = LevelSchema.safeParse(v);
      if (p.success) levels.push(p.data);
    }
    const types: ElemType[] = [];
    for (const v of ydoc.getMap('types').values()) {
      const p = ElemTypeSchema.safeParse(v);
      if (p.success) types.push(p.data);
    }
    const elements: Element[] = [];
    for (const v of ydoc.getMap('elements').values()) {
      if (!(v instanceof Y.Map)) continue;
      const p = ElementSchema.safeParse(v.toJSON());
      if (p.success) elements.push(p.data as Element);
    }
    const comments: Comment[] = [];
    for (const v of ydoc.getMap('comments').values()) {
      const p = CommentSchema.safeParse(v);
      if (p.success) comments.push(p.data);
    }
    const views: DrawingView[] = [];
    for (const v of ydoc.getMap('views').values()) {
      const p = DrawingViewSchema.safeParse(v);
      if (p.success) views.push(p.data);
    }
    return {
      meta: {
        schemaVersion: (yMeta.get('schemaVersion') as number) ?? CORE_SCHEMA_VERSION,
        projectName: (yMeta.get('projectName') as string) ?? '새 프로젝트',
        units: 'mm',
      },
      levels,
      types,
      elements,
      comments,
      views,
    };
  }

  /** 스냅샷에서 독립 스토어 재구성 — id 보존 (AI 드라이런용 인메모리 사본) */
  static fromSnapshot(snap: DocSnapshot): DocStore {
    const store = new DocStore();
    store.ydoc.transact(() => {
      store.yMeta.set('schemaVersion', snap.meta.schemaVersion);
      store.yMeta.set('projectName', snap.meta.projectName);
      store.yMeta.set('units', snap.meta.units);
      for (const lv of snap.levels) store.yLevels.set(lv.id, LevelSchema.parse(lv));
      for (const t of snap.types) store.yTypes.set(t.id, ElemTypeSchema.parse(t));
      for (const el of snap.elements) {
        const parsed = ElementSchema.parse(el) as unknown as Record<string, unknown>;
        const ymap = new Y.Map<unknown>();
        for (const [k, v] of Object.entries(parsed)) ymap.set(k, v);
        store.yElements.set(el.id, ymap);
      }
      for (const c of snap.comments ?? []) store.yComments.set(c.id, CommentSchema.parse(c));
      for (const v of snap.views ?? []) store.yViews.set(v.id, DrawingViewSchema.parse(v));
    }, LOCAL_ORIGIN);
    return store;
  }

  /**
   * 스냅샷으로 문서 내용 전체 교체 — JSON import(백업 복원)용.
   * 전체 검증 후 단일 transact: 부분 적용 없음, undo 1스텝, 협업 전파.
   */
  importSnapshot(snap: DocSnapshot): void {
    if (
      typeof snap?.meta?.schemaVersion !== 'number' ||
      snap.meta.schemaVersion > CORE_SCHEMA_VERSION
    ) {
      throw new Error(`지원하지 않는 schemaVersion: ${snap?.meta?.schemaVersion}`);
    }
    // 검증을 transact 밖에서 전부 — 중간 실패 시 문서 무변경
    const levels = snap.levels.map((l) => LevelSchema.parse(l));
    const types = snap.types.map((t) => ElemTypeSchema.parse(t));
    const elements = snap.elements.map((e) => ElementSchema.parse(e) as Element);
    // 코멘트는 직교 협업 채널 — 커밋 복원(comments 필드 부재)은 라이브 코멘트를 보존,
    // JSON 백업 복원(comments 명시, [] 포함)만 교체. (커밋 blob엔 코멘트 미포함 — 의도)
    const replaceComments = snap.comments !== undefined;
    const comments = replaceComments ? snap.comments!.map((c) => CommentSchema.parse(c)) : [];
    // 도면 뷰도 직교 채널 — 커밋 복원(views 부재)은 보존, JSON 백업(views 명시)만 교체
    const replaceViews = snap.views !== undefined;
    const views = replaceViews ? snap.views!.map((v) => DrawingViewSchema.parse(v)) : [];
    this.transact(() => {
      for (const k of [...this.yElements.keys()]) this.yElements.delete(k);
      for (const k of [...this.yLevels.keys()]) this.yLevels.delete(k);
      for (const k of [...this.yTypes.keys()]) this.yTypes.delete(k);
      this.yMeta.set('schemaVersion', snap.meta.schemaVersion);
      this.yMeta.set('projectName', snap.meta.projectName);
      this.yMeta.set('units', snap.meta.units);
      for (const lv of levels) this.yLevels.set(lv.id, lv);
      for (const t of types) this.yTypes.set(t.id, t);
      for (const el of elements) {
        const ymap = new Y.Map<unknown>();
        for (const [k, v] of Object.entries(el)) ymap.set(k, v);
        this.yElements.set(el.id, ymap);
      }
      if (replaceComments) {
        for (const k of [...this.yComments.keys()]) this.yComments.delete(k);
        for (const c of comments) this.yComments.set(c.id, c);
      }
      if (replaceViews) {
        for (const k of [...this.yViews.keys()]) this.yViews.delete(k);
        for (const v of views) this.yViews.set(v.id, v);
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

  /** 빈-change 가드를 우회한 강제 통지 (코멘트 등 요소-아닌 변경용) */
  private notifyAll(): void {
    const empty: DocChange = { added: [], updated: [], removed: [] };
    for (const cb of this.observers) cb(empty);
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
  column400: 'T-c400',
  beam300: 'T-b300',
  stair: 'T-st1',
  railing: 'T-rl1',
  roof: 'T-rf1',
  curtainwall: 'T-cw1',
} as const;

export interface SeedRefs {
  levelId: Id;
  wallTypeIds: Id[];
  doorTypeId: Id;
  windowTypeId: Id;
  slabTypeId: Id;
  columnTypeId: Id;
  beamTypeId: Id;
  stairTypeId: Id;
  railingTypeId: Id;
  roofTypeId: Id;
  curtainWallTypeId: Id;
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
      store.addType(
        {
          kind: 'column',
          name: 'RC 기둥 400×400',
          section: { shape: 'rect', width: 400, depth: 400 },
          color: '#d8d4cc',
        },
        SEED_IDS.column400,
      );
      store.addType(
        {
          kind: 'beam',
          name: 'RC 보 300×600',
          section: { shape: 'rect', width: 300, depth: 600 },
          color: '#cfc9bf',
        },
        SEED_IDS.beam300,
      );
      store.addType(
        { kind: 'stair', name: '직선계단 1000', width: 1000, riser: 175, color: '#c9c4ba' },
        SEED_IDS.stair,
      );
      store.addType(
        { kind: 'railing', name: '난간 1100', height: 1100, postSpacing: 1200, color: '#bdb8ae' },
        SEED_IDS.railing,
      );
      store.addType(
        { kind: 'roof', name: '지붕 슬라브 200', thickness: 200, color: '#c4bfb4' },
        SEED_IDS.roof,
      );
      store.addType(
        {
          kind: 'curtainwall',
          name: '커튼월 50×100',
          mullionSection: { shape: 'rect', width: 50, depth: 100 },
          color: '#8fa8b8',
        },
        SEED_IDS.curtainwall,
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
      if (!store.getType(SEED_IDS.column400))
        store.addType(
          {
            kind: 'column',
            name: 'RC 기둥 400×400',
            section: { shape: 'rect', width: 400, depth: 400 },
            color: '#d8d4cc',
          },
          SEED_IDS.column400,
        );
      if (!store.getType(SEED_IDS.beam300))
        store.addType(
          {
            kind: 'beam',
            name: 'RC 보 300×600',
            section: { shape: 'rect', width: 300, depth: 600 },
            color: '#cfc9bf',
          },
          SEED_IDS.beam300,
        );
      if (!store.getType(SEED_IDS.stair))
        store.addType(
          { kind: 'stair', name: '직선계단 1000', width: 1000, riser: 175, color: '#c9c4ba' },
          SEED_IDS.stair,
        );
      if (!store.getType(SEED_IDS.railing))
        store.addType(
          { kind: 'railing', name: '난간 1100', height: 1100, postSpacing: 1200, color: '#bdb8ae' },
          SEED_IDS.railing,
        );
      if (!store.getType(SEED_IDS.roof))
        store.addType(
          { kind: 'roof', name: '지붕 슬라브 200', thickness: 200, color: '#c4bfb4' },
          SEED_IDS.roof,
        );
      if (!store.getType(SEED_IDS.curtainwall))
        store.addType(
          {
            kind: 'curtainwall',
            name: '커튼월 50×100',
            mullionSection: { shape: 'rect', width: 50, depth: 100 },
            color: '#8fa8b8',
          },
          SEED_IDS.curtainwall,
        );
    });
  }
  return {
    levelId: SEED_IDS.level,
    wallTypeIds: [SEED_IDS.wall200, SEED_IDS.wall100],
    doorTypeId: SEED_IDS.door900,
    windowTypeId: SEED_IDS.window1200,
    slabTypeId: SEED_IDS.slab150,
    columnTypeId: SEED_IDS.column400,
    beamTypeId: SEED_IDS.beam300,
    stairTypeId: SEED_IDS.stair,
    railingTypeId: SEED_IDS.railing,
    roofTypeId: SEED_IDS.roof,
    curtainWallTypeId: SEED_IDS.curtainwall,
  };
}
