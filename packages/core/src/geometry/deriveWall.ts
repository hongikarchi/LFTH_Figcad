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
  /** 반투명 자식 메시 (커튼월 유리 패널 등) — SceneManager가 별도 메시로 렌더. 메인 메시는 단일 머티리얼 유지 */
  panels?: MeshData;
}

/**
 * 벽 2D 풋프린트 폴리곤 (도면 평면 mm, 마이터 코너 포함). deriveWall의 프리즘 바닥과
 * 동일한 코너 계산 — 평면도 절단 윤곽·poché에 재사용. joins 없으면 butt 캡.
 * 순서: aMinus → bMinus → bPlus → aPlus (CCW/CW는 벽 방향 의존, 도면용은 무관).
 */
export function wallFootprint(input: WallDeriveInput): Pt[] {
  if (input.wall.sagitta) return arcWallFootprint(input);
  return straightWallFootprint(input);
}

function straightWallFootprint(input: WallDeriveInput): Pt[] {
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
  // 직선 벽(sagitta 없음/0) = 기존 코드패스 그대로(바이트 불변 — 회귀 격리). 곡선만 분기.
  if (input.wall.sagitta) return deriveArcWall(input);
  return deriveStraightWall(input);
}

function deriveStraightWall(input: WallDeriveInput): DerivedGeometry {
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

// ───────────────────────────── 곡선(ARC) 중심선 벽 (M13 Track C) ─────────────────────────────
//
// 부호 규약 (단일 소스 — arcPolyline·풋프린트·mirror flip·테스트가 전부 이걸 따른다):
//   dir = (b−a)/|b−a|,  좌측법선 n = (−dir.y, dir.x).
//   +sagitta = 현 a→b의 좌측(n 방향)으로 호가 휜다. 호 정점 P = M + n·s (M=현 중점, s=부호있는 새지타).
//   반사(mirror)는 방향반전 → 휘는 쪽 반전 → sagitta 부호 반전(store.transformCopy 훅). 회전·이동은 보존.
//
// 프레이밍(geometry-study §9.2): 곡선 중심선은 **레시피(파라미터)** → 메시는 순수 파생(불변① 무위반).
// 우리가 곡선을 소유하므로 평면/단면 절단은 정확히 유지(F-rep과 달리 — wallFootprint가 곡선 윤곽 반환).
//
// 결정론(불변①): N은 정수 파라미터에서만 계산(같은 파라미터 → 같은 메시). 끝점 poly[0]=a·poly[N]=b는
// 정확한 정수 좌표로 고정(원에서 재계산하지 않음 — float 드리프트가 끝점 정확일치 조인을 깨지 않게).

const MAX_SEG_RAD = Math.PI / 16; // 세그먼트당 최대 ~11.25° (호 매끄러움 ↔ 삼각형 수 균형)

/**
 * 끝점 a,b를 지나고 새지타 sagitta(부호)인 원호를 N+1점 폴리라인으로 테셀레이션.
 * - 첫/끝 점 = a,b 그대로(정수 정확 — 끝점 조인 키 유지). 내부 점만 원 위에서 회전 계산.
 * - N = clamp(ceil(Θ/MAX_SEG_RAD), 2, 64), Θ=호 스윕각. |s| 작으면 R 거대→Θ→0→N=2(≈현).
 * 순수 함수(불변①): 같은 (a,b,sagitta) → 동일 점 배열.
 */
export function arcPolyline(a: Pt, b: Pt, sagitta: number): Pt[] {
  const s = sagitta;
  const chordX = b[0] - a[0];
  const chordY = b[1] - a[1];
  const chordLen = Math.hypot(chordX, chordY);
  if (chordLen === 0 || s === 0) return [a, b];
  const dir: [number, number] = [chordX / chordLen, chordY / chordLen];
  const n: [number, number] = [-dir[1], dir[0]]; // 좌측법선
  const h = chordLen / 2; // 반현
  const absS = Math.abs(s);
  const R = (h * h + absS * absS) / (2 * absS); // 외접원 반지름
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; // 현 중점
  // 원 중심 O = M + n·(s − sign(s)·R). |s|<R이면 O가 호 반대쪽(소호), |s|>R(>반원)이면 같은 쪽으로 자동.
  const sign = s > 0 ? 1 : -1;
  const O: [number, number] = [
    mid[0] + n[0] * (s - sign * R),
    mid[1] + n[1] * (s - sign * R),
  ];
  const Θ = 2 * Math.atan2(h, R - absS); // 스윕각 — |s|>h면 자동 >π (대호)
  const N = Math.min(Math.max(Math.ceil(Θ / MAX_SEG_RAD), 2), 64);

  // a를 O 기준 시작각으로, b를 끝각으로. 휘는 방향(sign)에 맞춰 회전(부호).
  const a0x = a[0] - O[0];
  const a0y = a[1] - O[1];
  const startAng = Math.atan2(a0y, a0x);
  // 회전 방향: +sagitta(좌측 볼록)면 a→b가 O 기준 시계방향(−Θ), −면 반시계(+Θ). (좌표계 x동/y북, n=좌측)
  const sweep = -sign * Θ;

  const out: Pt[] = [a];
  for (let i = 1; i < N; i++) {
    const ang = startAng + (sweep * i) / N;
    out.push([
      Math.round(O[0] + R * Math.cos(ang)),
      Math.round(O[1] + R * Math.sin(ang)),
    ]);
  }
  out.push(b);
  return out;
}

/** 폴리라인 정점별 마이터 법선(인접 두 세그먼트 법선의 평균, 끝점은 단일 세그먼트 법선). 단위벡터. */
function vertexNormals(poly: Pt[]): [number, number][] {
  const m = poly.length;
  const segN: [number, number][] = []; // 세그먼트 i의 좌측법선
  for (let i = 0; i < m - 1; i++) {
    const dx = poly[i + 1]![0] - poly[i]![0];
    const dy = poly[i + 1]![1] - poly[i]![1];
    const len = Math.hypot(dx, dy) || 1;
    segN.push([-dy / len, dx / len]);
  }
  const vn: [number, number][] = [];
  for (let i = 0; i < m; i++) {
    let nx: number;
    let ny: number;
    if (i === 0) [nx, ny] = segN[0]!;
    else if (i === m - 1) [nx, ny] = segN[m - 2]!;
    else {
      nx = segN[i - 1]![0] + segN[i]![0];
      ny = segN[i - 1]![1] + segN[i]![1];
    }
    let len = Math.hypot(nx, ny);
    if (len < 1e-9) {
      // 인접 세그먼트가 거의 반대 방향(평균 법선 소멸) — 한 세그먼트 법선으로 폴백([0,0] 퇴화 방지).
      [nx, ny] = segN[Math.max(i - 1, 0)]!;
      len = 1;
    }
    vn.push([nx / len, ny / len]);
  }
  return vn;
}

/**
 * 곡선 벽 파생 — 중심선 폴리라인을 따라 ±tw/2 오프셋한 두 레일(outer/inner)로 스윕 프리즘.
 * 상/하면 = 폴리곤(outerRail ++ reverse(innerRail)) earcut. 측면 = 레일 따라 쿼드 스트립(세그먼트당 1쿼드).
 * 끝캡 = 끝 탄젠트(첫/끝 세그먼트 방향) 기준 쿼드. 앵커 a/b는 현 끝점 그대로(직선과 동일).
 *
 * 개구부(opening)는 MSU에서 **보류** — 곡선 피처 벽은 LOD 100–250에서 문/창을 거의 호스트하지 않음.
 * (직선 벽은 변경 없는 경로로 개구부 완전 지원.) C5에서 곡선 개구부 추가 시 이 분기에 구멍 로직.
 *
 * ⚠ 인터롭(C5 보류): 현재 IFC/.3dm/DXF export는 곡선 벽을 **직선 현(chord)** 으로 내보냄 = 곡률 무손실 아님(조용한 손실).
 *   IfcArcIndex / ArcCurve / DXF bulge 라운드트립은 C5에서. 그 전까지는 알려진 갭(interop.md에 기록 예정).
 */
function deriveArcWall(input: WallDeriveInput): DerivedGeometry {
  const { wall, type, level } = input;
  const [axMm, ayMm] = wall.a;
  const [bxMm, byMm] = wall.b;
  const tw = type.thickness;
  const H = wall.height ?? level.height;
  const baseY = (level.elevation + (wall.baseOffset ?? 0)) * MM;
  const anchors = {
    a: [axMm * MM, baseY, ayMm * MM] as [number, number, number],
    b: [bxMm * MM, baseY, byMm * MM] as [number, number, number],
  };
  if (Math.hypot(bxMm - axMm, byMm - ayMm) === 0) {
    return { positions: new Float32Array(0), normals: new Float32Array(0), edges: new Float32Array(0), anchors };
  }

  // 곡률이 두께 대비 너무 타이트해 내측 레일이 중심선을 넘으면(R ≤ tw/2) 자기교차 = 표현 불가한 입력.
  // 우아하게 직선 chord로 폴백(깨진/뒤집힌 메시 방지). 보통 chord<두께인 퇴화 벽뿐(extreme-dimension lint가 별도 경고). 리뷰 반영.
  {
    const hh = Math.hypot(bxMm - axMm, byMm - ayMm) / 2;
    const ss = Math.abs(wall.sagitta!);
    const R = (hh * hh + ss * ss) / (2 * ss);
    if (R <= tw / 2 + 1) return deriveStraightWall(input);
  }

  /** 문서 평면(mm) + 높이(mm) → 월드(m, Y-up) */
  const W = (x: number, y: number, z: number): [number, number, number] => [x * MM, baseY + z * MM, y * MM];

  const poly = arcPolyline(wall.a, wall.b, wall.sagitta!);
  const vn = vertexNormals(poly);
  const half = tw / 2;
  // outer = +법선 레일, inner = −법선 레일 (mm 평면)
  const outer: Pt[] = poly.map((p, i) => [p[0] + vn[i]![0] * half, p[1] + vn[i]![1] * half]);
  const inner: Pt[] = poly.map((p, i) => [p[0] - vn[i]![0] * half, p[1] - vn[i]![1] * half]);

  const faces: FaceSpec[] = [];

  // 상/하면 — 풋프린트 폴리곤(outer 정방향 ++ inner 역방향). 프로필 공간 (x,−y)(오른손계, CCW→+Y).
  const ringMm: Pt[] = [...outer, ...inner.slice().reverse()];
  const planProfile = { outer: ringMm.map(([x, y]) => [x, -y] as [number, number]), holes: [] };
  faces.push({ profile: planProfile, map: (u, v) => W(u, -v, H), edges: true });
  faces.push({ profile: planProfile, map: (u, v) => W(u, -v, 0), flip: true, edges: true });

  // 측면 쿼드 스트립 — 세그먼트당 1쿼드(레일 outer / inner 각각). 프로필 (q,z), q=0..segLen.
  const sideQuad = (p0: Pt, p1: Pt, flip: boolean): FaceSpec => {
    const ex = p1[0] - p0[0];
    const ey = p1[1] - p0[1];
    const len = Math.hypot(ex, ey) || 1;
    return {
      profile: { outer: [[0, 0], [len, 0], [len, H], [0, H]], holes: [] },
      map: (q, z) => W(p0[0] + (ex / len) * q, p0[1] + (ey / len) * q, z),
      flip,
      edges: true,
    };
  };
  for (let i = 0; i < poly.length - 1; i++) {
    // outer 레일: 진행방향 +법선이 좌측 → 외향(솔리드 바깥)이 −dir×... ; flip은 직선 σ=+1 측면과 동일 규약.
    faces.push(sideQuad(outer[i]!, outer[i + 1]!, false));
    faces.push(sideQuad(inner[i]!, inner[i + 1]!, true));
  }

  // 끝캡 2개 — 끝 탄젠트 기준 단면 쿼드(현 방향 아님). a끝 = inner→outer, b끝 = outer→inner(외향 일관).
  faces.push(sideQuad(inner[0]!, outer[0]!, false));
  faces.push(sideQuad(outer[poly.length - 1]!, inner[poly.length - 1]!, false));

  return { ...buildFaces(faces), anchors };
}

/** 곡선 벽 2D 풋프린트(도면 평면 mm) — outer 레일 ++ reverse(inner 레일). deriveDrawing 평면 절단이 곡선으로 자동. */
function arcWallFootprint(input: WallDeriveInput): Pt[] {
  const { wall, type } = input;
  if (Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) === 0) return [];
  return curvedWallFootprint(wall.a, wall.b, wall.sagitta!, type.thickness);
}

/**
 * 곡선 벽 풋프린트(닫힘 폴리곤, 문서 mm) — WallDeriveInput 없이 호출하는 interop export용 공유 API.
 * 호 중심선(arcPolyline)을 정점 법선으로 ±thickness/2 오프셋한 두 레일(outer ++ reverse inner).
 * interop이 곡선 벽을 직선 chord로 내보내 곡률을 잃는 걸 방지(C5) — 메시 아님, 파라미터서 파생.
 */
export function curvedWallFootprint(a: Pt, b: Pt, sagitta: number, thickness: number): Pt[] {
  const poly = arcPolyline(a, b, sagitta);
  const vn = vertexNormals(poly);
  const half = thickness / 2;
  const outer: Pt[] = poly.map((p, i) => [Math.round(p[0] + vn[i]![0] * half), Math.round(p[1] + vn[i]![1] * half)]);
  const inner: Pt[] = poly.map((p, i) => [Math.round(p[0] - vn[i]![0] * half), Math.round(p[1] - vn[i]![1] * half)]);
  return [...outer, ...inner.slice().reverse()];
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
    wall.sagitta ?? null, // 곡률 변경 시 재파생(누락=stale 캐시→조용한 지오메트리 버그)
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
