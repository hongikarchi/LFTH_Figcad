import { extrudeProfile, type Profile, type Ring } from './meshBuilder';
import type { DerivedGeometry } from './deriveWall';
import type { BeamDeriveInput, ColumnDeriveInput, Section } from '../schema';

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
