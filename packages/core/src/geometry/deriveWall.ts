import { buildFaces, type FaceSpec, type MeshData } from './meshBuilder';
import { endCorners } from './joins';
import { resolveOpening, type Pt, type WallDeriveInput } from '../schema';

const MM = 0.001; // 문서 mm → 렌더 월드 m

/** 씬 내 텍스트 라벨 (그리드 버블·텍스트·치수 측정값) — 명령형 스프라이트로 렌더 */
export interface LabelSpec {
  text: string;
  pos: [number, number, number]; // 월드 m
  style?: 'grid' | 'text' | 'dim';
}

export interface DerivedGeometry extends MeshData {
  /** 스냅/치수 앵커 (월드 m): 중심선 양 끝 */
  anchors: { a: [number, number, number]; b: [number, number, number] };
  /** 씬 내 라벨 (그리드/텍스트/치수). 없으면 라벨 없음 */
  labels?: LabelSpec[];
}

/**
 * 벽 2D 풋프린트 폴리곤 (도면 평면 mm, 마이터 코너 포함). deriveWall의 프리즘 바닥과
 * 동일한 코너 계산 — 평면도 절단 윤곽·poché에 재사용. joins 없으면 butt 캡.
 * 순서: aMinus → bMinus → bPlus → aPlus (CCW/CW는 벽 방향 의존, 도면용은 무관).
 */
export function wallFootprint(input: WallDeriveInput): Pt[] {
  const { wall, type, joins } = input;
  const [axMm, ayMm] = wall.a;
  const [bxMm, byMm] = wall.b;
  const lenMm = Math.hypot(bxMm - axMm, byMm - ayMm);
  if (lenMm === 0) return [];
  const dir: [number, number] = [(bxMm - axMm) / lenMm, (byMm - ayMm) / lenMm];
  const negDir: [number, number] = [-dir[0], -dir[1]];
  const ca = endCorners([axMm, ayMm], dir, type.thickness, joins?.a ?? null);
  const cb = endCorners([bxMm, byMm], negDir, type.thickness, joins?.b ?? null);
  // deriveWall: bPlus=cb.minus, bMinus=cb.plus
  return [ca.minus, cb.plus, cb.minus, ca.plus].map(
    ([x, y]) => [Math.round(x), Math.round(y)] as Pt,
  );
}

/**
 * 벽 파생 — 순수 함수. 하이브리드 면 빌더:
 * 마이터 풋프린트 프리즘을 면 단위(상/하/측면2/끝단면2)로 구성하고,
 * 긴 측면 2개에 개구부 구멍 루프를 뚫은 뒤 리빌(개구부 안쪽 면 4개/개구부)을 채운다.
 * CSG 불필요 — 사각 개구부는 earcut 구멍으로 충분 (설계 원칙).
 * MVP 조인트는 butt/L-마이터 — joins.ts 참조.
 */
export function deriveWall(input: WallDeriveInput): DerivedGeometry {
  const { wall, type, level, joins, openings } = input;
  const [axMm, ayMm] = wall.a;
  const [bxMm, byMm] = wall.b;

  const lenMm = Math.hypot(bxMm - axMm, byMm - ayMm);
  const baseY = (level.elevation + (wall.baseOffset ?? 0)) * MM;
  const anchors = {
    a: [axMm * MM, baseY, ayMm * MM] as [number, number, number],
    b: [bxMm * MM, baseY, byMm * MM] as [number, number, number],
  };
  if (lenMm === 0) {
    return { positions: new Float32Array(0), normals: new Float32Array(0), edges: new Float32Array(0), anchors };
  }

  const dir: [number, number] = [(bxMm - axMm) / lenMm, (byMm - ayMm) / lenMm];
  const negDir: [number, number] = [-dir[0], -dir[1]];
  const n: [number, number] = [-dir[1], dir[0]];
  const tw = type.thickness;
  const H = wall.height ?? level.height;

  // 끝 코너 (doc mm). B 끝은 안쪽 방향이 -dir → 로컬 ±가 전역 ∓.
  const ca = endCorners([axMm, ayMm], dir, tw, joins?.a ?? null);
  const cb = endCorners([bxMm, byMm], negDir, tw, joins?.b ?? null);
  const corners = {
    aPlus: ca.plus,
    aMinus: ca.minus,
    bPlus: cb.minus,
    bMinus: cb.plus,
  };

  /** 문서 평면(mm) + 높이(mm) → 월드(m, Y-up) */
  const W = (x: number, y: number, z: number): [number, number, number] => [
    x * MM,
    baseY + z * MM,
    y * MM,
  ];
  /** 중심선 좌표계: s = a로부터 dir 방향 거리, σ = ±두께면, z = 높이 */
  const SW = (s: number, sigma: number, z: number): [number, number, number] =>
    W(axMm + dir[0] * s + n[0] * sigma * (tw / 2), ayMm + dir[1] * s + n[1] * sigma * (tw / 2), z);

  // 측면 두 면의 s-범위 (마이터로 면마다 다름) — 개구부는 양면 교집합 안에만
  const sideRange = (sigma: 1 | -1) => {
    const c0 = sigma === 1 ? corners.aPlus : corners.aMinus;
    const c1 = sigma === 1 ? corners.bPlus : corners.bMinus;
    const s0 = (c0[0] - axMm) * dir[0] + (c0[1] - ayMm) * dir[1];
    const s1 = (c1[0] - axMm) * dir[0] + (c1[1] - ayMm) * dir[1];
    return [Math.min(s0, s1), Math.max(s0, s1)] as const;
  };
  const rangePlus = sideRange(1);
  const rangeMinus = sideRange(-1);
  const usableLo = Math.max(rangePlus[0], rangeMinus[0]) + 10;
  const usableHi = Math.min(rangePlus[1], rangeMinus[1]) - 10;

  // 유효 개구부: 클램프 → 양면 공통 범위로 제한 → 2D 겹침 스킵 (earcut은
  // 겹치는 구멍을 처리 못 함 — Yjs 병합으로 겹침 상태가 문서에 올 수 있어
  // derive가 방어해야 함). 스킵된 개구부는 구멍·리빌 둘 다 생성 안 함.
  interface OpeningRect {
    s0: number;
    s1: number;
    z0: number;
    z1: number;
  }
  const rects: OpeningRect[] = [];
  for (const o of openings ?? []) {
    const r = resolveOpening(o.el, o.type, wall, H);
    if (!r) continue;
    const s0 = Math.max(r.offset - r.width / 2, usableLo);
    const s1 = Math.min(r.offset + r.width / 2, usableHi);
    if (s1 - s0 < 30) continue; // 마이터에 먹힌 개구부 — 통째 스킵 (양면+리빌 일관)
    const rect: OpeningRect = { s0, s1, z0: r.sill, z1: r.sill + r.height };
    const overlaps = rects.some(
      (p) => rect.s0 < p.s1 + 10 && rect.s1 > p.s0 - 10 && rect.z0 < p.z1 && rect.z1 > p.z0,
    );
    if (overlaps) continue; // 겹침 — 뒤에 온 개구부 스킵 (메시 파손 방지)
    rects.push(rect);
  }
  rects.sort((p, q) => p.s0 - q.s0);

  const faces: FaceSpec[] = [];
  const footprint: [number, number][] = [
    corners.aMinus,
    corners.bMinus,
    corners.bPlus,
    corners.aPlus,
  ];

  // 상면 / 하면 — 프로필 (x, -y) 공간 (오른손 좌표계, CCW → +Y)
  const planProfile = { outer: footprint.map(([x, y]) => [x, -y] as [number, number]), holes: [] };
  faces.push({ profile: planProfile, map: (u, v) => W(u, -v, H), edges: true });
  faces.push({ profile: planProfile, map: (u, v) => W(u, -v, 0), flip: true, edges: true });

  // 측면 2개 — (s, z) 공간, 양면 동일한 구멍 사각형 (rects)
  for (const sigma of [1, -1] as const) {
    const [lo, hi] = sigma === 1 ? rangePlus : rangeMinus;
    const holes: [number, number][][] = rects.map((r) => [
      [r.s0, r.z0],
      [r.s1, r.z0],
      [r.s1, r.z1],
      [r.s0, r.z1],
    ]);
    faces.push({
      profile: {
        outer: [
          [lo, 0],
          [hi, 0],
          [hi, H],
          [lo, H],
        ],
        holes,
      },
      // (s,z) CCW의 법선 = perp(dir)=+n 쪽 → σ=-1 면은 반전
      map: (s, z) => SW(s, sigma, z),
      flip: sigma === -1,
      edges: true,
    });
  }

  // 끝단면 2개 (마이터 평면) — 단순 쿼드
  const cap = (pFrom: [number, number], pTo: [number, number], flip: boolean): FaceSpec => {
    const ex = pTo[0] - pFrom[0];
    const ey = pTo[1] - pFrom[1];
    const len = Math.hypot(ex, ey) || 1;
    return {
      profile: {
        outer: [
          [0, 0],
          [len, 0],
          [len, H],
          [0, H],
        ],
        holes: [],
      },
      map: (q, z) => W(pFrom[0] + (ex / len) * q, pFrom[1] + (ey / len) * q, z),
      flip,
    };
  };
  // a끝: ê ∝ +n (aMinus→aPlus) → perp(ê) = -dir = 외향 ✓ / b끝: ê ∝ -n → perp = +dir ✓
  faces.push(cap(corners.aMinus, corners.aPlus, false));
  faces.push(cap(corners.bPlus, corners.bMinus, false));

  // 리빌(개구부 안쪽 면) — 구멍과 동일한 rects 사용 (좌/우 잼 + 실 + 헤드)
  for (const r of rects) {
    const sL = r.s0;
    const sR = r.s1;
    const z0 = r.z0;
    const z1 = r.z1;
    const quad = (
      p: (q: number, t: number) => [number, number, number],
      qLen: number,
      tLen: number,
      flip: boolean,
    ): FaceSpec => ({
      profile: {
        outer: [
          [0, 0],
          [qLen, 0],
          [qLen, tLen],
          [0, tLen],
        ],
        holes: [],
      },
      map: p,
      flip,
    });
    // 좌 잼 (s=sL): (σ: -1→+1, z) — 법선 +dir(개구부 안쪽) 필요
    faces.push(quad((q, t) => SW(sL, -1 + (2 * q) / tw, t + z0), tw, z1 - z0, true));
    // 우 잼 (s=sR): 법선 -dir
    faces.push(quad((q, t) => SW(sR, -1 + (2 * q) / tw, t + z0), tw, z1 - z0, false));
    // 실 (z=z0): 법선 +Y (위)
    faces.push(quad((q, t) => SW(sL + q, -1 + (2 * t) / tw, z0), sR - sL, tw, true));
    // 헤드 (z=z1): 법선 -Y
    faces.push(quad((q, t) => SW(sL + q, -1 + (2 * t) / tw, z1), sR - sL, tw, false));
  }

  return { ...buildFaces(faces), anchors };
}

const roundDir = (j: { dir: [number, number]; thickness: number } | null | undefined) =>
  j ? [Math.round(j.dir[0] * 1e6), Math.round(j.dir[1] * 1e6), j.thickness] : null;

/** 파생 캐시 키 — 자기 파라미터 + 조인(이웃) + 호스트된 개구부의 안정 직렬화 */
export function wallDeriveKey(input: WallDeriveInput): string {
  const { wall, type, level, joins, openings } = input;
  return JSON.stringify([
    wall.a,
    wall.b,
    wall.height ?? null,
    wall.baseOffset ?? null,
    type.thickness,
    type.color,
    level.elevation,
    level.height,
    roundDir(joins?.a),
    roundDir(joins?.b),
    (openings ?? [])
      .map((o) => [
        o.el.id,
        o.el.offset,
        o.el.widthOverride ?? null,
        o.el.heightOverride ?? null,
        o.el.sillOverride ?? null,
        o.type.opening.width,
        o.type.opening.height,
        o.type.opening.sillHeight,
      ])
      .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
  ]);
}
