import { buildFaces, type Profile } from './meshBuilder';
import type { DerivedGeometry } from './deriveWall';
import type { Level, SketchElement } from '../schema';

const MM = 0.001;
const Y_LIFT = 0.03; // 바닥 살짝 위 (마크업 — 요소 위에 보이게)
const PICK_HALF_W = 60; // line 모드 픽 프록시 반폭 mm (스프라이트/라인은 레이캐스트 부정확 → 리본)

export interface SketchDeriveInput {
  sketch: SketchElement;
  level: Level;
}

/** 폴리라인 → 픽킹 리본 메시(각 세그먼트 = 얇은 쿼드 2삼각형). SceneManager가 투명 처리. */
function ribbonProxy(pts: readonly [number, number][], y: number): { positions: Float32Array; normals: Float32Array } {
  const pos: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * PICK_HALF_W;
    const ny = (dx / len) * PICK_HALF_W;
    const aX = (p[0] + nx) * MM, aZ = (p[1] + ny) * MM;
    const bX = (q[0] + nx) * MM, bZ = (q[1] + ny) * MM;
    const cX = (q[0] - nx) * MM, cZ = (q[1] - ny) * MM;
    const eX = (p[0] - nx) * MM, eZ = (p[1] - ny) * MM;
    pos.push(aX, y, aZ, bX, y, bZ, cX, y, cZ, aX, y, aZ, cX, y, cZ, eX, y, eZ);
  }
  const positions = new Float32Array(pos);
  const normals = new Float32Array(pos.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1; // up (+Y)
  return { positions, normals };
}

/**
 * 스케치/마크업 — 프리핸드 정점(boundary)에서 라인/채움 파생 (불변① — 점=파라미터).
 * mode 'line' = 열린 폴리라인(edges만) · 'zone' = 채운 닫힌 폴리곤(buildFaces + 닫힌 edges, deriveZone 재사용).
 * 스타일(색·투명도·굵기·선종류)은 파생 아님 — 웹 SceneManager가 el.style서 읽음(re-derive 불필요).
 * frame 부재 = 레벨 바닥 평면(boundary=문서 mm). frame(자유 3D 평면)은 Stage4서 처리.
 */
export function deriveSketch(input: SketchDeriveInput): DerivedGeometry {
  const { sketch, level } = input;
  const y = level.elevation * MM + Y_LIFT;
  const b = sketch.boundary;
  const first = b[0] ?? [0, 0];
  const anchorPt: [number, number, number] = [first[0] * MM, y, first[1] * MM];
  const anchors = { a: anchorPt, b: anchorPt };

  if (sketch.mode === 'zone' && b.length >= 3) {
    // 채움 (deriveZone과 동일 좌표 관례) + 닫힌 윤곽
    const profile: Profile = { outer: b.map(([x, yy]) => [x, -yy] as [number, number]), holes: [] };
    const mesh = buildFaces([{ profile, map: (u, v) => [u * MM, y, -v * MM] }]);
    const edges: number[] = [];
    for (let i = 0; i < b.length; i++) {
      const p = b[i]!;
      const q = b[(i + 1) % b.length]!; // 닫힘(wraparound)
      edges.push(p[0] * MM, y, p[1] * MM, q[0] * MM, y, q[1] * MM);
    }
    return { positions: mesh.positions, normals: mesh.normals, edges: new Float32Array(edges), anchors };
  }

  // line = 열린 폴리라인 (보이는 edges) + 픽 프록시 리본(SceneManager가 투명 처리, 클릭선택용).
  const edges: number[] = [];
  for (let i = 0; i < b.length - 1; i++) {
    const p = b[i]!;
    const q = b[i + 1]!;
    edges.push(p[0] * MM, y, p[1] * MM, q[0] * MM, y, q[1] * MM);
  }
  const proxy = ribbonProxy(b, y);
  return {
    positions: proxy.positions,
    normals: proxy.normals,
    edges: new Float32Array(edges),
    anchors,
  };
}

export function sketchDeriveKey(input: SketchDeriveInput): string {
  // 스타일은 제외(렌더 힌트, 지오 무영향) — boundary·mode·elevation만 폴드
  return JSON.stringify([input.sketch.boundary, input.sketch.mode, input.level.elevation]);
}
