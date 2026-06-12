import type { Pt } from '../schema';

/**
 * 벽 조인 (Revit/ArchiCAD 자동 결합 정책의 경량판):
 *   끝점을 공유하는 벽이 정확히 1개 → L자 마이터 (오프셋 엣지를 교차점까지 연장/트림)
 *   3개 이상 / 평행 / 마이터 길이 폭주(예각) → butt 폴백
 * 좌표는 doc mm. 끝점 공유는 정수 일치 (끝점 스냅이 보장).
 */

export interface JoinInfo {
  /** 코너에서 이웃 벽 안쪽으로 향하는 단위 방향 */
  dir: [number, number];
  thickness: number;
}

const PARALLEL_EPS = 1e-9;
/** 마이터 길이 한계 — 초과(예각)면 butt (Revit도 비슷하게 거동) */
const MITER_LIMIT_FACTOR = 4;

interface Corners {
  /** +n 사이드 코너 (n = perp(dInto)) */
  plus: Pt;
  /** -n 사이드 코너 */
  minus: Pt;
}

/**
 * 벽 한쪽 끝의 풋프린트 코너 2개.
 * @param p 코너(공유 끝점), @param dInto 이 벽 안쪽 단위 방향, @param tw 이 벽 두께
 * @param join 이웃 정보 (없으면 butt 사각 캡)
 */
export function endCorners(
  p: [number, number],
  dInto: [number, number],
  tw: number,
  join: JoinInfo | null,
): Corners {
  const n: [number, number] = [-dInto[1], dInto[0]];
  const butt = (s: 1 | -1): Pt => [p[0] + n[0] * s * (tw / 2), p[1] + n[1] * s * (tw / 2)];

  if (!join) return { plus: butt(1), minus: butt(-1) };

  const e = join.dir;
  const m: [number, number] = [-e[1], e[0]];
  const cross = dInto[0] * e[1] - dInto[1] * e[0];
  if (Math.abs(cross) < PARALLEL_EPS) return { plus: butt(1), minus: butt(-1) }; // 평행/일직선

  const maxMiter = MITER_LIMIT_FACTOR * Math.max(tw, join.thickness);

  const corner = (s: 1 | -1): Pt => {
    // 이 벽의 s 사이드 엣지: Pw + a*dInto, Pw = p + n*s*tw/2
    // 짝이 되는 이웃 엣지: σ = -s (폴리라인 오프셋 사이드 일치 — R→P→Q 좌/우)
    const sigma = -s;
    const pw: [number, number] = [p[0] + n[0] * s * (tw / 2), p[1] + n[1] * s * (tw / 2)];
    const pv: [number, number] = [
      p[0] + m[0] * sigma * (join.thickness / 2),
      p[1] + m[1] * sigma * (join.thickness / 2),
    ];
    // pw + a*d = pv + b*e 풀기
    const rx = pv[0] - pw[0];
    const ry = pv[1] - pw[1];
    const denom = dInto[0] * e[1] - dInto[1] * e[0];
    const a = (rx * e[1] - ry * e[0]) / denom;
    const x: Pt = [pw[0] + dInto[0] * a, pw[1] + dInto[1] * a];
    const dist = Math.hypot(x[0] - p[0], x[1] - p[1]);
    if (dist > maxMiter) return butt(s); // 예각 폭주 → butt
    return x;
  };

  return { plus: corner(1), minus: corner(-1) };
}
