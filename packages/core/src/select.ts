import type { DocStore } from './store';
import { resolveOpening } from './schema';
import type { Element, OpeningType, Pt, WallElement } from './schema';

/**
 * 박스 선택 판정 (M8) — Rhino window/crossing 의미론.
 *   Window  (좌→우, 실선): 요소가 박스에 **완전히 포함**돼야 선택.
 *   Crossing(우→좌, 점선): 요소가 박스에 **닿기만 해도** 선택.
 *
 * 좌표는 추상 2D [x,y] (앱이 화면 px로 투영해 넘김 — 원근/평면 모두 정확).
 * core는 THREE 무관 유지. window는 crossing의 부분집합이 아니므로 별도 함수.
 */

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function rectFromPoints(a: Pt, b: Pt): Rect {
  return {
    minX: Math.min(a[0], b[0]),
    minY: Math.min(a[1], b[1]),
    maxX: Math.max(a[0], b[0]),
    maxY: Math.max(a[1], b[1]),
  };
}

export const pointInRect = (p: Pt, r: Rect): boolean =>
  p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minY && p[1] <= r.maxY;

/** 짝수 교차 ray-casting — 단순 폴리곤 내부 판정 */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersect =
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] || 1e-9) + a[0];
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 두 선분 교차 (끝점 접촉 포함) */
function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const cross = (o: Pt, p: Pt, q: Pt) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true;
  const onSeg = (o: Pt, p: Pt, q: Pt) =>
    Math.min(o[0], q[0]) <= p[0] &&
    p[0] <= Math.max(o[0], q[0]) &&
    Math.min(o[1], q[1]) <= p[1] &&
    p[1] <= Math.max(o[1], q[1]);
  if (d1 === 0 && onSeg(c, a, d)) return true;
  if (d2 === 0 && onSeg(c, b, d)) return true;
  if (d3 === 0 && onSeg(a, c, b)) return true;
  if (d4 === 0 && onSeg(a, d, b)) return true;
  return false;
}

const rectCorners = (r: Rect): Pt[] => [
  [r.minX, r.minY],
  [r.maxX, r.minY],
  [r.maxX, r.maxY],
  [r.minX, r.maxY],
];

/** 선분이 사각형과 교차하거나 안에 있나 (crossing 판정) */
export function segmentIntersectsRect(a: Pt, b: Pt, r: Rect): boolean {
  if (pointInRect(a, r) || pointInRect(b, r)) return true;
  const c = rectCorners(r);
  for (let i = 0; i < 4; i++) {
    if (segmentsIntersect(a, b, c[i]!, c[(i + 1) % 4]!)) return true;
  }
  return false;
}

/** 폴리곤이 사각형과 겹치나 (변 교차 / 폴리곤이 박스 포함 / 박스가 폴리곤 안) */
export function polygonIntersectsRect(poly: Pt[], r: Rect): boolean {
  for (const p of poly) if (pointInRect(p, r)) return true;
  // 박스 모서리가 폴리곤 안 (박스가 폴리곤에 완전히 잠긴 경우)
  if (pointInPolygon([r.minX, r.minY], poly)) return true;
  // 변 교차
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if (segmentIntersectsRect(a, b, r)) return true;
  }
  return false;
}

/**
 * 요소의 2D 풋프린트 — 박스 판정용 점/세그먼트/폴리곤.
 * 벽·그리드=중심선 세그먼트, 슬라브=경계 폴리곤, 개구부=호스트 위 중심점.
 * 좌표는 호출자가 화면 px로 투영한 값(앱) 또는 문서 mm(테스트) — 일관되기만 하면 됨.
 */
export type Footprint =
  | { kind: 'segment'; a: Pt; b: Pt }
  | { kind: 'polygon'; pts: Pt[] }
  | { kind: 'point'; p: Pt }
  | null;

/** 문서 좌표(mm) 기준 풋프린트. 앱이 화면 판정 시엔 각 점을 투영해 사용 */
export function elementFootprint(el: Element, store: DocStore): Footprint {
  if (el.kind === 'wall' || el.kind === 'grid') return { kind: 'segment', a: el.a, b: el.b };
  if (el.kind === 'slab') return { kind: 'polygon', pts: el.boundary };
  if (el.kind === 'opening') {
    const host = store.getElement(el.hostId);
    if (host?.kind !== 'wall') return null;
    const type = store.getType(el.typeId);
    if (type?.kind !== 'opening') return null;
    const level = store.getLevel((host as WallElement).levelId);
    const r = resolveOpening(
      el,
      type as OpeningType,
      host as WallElement,
      (host as WallElement).height ?? level?.height ?? 0,
    );
    const len = Math.hypot(host.b[0] - host.a[0], host.b[1] - host.a[1]) || 1;
    const dir: Pt = [(host.b[0] - host.a[0]) / len, (host.b[1] - host.a[1]) / len];
    const off = r ? r.offset : el.offset;
    return { kind: 'point', p: [Math.round(host.a[0] + dir[0] * off), Math.round(host.a[1] + dir[1] * off)] };
  }
  return null;
}

/** 풋프린트가 사각형에 **완전히 포함**되나 (window 선택) */
export function footprintInRect(fp: Footprint, r: Rect): boolean {
  if (!fp) return false;
  if (fp.kind === 'point') return pointInRect(fp.p, r);
  if (fp.kind === 'segment') return pointInRect(fp.a, r) && pointInRect(fp.b, r);
  return fp.pts.every((p) => pointInRect(p, r));
}

/** 풋프린트가 사각형과 **닿거나 겹치나** (crossing 선택) */
export function footprintCrossesRect(fp: Footprint, r: Rect): boolean {
  if (!fp) return false;
  if (fp.kind === 'point') return pointInRect(fp.p, r);
  if (fp.kind === 'segment') return segmentIntersectsRect(fp.a, fp.b, r);
  return polygonIntersectsRect(fp.pts, r);
}
