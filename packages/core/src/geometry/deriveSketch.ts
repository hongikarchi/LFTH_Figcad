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

/** 평면-로컬 uv(mm) → 월드(m) 매퍼. frame 부재=레벨 바닥(수평), 존재=자유 3D 평면(Stage4). */
type Mapper = (u: number, v: number) => [number, number, number];

function makeMapper(sketch: SketchElement, level: Level): Mapper {
  const f = sketch.frame;
  if (f) {
    // world_mm = o + u·x + v·y (x,y=단위 basis), → meters
    return (u, v) => [
      (f.o[0] + u * f.x[0] + v * f.y[0]) * MM,
      (f.o[1] + u * f.x[1] + v * f.y[1]) * MM,
      (f.o[2] + u * f.x[2] + v * f.y[2]) * MM,
    ];
  }
  const y = level.elevation * MM + Y_LIFT;
  return (u, v) => [u * MM, y, v * MM]; // 레벨 바닥 (uv = 문서 평면 mm)
}

/** 폴리라인 → 픽킹 리본(각 세그=얇은 쿼드). 수직은 평면-로컬 uv서 계산 후 매퍼로 3D. */
function ribbonProxy(pts: readonly [number, number][], map: Mapper): { positions: Float32Array; normals: Float32Array } {
  const pos: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    const du = q[0] - p[0];
    const dv = q[1] - p[1];
    const len = Math.hypot(du, dv) || 1;
    const nu = (-dv / len) * PICK_HALF_W; // uv 평면 내 수직
    const nv = (du / len) * PICK_HALF_W;
    const a = map(p[0] + nu, p[1] + nv);
    const bb = map(q[0] + nu, q[1] + nv);
    const c = map(q[0] - nu, q[1] - nv);
    const e = map(p[0] - nu, p[1] - nv);
    pos.push(...a, ...bb, ...c, ...a, ...c, ...e);
  }
  const positions = new Float32Array(pos);
  // 노멀은 픽 전용이라 근사(up). frame 기운 평면도 레이캐스트는 삼각형 기반이라 무관.
  const normals = new Float32Array(pos.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  return { positions, normals };
}

/**
 * 스케치/마크업 — 프리핸드 정점(boundary, 평면-로컬 uv)에서 라인/채움 파생 (불변① — 점=파라미터).
 * mode 'line' = 열린 폴리라인(edges + 픽 리본) · 'zone' = 채운 닫힌 폴리곤(buildFaces) + 닫힌 edges.
 * frame 부재 = 레벨 바닥(uv=문서 mm) · frame 존재 = 자유 3D 평면(uv→3D 매퍼). 스타일은 파생 아님(웹).
 */
export function deriveSketch(input: SketchDeriveInput): DerivedGeometry {
  const { sketch, level } = input;
  const b = sketch.boundary;
  const map = makeMapper(sketch, level);
  const first = b[0] ?? [0, 0];
  const anchorPt = map(first[0], first[1]);
  const anchors = { a: anchorPt, b: anchorPt };

  if (sketch.mode === 'zone' && b.length >= 3) {
    // 채움: profile 좌표 (u,-v) → buildFaces map이 (u,v)=map(u,-v)로 3D 복원 (deriveZone 관례)
    const profile: Profile = { outer: b.map(([u, v]) => [u, -v] as [number, number]), holes: [] };
    const mesh = buildFaces([{ profile, map: (u, v) => map(u, -v) }]);
    const edges: number[] = [];
    for (let i = 0; i < b.length; i++) {
      const p = b[i]!;
      const q = b[(i + 1) % b.length]!; // 닫힘(wraparound)
      edges.push(...map(p[0], p[1]), ...map(q[0], q[1]));
    }
    return { positions: mesh.positions, normals: mesh.normals, edges: new Float32Array(edges), anchors };
  }

  // line = 열린 폴리라인(보이는 edges) + 픽 프록시 리본(SceneManager 투명 처리, 클릭선택용)
  const edges: number[] = [];
  for (let i = 0; i < b.length - 1; i++) {
    const p = b[i]!;
    const q = b[i + 1]!;
    edges.push(...map(p[0], p[1]), ...map(q[0], q[1]));
  }
  const proxy = ribbonProxy(b, map);
  return { positions: proxy.positions, normals: proxy.normals, edges: new Float32Array(edges), anchors };
}

export function sketchDeriveKey(input: SketchDeriveInput): string {
  // 스타일은 제외(렌더 힌트, 지오 무영향) — boundary·mode·frame·elevation만 폴드
  return JSON.stringify([input.sketch.boundary, input.sketch.mode, input.sketch.frame ?? null, input.level.elevation]);
}
