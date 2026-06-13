import { describe, expect, it } from 'vitest';
import {
  DocStore,
  seedDocument,
  SEED_IDS,
  type GridLine,
  type SlabElement,
  type WallElement,
} from '@figcad/core';
import { exportDxf, importDxf } from '../src';

function sample(): DocStore {
  const s = new DocStore();
  seedDocument(s);
  const L = SEED_IDS.level;
  s.createWall({ levelId: L, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
  s.createWall({ levelId: L, typeId: SEED_IDS.wall200, a: [4000, 0], b: [4000, 3000] });
  s.createSlab({ levelId: L, typeId: SEED_IDS.slab150, boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] });
  s.createGridLine({ a: [0, -500], b: [0, 3500], label: '1' });
  return s;
}

describe('DXF 라운드트립 (2D 지오메트리)', () => {
  it('벽 중심선 보존 (두께 기본값)', () => {
    const s = sample();
    const { snapshot } = importDxf(exportDxf(s.snapshot()));
    const walls = snapshot.elements.filter((e): e is WallElement => e.kind === 'wall');
    expect(walls).toHaveLength(2);
    const keys = walls.map((w) => `${w.a}|${w.b}`).sort();
    expect(keys).toEqual(['0,0|4000,0', '4000,0|4000,3000'].sort());
  });

  it('슬라브 경계 보존', () => {
    const s = sample();
    const { snapshot } = importDxf(exportDxf(s.snapshot()));
    const slab = snapshot.elements.find((e): e is SlabElement => e.kind === 'slab')!;
    expect(slab.boundary).toEqual([[0, 0], [4000, 0], [4000, 3000], [0, 3000]]);
  });

  it('그리드 보존', () => {
    const s = sample();
    const { snapshot } = importDxf(exportDxf(s.snapshot()));
    const grids = snapshot.elements.filter((e): e is GridLine => e.kind === 'grid');
    expect(grids).toHaveLength(1);
    expect(grids[0]!.a).toEqual([0, -500]);
    expect(grids[0]!.b).toEqual([0, 3500]);
  });

  it('DXF 문자열이 유효 (헤더 + ENTITIES)', () => {
    const s = sample();
    const dxf = exportDxf(s.snapshot());
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('ENTITIES');
    expect(dxf).toContain('LWPOLYLINE');
  });

  it('외부 DXF best-effort (레이어 없이 LINE→벽, 닫힌 폴리라인→슬라브)', () => {
    // Figcad 레이어 없는 최소 DXF를 손으로 — dxf-writer로 기본 레이어(0)에 그림
    // (hasFigcadLayers=false 경로): 열린 LINE은 벽, 닫힌 폴리라인은 슬라브
    const { snapshot } = importDxf(exportExternal());
    const walls = snapshot.elements.filter((e) => e.kind === 'wall');
    const slabs = snapshot.elements.filter((e) => e.kind === 'slab');
    expect(walls.length).toBe(1);
    expect(slabs.length).toBe(1);
  });
});

/** Figcad 레이어가 없는 외부 DXF 모사 */
function exportExternal(): string {
  // dxf-writer 기본 레이어('0')에 LINE + 닫힌 폴리라인
  // (import의 hasFigcadLayers 분기가 false가 되도록 'Wall Axis'/'Slab' 레이어 미사용)
  const lines = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', '0', '10', '0', '20', '0', '30', '0', '11', '5000', '21', '0', '31', '0',
    '0', 'LWPOLYLINE', '8', '0', '90', '4', '70', '1',
    '10', '0', '20', '0', '10', '2000', '20', '0', '10', '2000', '20', '2000', '10', '0', '20', '2000',
    '0', 'ENDSEC', '0', 'EOF',
  ];
  return lines.join('\n');
}
