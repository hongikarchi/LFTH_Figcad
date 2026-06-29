import { describe, expect, it } from 'vitest';
import {
  DocStore,
  seedDocument,
  SEED_IDS,
  type GridLine,
  type SlabElement,
  type WallElement,
} from '@figcad/core';
import { exportDrawingDxf, exportDxf, importDxf } from '../src';

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

  it('exportDrawingDxf — 평면뷰 cut/hatch 레이어 + 폴리라인 엔티티', () => {
    const s = new DocStore();
    seedDocument(s);
    const L = SEED_IDS.level;
    s.createWall({ levelId: L, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    s.createWall({ levelId: L, typeId: SEED_IDS.wall200, a: [4000, 0], b: [4000, 3000] });
    const vid = s.createView({ name: '평면', type: 'plan', levelId: L, cutHeight: 1200 });
    const dxf = exportDrawingDxf(s.getView(vid)!, s);
    expect(dxf).toContain('Cut');
    expect(dxf).toContain('Hatch');
    expect(dxf).toMatch(/POLYLINE/); // 절단 벽 윤곽
    expect(dxf.length).toBeGreaterThan(200);
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

  it('기둥/보 — Column/Beam 레이어로 export, 조용히 누락 안 됨', () => {
    const s = new DocStore();
    seedDocument(s);
    s.createColumn({ levelId: SEED_IDS.level, typeId: SEED_IDS.column400, at: [1000, 1000] });
    s.createBeam({ levelId: SEED_IDS.level, typeId: SEED_IDS.beam300, a: [0, 0], b: [5000, 0] });
    const dxf = exportDxf(s.snapshot());
    expect(dxf).toContain('Column');
    expect(dxf).toContain('Beam');
    // 재import: 구조요소 2건 인식 스킵 (드롭 아님)
    const { skipped, snapshot } = importDxf(dxf);
    const structKey = Object.keys(skipped).find((k) => k.includes('구조요소'));
    expect(structKey).toBeDefined();
    expect(skipped[structKey!]).toBe(2);
    // 기둥 폴리라인이 슬라브로 오분류되지 않음
    expect(snapshot.elements.filter((e) => e.kind === 'slab')).toHaveLength(0);
  });

  it('계단/난간/지붕 — 전용 레이어로 export, 슬라브로 오분류·드롭 안 됨', () => {
    const s = new DocStore();
    seedDocument(s);
    s.createStair({ levelId: SEED_IDS.level, typeId: SEED_IDS.stair, a: [0, 0], b: [3000, 0] });
    s.createRailing({ levelId: SEED_IDS.level, typeId: SEED_IDS.railing, a: [0, 0], b: [3600, 0] });
    s.createRoof({ levelId: SEED_IDS.level, typeId: SEED_IDS.roof, boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] });
    const dxf = exportDxf(s.snapshot());
    expect(dxf).toContain('Stair');
    expect(dxf).toContain('Railing');
    expect(dxf).toContain('Roof');
    const { skipped, snapshot } = importDxf(dxf);
    const structKey = Object.keys(skipped).find((k) => k.includes('구조요소'));
    expect(structKey).toBeDefined();
    expect(skipped[structKey!]).toBeGreaterThanOrEqual(3);
    // 닫힌 폴리라인(계단 풋프린트·지붕 경계)이 슬라브로 새지 않음
    expect(snapshot.elements.filter((e) => e.kind === 'slab')).toHaveLength(0);
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

  it('다정점 열린 폴리라인 = 벽 체인 (중간 정점 보존, review-3 [8])', () => {
    // 레이어 0, 열린(70=0) 3정점 LWPOLYLINE → 2 세그먼트 벽(예전엔 첫·끝만 = 1개로 붕괴)
    const dxf = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', '0', '90', '3', '70', '0',
      '10', '0', '20', '0', '10', '3000', '20', '0', '10', '3000', '20', '2000',
      '0', 'ENDSEC', '0', 'EOF', '',
    ].join('\n');
    const { snapshot } = importDxf(dxf);
    expect(snapshot.elements.filter((e) => e.kind === 'wall')).toHaveLength(2);
  });

  it('$INSUNITS 미터(6) DXF = mm로 정규화 (외부 비-mm 파일, review-3 [9])', () => {
    // HEADER $INSUNITS=6(m) + 0~5m 열린 폴리라인 → 벽 [0,0]-[5000,0]mm (×1000)
    const dxf = [
      '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', '0', '90', '2', '70', '0', '10', '0', '20', '0', '10', '5', '20', '0',
      '0', 'ENDSEC', '0', 'EOF', '',
    ].join('\n');
    const w = importDxf(dxf).snapshot.elements.find((e) => e.kind === 'wall') as { a: [number, number]; b: [number, number] } | undefined;
    expect(w).toBeDefined();
    expect(w!.a).toEqual([0, 0]);
    expect(w!.b).toEqual([5000, 0]); // 5m → 5000mm
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
