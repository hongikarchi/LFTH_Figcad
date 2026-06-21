import { describe, expect, it } from 'vitest';
import { gltfPositionsToFigcad } from '../src/federationCoords';

// M14.1 — glTF 오버레이 좌표 보정. 박스 실험(2026-06-22)으로 측정된 맵: Z(north)만 부호반전.
// 알려진 Rhino 박스 east[10,11]·north[20,22]·height[0,3]m → Rhino glb → GLTFLoader world =
// X[10,11]·Y[0,3]·Z[-22,-20]. gltfPositionsToFigcad → Z 반전 → Z[20,22] = Figcad world +north.

describe('gltfPositionsToFigcad — glTF(north=-Z) → Figcad world(north=+Z)', () => {
  it('박스 실험 코너: Z만 부호반전, X·Y 불변', () => {
    // GLTFLoader가 낸 박스 코너 2개 (X=east, Y=height, Z=-north)
    const gltf = new Float32Array([10, 0, -20, 11, 3, -22]);
    const fig = gltfPositionsToFigcad(gltf);
    // 기대: X·Y 그대로, Z 부호반전 → +north
    expect([fig[0], fig[1], fig[2]]).toEqual([10, 0, 20]);
    expect([fig[3], fig[4], fig[5]]).toEqual([11, 3, 22]);
  });

  it('원본 불변 + 새 배열 반환', () => {
    const src = new Float32Array([1, 2, 3]);
    const out = gltfPositionsToFigcad(src);
    expect(out).not.toBe(src);
    expect([src[0], src[1], src[2]]).toEqual([1, 2, 3]); // 원본 그대로
    expect([out[0], out[1], out[2]]).toEqual([1, 2, -3]);
  });

  it('빈/triplet 경계 안전', () => {
    expect(gltfPositionsToFigcad(new Float32Array(0)).length).toBe(0);
    const t = gltfPositionsToFigcad(new Float32Array([5, 6, 7, 8, 9, 10]));
    expect(Array.from(t)).toEqual([5, 6, -7, 8, 9, -10]);
  });
});
