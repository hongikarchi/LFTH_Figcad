import { buildFaces, extrudeProfile, type Profile } from './meshBuilder';
import { polygonCentroid } from './deriveZone';
import type { DerivedGeometry } from './deriveWall';
import type { GridLine, OpeningDeriveInput, SlabDeriveInput } from '../schema';
import { resolveOpening } from '../schema';

const MM = 0.001;

/**
 * 슬라브 — 경계 폴리곤을 레벨 elevation에서 아래로 두께만큼 압출
 * (ArchiCAD 관례: 슬라브 상면 = 스토리 레벨).
 */
export function deriveSlab(input: SlabDeriveInput): DerivedGeometry {
  const { slab, type, level } = input;
  const thickness = (slab.thicknessOverride ?? type.thickness) * MM;
  const topY = level.elevation * MM;
  const centerY = topY - thickness / 2;

  const profile: Profile = {
    outer: slab.boundary.map(([x, y]) => [x * MM, -y * MM] as [number, number]),
    holes: [],
  };
  const mesh = extrudeProfile(profile, thickness, (u, v, w) => [u, centerY + w, -v]);

  const first = slab.boundary[0]!;
  // 면적가중 무게중심(오목 폴리곤서도 내부) — zone/labelTargetCenter와 일관(broad review [15]).
  const [cx, cy] = polygonCentroid(slab.boundary);
  return {
    ...mesh,
    anchors: {
      a: [first[0] * MM, topY, first[1] * MM],
      b: [cx * MM, topY, cy * MM], // b = 무게중심 (치수칩/라벨 배치용)
    },
  };
}

export function slabDeriveKey(input: SlabDeriveInput): string {
  const { slab, type, level } = input;
  return JSON.stringify([
    slab.boundary,
    slab.thicknessOverride ?? null,
    type.thickness,
    type.color,
    level.elevation,
  ]);
}

/**
 * 개구부 패널 — 구멍 안에 끼워진 단순 패널 박스 (선택/시각 마커).
 * 구멍 자체는 호스트 벽 파생이 뚫는다. 문 스윙 호 등 2D 기호는 도면 단계에서.
 */
export function deriveOpening(input: OpeningDeriveInput): DerivedGeometry {
  const { opening, type, host, hostType, level } = input;
  const H = host.height ?? level.height;
  const r = resolveOpening(opening, type, host, H);
  const baseY = (level.elevation + (host.baseOffset ?? 0)) * MM;
  const [ax, ay] = host.a;
  const lenMm = Math.hypot(host.b[0] - ax, host.b[1] - ay);
  if (!r || lenMm === 0) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      edges: new Float32Array(0),
      anchors: { a: [ax * MM, baseY, ay * MM], b: [ax * MM, baseY, ay * MM] },
    };
  }
  const dir: [number, number] = [(host.b[0] - ax) / lenMm, (host.b[1] - ay) / lenMm];
  const n: [number, number] = [-dir[1], dir[0]];
  const panelT = Math.max(hostType.thickness * 0.25, 30);

  // 패널 = (s,z) 프로필을 두께 방향으로 압출 (중심선 위치)
  const profile: Profile = {
    outer: [
      [r.offset - r.width / 2, r.sill],
      [r.offset + r.width / 2, r.sill],
      [r.offset + r.width / 2, r.sill + r.height],
      [r.offset - r.width / 2, r.sill + r.height],
    ],
    holes: [],
  };
  const mesh = buildFacesForPanel(profile, panelT, (s, z, w) => [
    (ax + dir[0] * s + n[0] * w) * MM,
    baseY + z * MM,
    (ay + dir[1] * s + n[1] * w) * MM,
  ]);

  const center: [number, number, number] = [
    (ax + dir[0] * r.offset) * MM,
    baseY + (r.sill + r.height / 2) * MM,
    (ay + dir[1] * r.offset) * MM,
  ];
  return { ...mesh, anchors: { a: center, b: center } };
}

/** (s,z) 프로필 + 두께 w 압출 — extrudeProfile은 (u,v,w) 오른손 규약이라 직접 매핑 */
function buildFacesForPanel(
  profile: Profile,
  thickness: number,
  map: (s: number, z: number, w: number) => [number, number, number],
) {
  // (s,z) 평면에서 w가 +n: (e_s, e_z) = (dir, Y) → e_s×e_z = +n? deriveWall 검증과 동일:
  // dir3×Y = +n ✓ 오른손 성립 → extrudeProfile 규약 그대로 사용 가능
  return extrudeProfile(profile, thickness, (u, v, w) => map(u, v, w));
}

export function openingDeriveKey(input: OpeningDeriveInput): string {
  const { opening, type, host, hostType, level } = input;
  return JSON.stringify([
    opening.offset,
    opening.widthOverride ?? null,
    opening.heightOverride ?? null,
    opening.sillOverride ?? null,
    type.opening,
    type.color,
    host.a,
    host.b,
    host.height ?? null,
    host.baseOffset ?? null,
    hostType.thickness,
    level.elevation,
    level.height,
  ]);
}

/**
 * 구조 그리드 축선 — 라인(끝 1m 연장) + 양끝 버블 자리.
 * 라벨 텍스트 렌더는 web(SceneManager)이 anchors에 스프라이트로.
 * 픽킹용 얇은 리본 메시 포함 (라인은 레이캐스트 어려움).
 */
export function deriveGrid(grid: GridLine): DerivedGeometry {
  const [ax, ay] = grid.a;
  const [bx, by] = grid.b;
  const len = Math.hypot(bx - ax, by - ay);
  const y = 0.02; // 지면 살짝 위
  if (len === 0) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      edges: new Float32Array(0),
      anchors: { a: [ax * MM, y, ay * MM], b: [bx * MM, y, by * MM] },
    };
  }
  const dir = [(bx - ax) / len, (by - ay) / len] as const;
  const EXT = 1000; // 끝 연장 1m
  const ea = [ax - dir[0] * EXT, ay - dir[1] * EXT] as const;
  const eb = [bx + dir[0] * EXT, by + dir[1] * EXT] as const;

  // 픽킹 리본 (80mm 폭, 수평)
  const n = [-dir[1], dir[0]] as const;
  const hw = 40;
  const ribbon: Profile = {
    outer: [
      [ea[0] - n[0] * hw, -(ea[1] - n[1] * hw)],
      [eb[0] - n[0] * hw, -(eb[1] - n[1] * hw)],
      [eb[0] + n[0] * hw, -(eb[1] + n[1] * hw)],
      [ea[0] + n[0] * hw, -(ea[1] + n[1] * hw)],
    ],
    holes: [],
  };
  const mesh = buildFaces([{ profile: ribbon, map: (u, v) => [u * MM, y, -v * MM] }]);

  const edges = new Float32Array([ea[0] * MM, y, ea[1] * MM, eb[0] * MM, y, eb[1] * MM]);
  const pa: [number, number, number] = [ea[0] * MM, y, ea[1] * MM];
  const pb: [number, number, number] = [eb[0] * MM, y, eb[1] * MM];
  return {
    positions: mesh.positions,
    normals: mesh.normals,
    edges,
    // anchors = 버블 위치 (양끝 연장점)
    anchors: { a: pa, b: pb },
    // 라벨 채널: 양끝 버블 (SceneManager가 스프라이트로)
    labels: [
      { text: grid.label, pos: pa, style: 'grid' },
      { text: grid.label, pos: pb, style: 'grid' },
    ],
  };
}

export function gridDeriveKey(grid: GridLine): string {
  return JSON.stringify([grid.a, grid.b, grid.label]);
}
