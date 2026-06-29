import type { Pt } from '../schema';

/**
 * 해치(poché) — 절단 폴리곤을 평행선으로 채운다. DXF/PAT/Revit/ArchiCAD 공통의
 * 라인 기반 패턴(각도+간격). 도면 단계의 절단면 표현용 (렌더 무관 순수 함수).
 * 좌표는 도면 평면 mm (paper space = 평면뷰에선 문서 평면과 동일).
 */
export interface HatchPattern {
  /** 평행선 각도 (도) */
  angle: number;
  /** 평행선 간격 (mm) */
  spacing: number;
}

export type Seg2D = [Pt, Pt];

/** 시드 패턴 — 절단 콘크리트(45° 대각선). 추후 단열/벽돌 등 추가. */
export const HATCH_CONCRETE: HatchPattern = { angle: 45, spacing: 150 };

/**
 * 폴리곤 내부를 평행선으로 채운 선분 목록. even-odd 교차 규칙:
 * 각 스캔선이 폴리곤 경계와 만나는 점들을 선 방향으로 정렬해 쌍으로 묶으면
 * 내부 구간이 된다(볼록·오목·구멍 없는 단순 폴리곤 가정).
 */
export function hatchPolygon(boundary: Pt[], pattern: HatchPattern): Seg2D[] {
  if (boundary.length < 3) return [];
  const rad = (pattern.angle * Math.PI) / 180;
  const d: Pt = [Math.cos(rad), Math.sin(rad)]; // 선 방향
  const nrm: Pt = [-Math.sin(rad), Math.cos(rad)]; // 선 직교 (스캔 축)
  const sp = Math.max(pattern.spacing, 1);

  // 경계점을 스캔 축에 투영 → [tMin, tMax]
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const p of boundary) {
    const t = p[0] * nrm[0] + p[1] * nrm[1];
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  // tMax도 유한 검사 — 비유한 경계점 하나면 tMax=Infinity가 가드를 통과해 `t < tMax` 무한 루프(review-3 [32]).
  if (!isFinite(tMin) || !isFinite(tMax) || tMax - tMin < sp) return [];

  const out: Seg2D[] = [];
  let start = Math.ceil(tMin / sp) * sp;
  if (start <= tMin) start += sp; // 경계(tMin)에 정확히 놓인 스캔선 제외 — 절단 윤곽 위 중복선 방지
  for (let t = start; t < tMax; t += sp) {
    // 스캔선 = { p : dot(p,nrm) = t }. 각 경계 변과의 교차 파라미터(선 방향 u)를 수집.
    const us: number[] = [];
    for (let i = 0; i < boundary.length; i++) {
      const a = boundary[i]!;
      const b = boundary[(i + 1) % boundary.length]!;
      const ta = a[0] * nrm[0] + a[1] * nrm[1];
      const tb = b[0] * nrm[0] + b[1] * nrm[1];
      // 스캔값 t가 변의 [min, max) 반개구간에 드나 — 진행 방향 무관하게 항상 t-최대
      // 끝점을 제외해야 극값 정점에서 인접 두 변이 정확히 상쇄(짝수 교차)한다.
      // (반대로 진행순 끝점 s>=1을 빼면 하강 변에서 관습이 뒤집혀 오목 폴리곤 오채움.)
      // ta===tb(수평 변)는 lo===hi → t>=hi로 자동 스킵.
      const lo = Math.min(ta, tb);
      const hi = Math.max(ta, tb);
      if (t < lo || t >= hi) continue;
      const s = (t - ta) / (tb - ta);
      const x = a[0] + (b[0] - a[0]) * s;
      const y = a[1] + (b[1] - a[1]) * s;
      us.push(x * d[0] + y * d[1]);
    }
    us.sort((p, q) => p - q);
    // 쌍으로 묶어 내부 구간 (짝수 개 가정 — 단순 폴리곤)
    for (let k = 0; k + 1 < us.length; k += 2) {
      const u0 = us[k]!;
      const u1 = us[k + 1]!;
      // u(선 방향) + t(직교)로 점 복원: p = u*d + t*nrm
      const p0: Pt = [u0 * d[0] + t * nrm[0], u0 * d[1] + t * nrm[1]];
      const p1: Pt = [u1 * d[0] + t * nrm[0], u1 * d[1] + t * nrm[1]];
      out.push([p0, p1]);
    }
  }
  return out;
}
