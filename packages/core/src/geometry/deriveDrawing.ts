import type { DocStore } from '../store';
import type { ColumnType, DrawingView, Pt, Section, WallType } from '../schema';
import { wallFootprint } from './deriveWall';
import { HATCH_CONCRETE, hatchPolygon, type Seg2D } from './hatch';

/**
 * 도면 생성 — 3D 파라메트릭 모델에서 2D 라인워크 파생 (렌더 무관 순수 함수).
 * 리서치 합의(Revit View Range / ArchiCAD Cut Plane / Vectorworks Section):
 *   절단면에 걸린 요소 = 절단 윤곽(굵은 선 + poché 해치),
 *   절단면 아래 = 투영(가는 선), 위 = 숨김.
 * 좌표 = 도면 평면 mm (평면뷰의 paper space = 문서 평면, x 동쪽·y 북쪽).
 * v1 = 평면뷰 (wall·column 절단/투영 + 해치, slab 투영, grid 축선).
 *   벽 마이터·개구부 기호·단면/입면 = 후속 슬라이스.
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

type Cls = 'cut' | 'below' | 'above';

/** 요소 z-범위(전역 mm) vs 절단면 분류 */
function classify(bottom: number, top: number, cutZ: number): Cls {
  if (cutZ >= bottom && cutZ < top) return 'cut';
  if (top <= cutZ) return 'below';
  return 'above';
}

export function deriveDrawing(view: DrawingView, store: DocStore): Drawing2D {
  // v1: 평면뷰만. section/elevation = 후속 슬라이스(GPU depth-buffer 은선제거 결정 후).
  if (view.type !== 'plan' || !view.levelId) return EMPTY;
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
      const fp = wallFootprint({ wall: el, type: type as WallType, level });
      addPoly(fp, classify(bottom, top, cutZ), true);
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
    // roof = 평면도(floor plan)에 미표시 (지붕 평면은 별도). opening/beam/stair 등 = 후속.
  }
  return res;
}
