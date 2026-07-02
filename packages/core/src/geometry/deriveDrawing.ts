import type { DocStore } from '../store';
import type { ColumnType, DrawingView, Pt, RoofType, Section, SlabType, WallType } from '../schema';
import { wallFootprint } from './deriveWall';
import { sectionRing } from './deriveStructure';
import { polygonArea, polygonCentroid } from './deriveZone';
import { labelText } from './deriveLabel';
import { labelTargetCenter, resolveDimAnchor } from '../select';
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
  /**
   * 입면 실루엣 — **far→near 정렬**된 닫힌 폴리곤. 렌더가 순서대로 흰색 채움+stroke하면
   * 가까운 게 먼 윤곽을 덮어 은선제거(painter's). derive는 정렬만 담당, occlusion은 픽셀에서.
   */
  silhouettes?: Polyline2D[];
}

const EMPTY: Drawing2D = { cut: [], proj: [], hatch: [], labels: [] };

/** 단면 프로필 → 평면 폴리곤 (축 정렬) — sectionRing 위임 (rect 코너순서·원 24각형 시작각 동일 검증됨). */
function sectionPolygon(at: Pt, sec: Section): Pt[] {
  return sectionRing(sec).map(([sx, sy]) => [at[0] + sx, at[1] + sy] as Pt);
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

/**
 * 질량 요소의 평면 풋프린트 + z-범위(전역 mm) — 단면·입면 공유. z 규약은 실제
 * derive 수학과 일치(deriveWall/deriveStructure/deriveOthers): 누락 = 조용한 z 오류.
 */
function massFootprint(
  el: { kind: string; [k: string]: unknown },
  store: DocStore,
): { poly: Pt[]; zb: number; zt: number } | null {
  if (el.kind === 'wall') {
    const w = el as unknown as import('../schema').WallElement;
    const type = store.getType(w.typeId);
    const level = store.getLevel(w.levelId);
    if (type?.kind !== 'wall' || !level) return null;
    const zb = level.elevation + (w.baseOffset ?? 0);
    return { poly: wallFootprint({ wall: w, type: type as WallType, level }), zb, zt: zb + (w.height ?? level.height) };
  }
  if (el.kind === 'column') {
    const c = el as unknown as import('../schema').ColumnElement;
    const type = store.getType(c.typeId);
    const level = store.getLevel(c.levelId);
    if (type?.kind !== 'column' || !level) return null;
    const zb = level.elevation + (c.baseOffset ?? 0);
    return { poly: sectionPolygon(c.at, (type as ColumnType).section), zb, zt: zb + (c.height ?? level.height) };
  }
  if (el.kind === 'slab') {
    const s = el as unknown as import('../schema').SlabElement;
    const type = store.getType(s.typeId);
    const level = store.getLevel(s.levelId);
    if (type?.kind !== 'slab' || !level) return null;
    const th = s.thicknessOverride ?? (type as SlabType).thickness;
    const top = level.elevation + (s.zOffset ?? 0);
    return { poly: s.boundary, zb: top - th, zt: top }; // elevation+zOffset에서 아래로
  }
  if (el.kind === 'roof') {
    const r = el as unknown as import('../schema').RoofElement;
    const type = store.getType(r.typeId);
    const level = store.getLevel(r.levelId);
    if (type?.kind !== 'roof' || !level) return null;
    const th = r.thicknessOverride ?? (type as RoofType).thickness;
    const base = level.elevation + level.height + (r.baseOffset ?? 0);
    return { poly: r.boundary, zb: base, zt: base + th }; // 경사 무시 (v1 평지붕 근사)
  }
  return null;
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
    } else if (el.kind === 'curtainwall') {
      // 커튼월 = 베이스라인 (절단면 범위 내면 절단선, 아니면 투영)
      const bottom = level.elevation + (el.baseOffset ?? 0);
      const top = bottom + (el.height ?? level.height);
      const cls = classify(bottom, top, cutZ);
      if (cls !== 'above') (cls === 'cut' ? res.cut : res.proj).push({ pts: [el.a, el.b], closed: false });
    } else if (el.kind === 'slab') {
      // 바닥 = 절단면 아래 → 투영 윤곽 (두께 절단 교차는 후속)
      res.proj.push({ pts: el.boundary, closed: true });
    } else if (el.kind === 'zone') {
      // 존 = 경계 윤곽(가는 선) + 중심 스탬프(이름·면적)
      res.proj.push({ pts: el.boundary, closed: true });
      const c = polygonCentroid(el.boundary);
      res.labels.push({ text: el.number ? `${el.number} ${el.name}` : el.name, pos: c });
      res.labels.push({ text: `${(polygonArea(el.boundary) / 1e6).toFixed(1)}㎡`, pos: [c[0], c[1] - 400] });
    } else if (el.kind === 'label') {
      // 레이블 = 텍스트(공유 labelText — 3D와 동일) + leader 지시선(가는 선)
      const target = el.targetId ? (store.getElement(el.targetId) ?? null) : null;
      res.labels.push({ text: labelText(el, target, store), pos: el.at });
      if (el.leader && target) {
        const tc = labelTargetCenter(store, target);
        if (tc) res.proj.push({ pts: [el.at, tc], closed: false });
      }
    } else if (el.kind === 'dimension') {
      // 치수 = 측정선(바인딩 해석 좌표) + 중점 치수 텍스트 — 안 그리면 도면 export서 조용히 사라짐(review-3 [3]).
      const a = resolveDimAnchor(store, el.bindA, el.a);
      const b = resolveDimAnchor(store, el.bindB, el.b);
      res.proj.push({ pts: [a, b], closed: false });
      res.labels.push({ text: `${Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]))}`, pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
    } else if (el.kind === 'text') {
      res.labels.push({ text: el.text, pos: el.at });
    } else if (el.kind === 'sketch' && !el.frame) {
      // 마크업 스케치(레벨 바닥, frame 없음)만 평면도에 — 자유 3D 평면 스케치는 평면도 대상 아님.
      res.proj.push({ pts: el.boundary, closed: el.mode === 'zone' });
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

  // 전 층 순회 (레벨 필터 없음 — 단면은 건물 전체 절단). beam/stair/railing = 후속.
  for (const el of store.listElements()) {
    const m = massFootprint(el as { kind: string; [k: string]: unknown }, store);
    if (!m) continue;
    const ints = segmentInsidePolygon(sa, sb, m.poly);
    if (ints.length) addCut(ints, m.zb, m.zt);
  }
  return res;
}

// ===== 입면뷰 (정사영 + painter's 은선제거 — v1 박스 매싱) =====
function deriveElevation(view: DrawingView, store: DocStore): Drawing2D {
  if (!view.line) return EMPTY;
  const sa = view.line[0];
  const sb = view.line[1];
  const len = Math.hypot(sb[0] - sa[0], sb[1] - sa[1]);
  if (len < 1) return EMPTY;
  const ux = (sb[0] - sa[0]) / len;
  const uy = (sb[1] - sa[1]) / len; // baseline 방향
  const nx = -uy;
  const ny = ux; // 시선 깊이 축 (baseline 수직). 관찰자=+n 쪽에서 -n 바라봄 → +n=가까움
  const toU = (p: Pt): number => (p[0] - sa[0]) * ux + (p[1] - sa[1]) * uy;
  const toN = (p: Pt): number => (p[0] - sa[0]) * nx + (p[1] - sa[1]) * ny;

  // 전 층 순회 (레벨 필터 없음 — 입면은 건물 전체). 각 질량을 (u,z) 실루엣 사각형으로 투영.
  const items: { rect: Pt[]; depth: number }[] = [];
  for (const el of store.listElements()) {
    const m = massFootprint(el as { kind: string; [k: string]: unknown }, store);
    if (!m || m.poly.length < 2 || m.zt <= m.zb) continue;
    let umin = Infinity;
    let umax = -Infinity;
    let nSum = 0;
    for (const p of m.poly) {
      const u = toU(p);
      if (u < umin) umin = u;
      if (u > umax) umax = u;
      nSum += toN(p);
    }
    if (umax - umin < 1) continue;
    items.push({
      rect: [
        [umin, m.zb],
        [umax, m.zb],
        [umax, m.zt],
        [umin, m.zt],
      ],
      depth: nSum / m.poly.length,
    });
  }
  // far→near: 관찰자 +n 쪽 → toN 작을수록 멀다. 오름차순 정렬 → 배열 끝=가까움=마지막 그림=덮음.
  items.sort((a, b) => a.depth - b.depth);
  return { cut: [], proj: [], hatch: [], labels: [], silhouettes: items.map((it) => ({ pts: it.rect, closed: true })) };
}

export function deriveDrawing(view: DrawingView, store: DocStore): Drawing2D {
  if (view.type === 'plan') return derivePlan(view, store);
  if (view.type === 'section') return deriveSection(view, store);
  return deriveElevation(view, store);
}
