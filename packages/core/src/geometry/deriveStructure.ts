import { extrudeProfile, mergeMeshData, type MeshData, type Profile, type Ring } from './meshBuilder';
import type { DerivedGeometry } from './deriveWall';
import type {
  BeamDeriveInput,
  ColumnDeriveInput,
  CurtainWallDeriveInput,
  RailingDeriveInput,
  RoofDeriveInput,
  Section,
  StairDeriveInput,
} from '../schema';

const MM = 0.001;
const CIRCLE_SEGMENTS = 24; // 원형 단면 N각형 테셀레이션 (줌 무관 고정 — 문서 결정론)

/**
 * 단면 → 원점 중심 링 (mm, 평면 [x, y]). rect = width(x)×depth(y),
 * circle = 지름 N각형. 보·기둥이 공유 (extrudeProfile 단일 경로).
 */
export function sectionRing(section: Section): Ring {
  if (section.shape === 'rect') {
    const hw = section.width / 2;
    const hd = section.depth / 2;
    return [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ];
  }
  const r = section.diameter / 2;
  const ring: Ring = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    ring.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return ring;
}

/**
 * 기둥 — 평면 점(at)의 단면을 베이스에서 위로 height만큼 수직 압출.
 * 슬라브 압출과 같은 (u, v, w) 규약: 프로필은 월드(x, -y), w가 높이(Y).
 */
export function deriveColumn(input: ColumnDeriveInput): DerivedGeometry {
  const { column, type, level } = input;
  const [cx, cy] = column.at;
  const H = (column.height ?? level.height) * MM;
  const baseY = (level.elevation + (column.baseOffset ?? 0)) * MM;
  const centerY = baseY + H / 2;

  const ring = sectionRing(type.section);
  const profile: Profile = {
    outer: ring.map(([sx, sy]) => [(cx + sx) * MM, -(cy + sy) * MM] as [number, number]),
    holes: [],
  };
  const mesh = extrudeProfile(profile, H, (u, v, w) => [u, centerY + w, -v]);

  return {
    ...mesh,
    anchors: {
      a: [cx * MM, baseY, cy * MM], // 베이스 중심
      b: [cx * MM, baseY + H, cy * MM], // 상단 중심
    },
  };
}

export function columnDeriveKey(input: ColumnDeriveInput): string {
  const { column, type, level } = input;
  return JSON.stringify([
    column.at,
    column.height ?? null,
    column.baseOffset ?? null,
    type.section,
    type.color,
    level.elevation,
    level.height,
  ]);
}

/** 단면의 수직 반높이 (rect=depth/2, circle=반지름) — 보 기본 높이 계산용 */
function sectionVHalf(section: Section): number {
  return section.shape === 'circle' ? section.diameter / 2 : section.depth / 2;
}

/**
 * 보 — a→b 중심축을 따라 단면(width=수평, depth=수직)을 압출.
 * 단면 (p, q)를 축 방향 w로 압출: p=축직각 수평(n), q=수직(Y), w=축(dir).
 * n=(dir.y,-dir.x)로 잡아 (e_p×e_q=+e_w) 오른손계 → 법선 외향.
 * 기본 높이 = 상단을 천장(level.height)에 맞춤 (zOffset 미지정 시).
 */
export function deriveBeam(input: BeamDeriveInput): DerivedGeometry {
  const { beam, type, level } = input;
  const [ax, ay] = beam.a;
  const [bx, by] = beam.b;
  const L = Math.hypot(bx - ax, by - ay);
  const vHalf = sectionVHalf(type.section);
  const axisZ = (level.elevation + (beam.zOffset ?? level.height - vHalf)) * MM;
  const anchors = {
    a: [ax * MM, axisZ, ay * MM] as [number, number, number],
    b: [bx * MM, axisZ, by * MM] as [number, number, number],
  };
  if (L === 0) {
    return { positions: new Float32Array(0), normals: new Float32Array(0), edges: new Float32Array(0), anchors };
  }

  const dir: [number, number] = [(bx - ax) / L, (by - ay) / L];
  const n: [number, number] = [dir[1], -dir[0]]; // 오른손계 보장
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;

  const profile: Profile = { outer: sectionRing(type.section), holes: [] }; // (p, q) mm
  const mesh = extrudeProfile(profile, L, (p, q, w) => [
    (mx + dir[0] * w + n[0] * p) * MM,
    axisZ + q * MM,
    (my + dir[1] * w + n[1] * p) * MM,
  ]);

  return { ...mesh, anchors };
}

export function beamDeriveKey(input: BeamDeriveInput): string {
  const { beam, type, level } = input;
  return JSON.stringify([
    beam.a,
    beam.b,
    beam.zOffset ?? null,
    type.section,
    type.color,
    level.elevation,
    level.height,
  ]);
}

const EMPTY: MeshData = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  edges: new Float32Array(0),
};

/** 원점 중심 정사각 링 (변=size, mm) — 난간 포스트용 */
function squareRing(size: number): Ring {
  const h = size / 2;
  return [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];
}

/**
 * 계단 — a→b 직선 1주행. 측면 실루엣(주행 u × 높이 v 평면의 계단 폴리곤)을
 * 폭 방향으로 압출 → 내부면 0 (스텝 박스 합집합 대비 z-fight·삼각형 낭비 없음).
 * 핸디드니스: 압출축 w=폭(across)이라 보와 다름 — n=[-dir.y, dir.x] (e_u×e_v=dir×Y=+e_w 검증).
 * 총상승 = level.height (한 층 오름). 단수 = round(총상승/목표단높이 riser),
 * 실 단높이 = 총상승/단수, 디딤판(going) = 주행/단수 (a→b 길이를 단수로 분할).
 */
export function deriveStair(input: StairDeriveInput): DerivedGeometry {
  const { stair, type, level } = input;
  const [ax, ay] = stair.a;
  const [bx, by] = stair.b;
  const run = Math.hypot(bx - ax, by - ay);
  const baseElev = level.elevation + (stair.baseOffset ?? 0);
  const totalRise = level.height;
  const anchors = {
    a: [ax * MM, baseElev * MM, ay * MM] as [number, number, number],
    b: [bx * MM, (baseElev + totalRise) * MM, by * MM] as [number, number, number],
  };
  if (run === 0 || totalRise <= 0) return { ...EMPTY, anchors };

  const dir: [number, number] = [(bx - ax) / run, (by - ay) / run];
  const n: [number, number] = [-dir[1], dir[0]]; // 폭 방향, e_u×e_v=+e_w
  const nSteps = Math.max(1, Math.round(totalRise / Math.max(type.riser, 1)));
  const tread = run / nSteps;
  const riser = totalRise / nSteps;

  // 측면 실루엣 (u=주행, v=높이): 계단 윤곽 폴리곤
  const outer: Ring = [[0, 0]];
  for (let i = 0; i < nSteps; i++) {
    outer.push([i * tread, (i + 1) * riser]); // 단높이 상승
    outer.push([(i + 1) * tread, (i + 1) * riser]); // 디딤판
  }
  outer.push([run, 0]); // 끝면 하강

  const profile: Profile = { outer, holes: [] };
  const mesh = extrudeProfile(profile, type.width, (u, v, w) => [
    (ax + dir[0] * u + n[0] * w) * MM,
    (baseElev + v) * MM,
    (ay + dir[1] * u + n[1] * w) * MM,
  ]);
  return { ...mesh, anchors };
}

export function stairDeriveKey(input: StairDeriveInput): string {
  const { stair, type, level } = input;
  return JSON.stringify([
    stair.a,
    stair.b,
    stair.baseOffset ?? null,
    type.width,
    type.riser,
    type.color,
    level.elevation,
    level.height,
  ]);
}

const POST = 50; // 난간 포스트 단면 (정사각, mm)
const RAIL_W = 60; // 상부레일 폭 (mm)
const RAIL_H = 50; // 상부레일 춤 (mm)

/**
 * 난간 — a→b 직선. 포스트(정사각 수직 박스) 균등 반복 + 상부레일(축 박스).
 * 포스트는 슬라브/기둥 수직 압출 규약, 레일은 보 축 압출 규약 (각자 핸디드니스).
 */
export function deriveRailing(input: RailingDeriveInput): DerivedGeometry {
  const { railing, type, level } = input;
  const [ax, ay] = railing.a;
  const [bx, by] = railing.b;
  const len = Math.hypot(bx - ax, by - ay);
  const baseElev = level.elevation + (railing.baseOffset ?? 0);
  const topElev = baseElev + type.height;
  const anchors = {
    a: [ax * MM, topElev * MM, ay * MM] as [number, number, number],
    b: [bx * MM, topElev * MM, by * MM] as [number, number, number],
  };
  if (len === 0 || type.height <= 0) return { ...EMPTY, anchors };

  const dir: [number, number] = [(bx - ax) / len, (by - ay) / len];
  const parts: MeshData[] = [];

  // 포스트 — 균등 분할 (양끝 포함)
  const nGaps = Math.max(1, Math.round(len / Math.max(type.postSpacing, 1)));
  const spacing = len / nGaps;
  const H = type.height * MM;
  const centerY = (baseElev + type.height / 2) * MM;
  const ring = squareRing(POST);
  for (let i = 0; i <= nGaps; i++) {
    const px = ax + dir[0] * spacing * i;
    const py = ay + dir[1] * spacing * i;
    const profile: Profile = {
      outer: ring.map(([sx, sy]) => [(px + sx) * MM, -(py + sy) * MM] as [number, number]),
      holes: [],
    };
    parts.push(extrudeProfile(profile, H, (u, v, w) => [u, centerY + w, -v]));
  }

  // 상부레일 — 보 축 압출 (윗면을 height에 맞춤)
  const nb: [number, number] = [dir[1], -dir[0]]; // 보 핸디드니스
  const railZ = (topElev - RAIL_H / 2) * MM;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const railProfile: Profile = {
    outer: [
      [-RAIL_W / 2, -RAIL_H / 2],
      [RAIL_W / 2, -RAIL_H / 2],
      [RAIL_W / 2, RAIL_H / 2],
      [-RAIL_W / 2, RAIL_H / 2],
    ],
    holes: [],
  };
  parts.push(
    extrudeProfile(railProfile, len, (p, q, w) => [
      (mx + dir[0] * w + nb[0] * p) * MM,
      railZ + q * MM,
      (my + dir[1] * w + nb[1] * p) * MM,
    ]),
  );

  return { ...mergeMeshData(parts), anchors };
}

export function railingDeriveKey(input: RailingDeriveInput): string {
  const { railing, type, level } = input;
  return JSON.stringify([
    railing.a,
    railing.b,
    railing.baseOffset ?? null,
    type.height,
    type.postSpacing,
    type.color,
    level.elevation,
  ]);
}

/**
 * 지붕 — 경계 폴리곤을 벽 위(level.elevation+height)에 평/단경사 슬라브로.
 * extrudeProfile 단일 경로: map의 수직항이 plan 위치 의존(경사) + w=수직 두께.
 * enforceWinding이 경계 와인딩 정규화 → CW 입력도 inside-out 안 됨 (buildFaces 회피).
 */
export function deriveRoof(input: RoofDeriveInput): DerivedGeometry {
  const { roof, type, level } = input;
  const thickness = roof.thicknessOverride ?? type.thickness;
  const baseElev = level.elevation + level.height + (roof.baseOffset ?? 0);
  const [p0x, p0y] = roof.boundary[0]!;

  // 경사 방향 단위벡터 + 1000mm당 상승률
  let dux = 0;
  let duy = 0;
  let k = 0;
  if (roof.slope) {
    const dl = Math.hypot(roof.slope.dir[0], roof.slope.dir[1]);
    if (dl > 0) {
      dux = roof.slope.dir[0] / dl;
      duy = roof.slope.dir[1] / dl;
      k = roof.slope.pitch / 1000;
    }
  }
  const zBottom = (x: number, y: number): number =>
    baseElev + k * ((x - p0x) * dux + (y - p0y) * duy);

  const profile: Profile = {
    outer: roof.boundary.map(([x, y]) => [x, -y] as [number, number]),
    holes: [],
  };
  const mesh = extrudeProfile(profile, thickness, (u, v, w) => {
    const x = u;
    const y = -v;
    return [x * MM, (zBottom(x, y) + thickness / 2 + w) * MM, y * MM];
  });

  const cx = roof.boundary.reduce((acc, p) => acc + p[0], 0) / roof.boundary.length;
  const cy = roof.boundary.reduce((acc, p) => acc + p[1], 0) / roof.boundary.length;
  const topMid = (zBottom(cx, cy) + thickness) * MM;
  return {
    ...mesh,
    anchors: {
      a: [p0x * MM, (zBottom(p0x, p0y) + thickness) * MM, p0y * MM],
      b: [cx * MM, topMid, cy * MM], // 무게중심 상면 (라벨용)
    },
  };
}

export function roofDeriveKey(input: RoofDeriveInput): string {
  const { roof, type, level } = input;
  return JSON.stringify([
    roof.boundary,
    roof.baseOffset ?? null,
    roof.thicknessOverride ?? null,
    roof.slope ?? null,
    type.thickness,
    type.color,
    level.elevation,
    level.height,
  ]);
}

/** 0..total을 spacing 간격으로 — 양끝(0,total) 테두리 포함 */
function gridStops(total: number, spacing: number): number[] {
  const s = Math.max(spacing, 50);
  const out: number[] = [];
  for (let x = 0; x < total - 1; x += s) out.push(x);
  out.push(total);
  return out;
}

/**
 * 커튼월 — 베이스라인 a→b × 높이 H 면을 멀리언 그리드로.
 * 수직 멀리언(기둥식 수직 압출) at u=0..L every uSpacing + 수평 멀리언(보식 축 압출)
 * at v=0..H every vSpacing. 패널(유리)=v1.5. 단면=type.mullionSection.
 */
export function deriveCurtainWall(input: CurtainWallDeriveInput): DerivedGeometry {
  const { cw, type, level } = input;
  const [ax, ay] = cw.a;
  const [bx, by] = cw.b;
  const L = Math.hypot(bx - ax, by - ay);
  const H = cw.height ?? level.height;
  const baseE = level.elevation + (cw.baseOffset ?? 0);
  const baseY = baseE * MM;
  const anchors = {
    a: [ax * MM, baseY, ay * MM] as [number, number, number],
    b: [bx * MM, baseY, by * MM] as [number, number, number],
  };
  if (L === 0 || H <= 0) {
    return { positions: new Float32Array(0), normals: new Float32Array(0), edges: new Float32Array(0), anchors };
  }
  const dir: [number, number] = [(bx - ax) / L, (by - ay) / L];
  const n: [number, number] = [dir[1], -dir[0]]; // 베이스라인 수직(평면)
  const ring = sectionRing(type.mullionSection);
  const meshes: MeshData[] = [];

  // 수직 멀리언 — 각 u 위치에서 단면을 수직 압출 (기둥식)
  const mh = H * MM;
  const centerY = baseY + mh / 2;
  for (const u of gridStops(L, cw.uSpacing)) {
    const px = ax + dir[0] * u;
    const py = ay + dir[1] * u;
    const profile: Profile = {
      outer: ring.map(([sw, sd]) => {
        const wx = px + dir[0] * sw + n[0] * sd;
        const wy = py + dir[1] * sw + n[1] * sd;
        return [wx * MM, -(wy * MM)] as [number, number];
      }),
      holes: [],
    };
    meshes.push(extrudeProfile(profile, mh, (uu, vv, w) => [uu, centerY + w, -vv]));
  }

  // 수평 멀리언 — 각 v 높이에서 단면을 베이스라인 축 압출 (보식)
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const nb: [number, number] = [dir[1], -dir[0]];
  for (const v of gridStops(H, cw.vSpacing)) {
    const axisZ = (baseE + v) * MM;
    const profile: Profile = { outer: ring, holes: [] };
    meshes.push(
      extrudeProfile(profile, L, (p, q, w) => [
        (mx + dir[0] * w + nb[0] * p) * MM,
        axisZ + q * MM,
        (my + dir[1] * w + nb[1] * p) * MM,
      ]),
    );
  }

  return { ...mergeMeshData(meshes), anchors };
}

export function curtainWallDeriveKey(input: CurtainWallDeriveInput): string {
  const { cw, type, level } = input;
  return JSON.stringify([
    cw.a,
    cw.b,
    cw.height ?? null,
    cw.baseOffset ?? null,
    cw.uSpacing,
    cw.vSpacing,
    type.mullionSection,
    type.color,
    level.elevation,
    level.height,
  ]);
}
