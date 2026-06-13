import type { DocStore } from '../store';
import type { ColumnType, DrawingView, Pt, RoofType, Section, SlabType, WallType } from '../schema';
import { wallFootprint } from './deriveWall';
import { HATCH_CONCRETE, hatchPolygon, type Seg2D } from './hatch';

/**
 * 도면 생성 — 3D 파라메트릭 모델에서 2D 라인워크 파생 (렌더 무관 순수 함수).
 * 리서치 합의(Revit View Range / ArchiCAD Cut Plane / Vectorworks Section):
 *   절단면에 걸린 요소 = 절단 윤곽(굵은 선 + poché 해치),
 *   절단면 아래 = 투영(가는 선), 위 = 숨김.
 * 좌표 = 도면 평면 mm.
 *   평면뷰: paper space = 문서 평면 (x 동쪽·y 북쪽).
 *   단면뷰: paper space = (u, z) — u = 절단선 따라 거리, z = 표고(전역).
 * v1 = 평면(절단/투영+해치) + 단면(절단만 — 투영+은선제거는 1c·v1.5).
 *   벽 마이터·개구부 기호·입면(은선제거) = 후속.
 */

/** 2D 폴리라인 (도면 mm). closed = 닫힌 폴리곤 */
export interface Polyline2D {
  pts: Pt[];
  closed: boolean;
}

export interface Drawing2D {
  /** 절단된 요소 윤곽 — 굵은 선 */
  cut: Polyline2D[];
  /** 투영(절단면 아래) — 가는 선 */
  proj: Polyline2D[];
  /** poché 해치 선분 (절단 폴리곤 채움) */
  hatch: Seg2D[];
  /** 그리드 라벨 등 */
  labels: { text: string; pos: Pt }[];
}

const EMPTY: Drawing2D = { cut: [], proj: [], hatch: [], labels: [] };

/** 단면 프로필 → 평면 폴리곤 (축 정렬). 원 = 24각형. */
function sectionPolygon(at: Pt, sec: Section): Pt[] {
  if (sec.shape === 'rect') {
    const hw = sec.width / 2;
    const hd = sec.depth / 2;
    return [
      [at[0] - hw, at[1] - hd],
      [at[0] + hw, at[1] - hd],
      [at[0] + hw, at[1] + hd],
      [at[0] - hw, at[1] + hd],
    ];
  }
  const r = sec.diameter / 2;
  const N = 24;
  const out: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    out.push([at[0] + Math.cos(a) * r, at[1] + Math.sin(a) * r]);
  }
  return out;
}

/** 점이 단순 폴리곤 내부인가 (ray-casting). 로컬 정의 — select.ts 순환 import 회피. */
function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]![0];
    const yi = poly[i]![1];
    const xj = poly[j]![0];
    const yj = poly[j]![1];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 선분 a→b가 폴리곤 변 c→d와 만나는 t(0..1, a→b 파라미터) 또는 null */
function segIntersectT(a: Pt, b: Pt, c: Pt, d: Pt): number | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null; // 평행
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denom;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denom;
  if (u < -1e-9 || u > 1 + 1e-9) return null; // 변 범위 밖
  return t;
}

/**
 * 선분 a→b가 폴리곤 내부인 t-구간들. 변 교차점들로 분할 후 각 구간 중점이
 * 내부인지 판정 (볼록·오목 모두 견고 — even-odd 정점 패리티 버그 없음).
 */
function segmentInsidePolygon(a: Pt, b: Pt, poly: Pt[]): [number, number][] {
  const ts: number[] = [0, 1];
  for (let i = 0; i < poly.length; i++) {
    const t = segIntersectT(a, b, poly[i]!, poly[(i + 1) % poly.length]!);
    if (t !== null && t > 1e-9 && t < 1 - 1e-9) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if (t1 - t0 < 1e-9) continue;
    const tm = (t0 + t1) / 2;
    const mid: Pt = [a[0] + (b[0] - a[0]) * tm, a[1] + (b[1] - a[1]) * tm];
    if (pointInPoly(mid, poly)) out.push([t0, t1]);
  }
  return out;
}

type Cls = 'cut' | 'below' | 'above';

/** 요소 z-범위(전역 mm) vs 절단면 분류 */
function classify(bottom: number, top: number, cutZ: number): Cls {
  if (cutZ >= bottom && cutZ < top) return 'cut';
  if (top <= cutZ) return 'below';
  return 'above';
}

// ===== 평면뷰 =====
function derivePlan(view: DrawingView, store: DocStore): Drawing2D {
  if (!view.levelId) return EMPTY;
  const level = store.getLevel(view.levelId);
  if (!level) return EMPTY;
  const cutZ = level.elevation + (view.cutHeight ?? 1200);
  const res: Drawing2D = { cut: [], proj: [], hatch: [], labels: [] };

  const addPoly = (pts: Pt[], cls: Cls, hatchIt: boolean): void => {
    if (pts.length < 2 || cls === 'above') return;
    const poly: Polyline2D = { pts, closed: true };
    if (cls === 'cut') {
      res.cut.push(poly);
      if (hatchIt) res.hatch.push(...hatchPolygon(pts, HATCH_CONCRETE));
    } else {
      res.proj.push(poly);
    }
  };

  for (const el of store.listElements()) {
    // 그리드 = 전 레벨 공통 축선 + 라벨 (항상 가는 선)
    if (el.kind === 'grid') {
      res.proj.push({ pts: [el.a, el.b], closed: false });
      res.labels.push({ text: el.label, pos: el.b });
      continue;
    }
    if (!('levelId' in el) || el.levelId !== view.levelId) continue;

    if (el.kind === 'wall') {
      const type = store.getType(el.typeId);
      if (type?.kind !== 'wall') continue;
      const bottom = level.elevation + (el.baseOffset ?? 0);
      const top = bottom + (el.height ?? level.height);
      addPoly(wallFootprint({ wall: el, type: type as WallType, level }), classify(bottom, top, cutZ), true);
    } else if (el.kind === 'column') {
      const type = store.getType(el.typeId);
      if (type?.kind !== 'column') continue;
      const bottom = level.elevation + (el.baseOffset ?? 0);
      const top = bottom + (el.height ?? level.height);
      addPoly(sectionPolygon(el.at, (type as ColumnType).section), classify(bottom, top, cutZ), true);
    } else if (el.kind === 'slab') {
      // 바닥 = 절단면 아래 → 투영 윤곽 (두께 절단 교차는 후속)
      res.proj.push({ pts: el.boundary, closed: true });
    }
    // roof = 평면도(floor plan)에 미표시. opening/beam/stair = 후속.
  }
  return res;
}

// ===== 단면뷰 (절단만 — v1) =====
function deriveSection(view: DrawingView, store: DocStore): Drawing2D {
  if (!view.line) return EMPTY;
  const sa = view.line[0];
  const sb = view.line[1];
  const len = Math.hypot(sb[0] - sa[0], sb[1] - sa[1]);
  if (len < 1) return EMPTY;
  const res: Drawing2D = { cut: [], proj: [], hatch: [], labels: [] };

  // (u,z) 직사각형 cut + 해치. u = 절단선 따라 거리, z = 표고.
  const addCut = (intervals: [number, number][], zb: number, zt: number): void => {
    if (zt <= zb) return;
    for (const [t0, t1] of intervals) {
      const u0 = t0 * len;
      const u1 = t1 * len;
      const rect: Pt[] = [
        [u0, zb],
        [u1, zb],
        [u1, zt],
        [u0, zt],
      ];
      res.cut.push({ pts: rect, closed: true });
      res.hatch.push(...hatchPolygon(rect, HATCH_CONCRETE));
    }
  };

  for (const el of store.listElements()) {
    if (el.kind === 'wall') {
      const type = store.getType(el.typeId);
      const level = store.getLevel(el.levelId);
      if (type?.kind !== 'wall' || !level) continue;
      const ints = segmentInsidePolygon(sa, sb, wallFootprint({ wall: el, type: type as WallType, level }));
      if (!ints.length) continue;
      const zb = level.elevation + (el.baseOffset ?? 0);
      addCut(ints, zb, zb + (el.height ?? level.height));
    } else if (el.kind === 'column') {
      const type = store.getType(el.typeId);
      const level = store.getLevel(el.levelId);
      if (type?.kind !== 'column' || !level) continue;
      const ints = segmentInsidePolygon(sa, sb, sectionPolygon(el.at, (type as ColumnType).section));
      if (!ints.length) continue;
      const zb = level.elevation + (el.baseOffset ?? 0);
      addCut(ints, zb, zb + (el.height ?? level.height));
    } else if (el.kind === 'slab') {
      const type = store.getType(el.typeId);
      const level = store.getLevel(el.levelId);
      if (type?.kind !== 'slab' || !level) continue;
      const ints = segmentInsidePolygon(sa, sb, el.boundary);
      if (!ints.length) continue;
      const th = el.thicknessOverride ?? (type as SlabType).thickness;
      addCut(ints, level.elevation - th, level.elevation); // 슬라브 = elevation에서 아래로
    } else if (el.kind === 'roof') {
      const type = store.getType(el.typeId);
      const level = store.getLevel(el.levelId);
      if (type?.kind !== 'roof' || !level) continue;
      const ints = segmentInsidePolygon(sa, sb, el.boundary);
      if (!ints.length) continue;
      const th = el.thicknessOverride ?? (type as RoofType).thickness;
      const base = level.elevation + level.height + (el.baseOffset ?? 0);
      addCut(ints, base, base + th); // 경사 무시 (v1 평지붕 근사)
    }
    // beam/stair/railing = 후속. 입면(elevation)은 1c.
  }
  return res;
}

export function deriveDrawing(view: DrawingView, store: DocStore): Drawing2D {
  if (view.type === 'plan') return derivePlan(view, store);
  if (view.type === 'section') return deriveSection(view, store);
  return EMPTY; // elevation = 1c (정사영 + 은선제거, painter's filled silhouette)
}
