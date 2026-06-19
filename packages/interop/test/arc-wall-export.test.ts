import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument, SEED_IDS } from '@figcad/core';
import { exportDxf } from '../src';

// C5 — 곡선(sagitta) 벽이 interop export 시 직선 chord로 붕괴되지 않고 곡률을 보존하는지(게이트).
// DXF(sync·무WASM)로 검증 — IFC/.3dm도 같은 arcPolyline/curvedWallFootprint를 쓰므로 강한 증거.

function withWall(sagitta?: number): DocStore {
  const s = new DocStore();
  seedDocument(s);
  s.createWall({
    levelId: SEED_IDS.level,
    typeId: SEED_IDS.wall200,
    a: [0, 0],
    b: [4000, 0],
    ...(sagitta !== undefined ? { sagitta } : {}),
  });
  return s;
}

describe('C5 곡선 벽 export — 곡률 보존(직선 chord 손실 방지)', () => {
  it('곡선 벽 DXF = 직선 벽보다 정점 많음(다정점 폴리라인으로 곡선 표현)', () => {
    const straight = exportDxf(withWall().snapshot());
    const arc = exportDxf(withWall(800).snapshot());
    expect(straight.length).toBeGreaterThan(0);
    // 곡선 = 호 테셀 dense 폴리라인(중심선 다정점 + 곡선 풋프린트) → 직선(LINE 1 + rect 4)보다 큼.
    expect(arc.length).toBeGreaterThan(straight.length);
  });

  it('곡선 벽 footprint 정점이 현(chord)에서 벗어남(휜 형상 실재)', () => {
    // sagitta 800, 4000 현 → 중간 정점이 y≈800 근처(직선이면 전부 y≈±100 두께 안).
    const arc = exportDxf(withWall(800).snapshot());
    // DXF 텍스트에 현(y=0±100)을 크게 벗어난 좌표(수백 mm)가 존재 = 곡률 실재.
    const ys = [...arc.matchAll(/^\s*20\s*\n\s*(-?\d+(?:\.\d+)?)/gm)].map((m) => Math.abs(parseFloat(m[1]!)));
    expect(Math.max(...ys, 0)).toBeGreaterThan(300); // 직선 벽이면 ≤ 두께/2=100
  });
});
