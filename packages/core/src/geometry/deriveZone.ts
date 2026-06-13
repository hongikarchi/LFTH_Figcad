import { buildFaces, type Profile } from './meshBuilder';
import type { DerivedGeometry } from './deriveWall';
import type { Level, Pt, ZoneElement } from '../schema';

const MM = 0.001;

export interface ZoneDeriveInput {
  zone: ZoneElement;
  level: Level;
}

/** 폴리곤 면적 (shoelace, mm²) */
export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/** 폴리곤 무게중심 (면적 가중). 퇴화 시 정점 평균 폴백. */
export function polygonCentroid(poly: Pt[]): Pt {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const cross = p[0] * q[1] - q[0] * p[1];
    a += cross;
    cx += (p[0] + q[0]) * cross;
    cy += (p[1] + q[1]) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

/**
 * 존(공간) — 경계 폴리곤의 바닥 면(픽킹·표시) + 경계 윤곽 + 중심 스탬프(이름·면적).
 * IfcSpace 대응. 면적 = shoelace(㎡), 부피 = 면적×높이(라벨 미표시, IFC에 export).
 * grid 선례(선+라벨)를 폴리곤으로 확장. 타입 없음(주석류 — 각 존이 고유).
 */
export function deriveZone(input: ZoneDeriveInput): DerivedGeometry {
  const { zone, level } = input;
  const y = level.elevation * MM + 0.015;
  const b = zone.boundary;
  const cen = polygonCentroid(b);
  const anchors = {
    a: [cen[0] * MM, y, cen[1] * MM] as [number, number, number],
    b: [cen[0] * MM, y, cen[1] * MM] as [number, number, number],
  };
  if (b.length < 3) {
    return { positions: new Float32Array(0), normals: new Float32Array(0), edges: new Float32Array(0), anchors };
  }
  // 픽킹/표시용 바닥 면 (earcut via buildFaces) — grid 리본과 동일 좌표 관례
  const profile: Profile = { outer: b.map(([x, yy]) => [x, -yy] as [number, number]), holes: [] };
  const mesh = buildFaces([{ profile, map: (u, v) => [u * MM, y, -v * MM] }]);
  // 경계 윤곽 루프
  const edgesArr: number[] = [];
  for (let i = 0; i < b.length; i++) {
    const p = b[i]!;
    const q = b[(i + 1) % b.length]!;
    edgesArr.push(p[0] * MM, y, p[1] * MM, q[0] * MM, y, q[1] * MM);
  }
  const area = polygonArea(b);
  const num = zone.number ? `${zone.number} ` : '';
  const lp: [number, number, number] = [cen[0] * MM, y, cen[1] * MM];
  return {
    positions: mesh.positions,
    normals: mesh.normals,
    edges: new Float32Array(edgesArr),
    anchors,
    labels: [
      { text: `${num}${zone.name}`, pos: lp, style: 'text' },
      { text: `${(area / 1e6).toFixed(1)}㎡`, pos: [lp[0], y, lp[2] + 0.35], style: 'text' },
    ],
  };
}

export function zoneDeriveKey(input: ZoneDeriveInput): string {
  return JSON.stringify([
    input.zone.boundary,
    input.zone.name,
    input.zone.number ?? null,
    input.zone.height ?? null,
    input.level.elevation,
  ]);
}
