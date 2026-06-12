import type { Pt } from './schema';

/**
 * 스냅 엔진 — 순수 수학, mm 단위.
 * 우선순위: 끝점 > 축 고정(직교) > 그리드.
 * tolerance는 호출자가 화면 픽셀→mm로 환산해서 넘긴다 (줌 레벨 반영).
 */

export interface SnapResult {
  point: Pt;
  kind: 'endpoint' | 'grid' | 'none';
  /** 축 고정 적용 여부 (체인 기준점 대비 직교) */
  axisLocked: boolean;
}

export interface SnapContext {
  /** 끝점 스냅 후보 */
  endpoints: Pt[];
  /** 끝점 스냅 반경 (mm) */
  endpointTolerance: number;
  /** 그리드 간격 (mm), 0이면 그리드 스냅 끄기 */
  grid: number;
  /** 축 고정 기준점 (벽 체인 시작점) — 없으면 축 고정 안 함 */
  axisFrom?: Pt;
  /** 축 고정 허용 각도 (라디안) */
  axisTolerance?: number;
}

export function snapPoint(raw: Pt, ctx: SnapContext): SnapResult {
  // 1. 끝점 스냅 (최우선 — 벽 연결의 핵심)
  let best: Pt | null = null;
  let bestDist = ctx.endpointTolerance;
  for (const p of ctx.endpoints) {
    const d = Math.hypot(p[0] - raw[0], p[1] - raw[1]);
    if (d <= bestDist) {
      best = p;
      bestDist = d;
    }
  }
  if (best) return { point: [best[0], best[1]], kind: 'endpoint', axisLocked: false };

  let pt: Pt = [raw[0], raw[1]];
  let axisLocked = false;

  // 2. 축 고정 (기준점 대비 X/Y축 ±tolerance 이내면 직교로 클램프)
  if (ctx.axisFrom) {
    const dx = pt[0] - ctx.axisFrom[0];
    const dy = pt[1] - ctx.axisFrom[1];
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const tol = ctx.axisTolerance ?? 0.12; // ~7도
      const angle = Math.atan2(Math.abs(dy), Math.abs(dx));
      if (angle < tol) {
        pt = [pt[0], ctx.axisFrom[1]];
        axisLocked = true;
      } else if (Math.PI / 2 - angle < tol) {
        pt = [ctx.axisFrom[0], pt[1]];
        axisLocked = true;
      }
    }
  }

  // 3. 그리드 스냅
  if (ctx.grid > 0) {
    const gx = Math.round(pt[0] / ctx.grid) * ctx.grid;
    const gy = Math.round(pt[1] / ctx.grid) * ctx.grid;
    // 축 고정된 축은 유지
    const snapped: Pt = axisLocked
      ? pt[1] === ctx.axisFrom![1]
        ? [gx, pt[1]]
        : [pt[0], gy]
      : [gx, gy];
    return { point: snapped, kind: 'grid', axisLocked };
  }

  return { point: [Math.round(pt[0]), Math.round(pt[1])], kind: 'none', axisLocked };
}
