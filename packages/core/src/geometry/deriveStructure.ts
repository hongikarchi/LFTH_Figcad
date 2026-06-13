import { extrudeProfile, type Profile, type Ring } from './meshBuilder';
import type { DerivedGeometry } from './deriveWall';
import type { ColumnDeriveInput, Section } from '../schema';

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
