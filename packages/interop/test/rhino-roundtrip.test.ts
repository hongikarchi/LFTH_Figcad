import { describe, expect, it } from 'vitest';
import {
  DocStore,
  seedDocument,
  SEED_IDS,
  type GridLine,
  type SlabElement,
  type WallElement,
} from '@figcad/core';
import { exportRhino, importRhino } from '../src';

function sample(): DocStore {
  const s = new DocStore();
  seedDocument(s);
  const L = SEED_IDS.level;
  s.createWall({ levelId: L, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
  s.createWall({ levelId: L, typeId: SEED_IDS.wall200, a: [4000, 0], b: [4000, 3000] });
  s.createSlab({ levelId: L, typeId: SEED_IDS.slab150, boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] });
  s.createGridLine({ a: [0, -500], b: [0, 3500], label: 'A' });
  return s;
}

describe('.3dm 라운드트립 (지오메트리 레벨)', () => {
  it('벽 중심선 보존 (두께는 기본값 — 의도된 손실)', async () => {
    const s = sample();
    const { snapshot } = await importRhino(await exportRhino(s.snapshot()));
    const walls = snapshot.elements.filter((e): e is WallElement => e.kind === 'wall');
    expect(walls).toHaveLength(2);
    const keys = walls.map((w) => `${w.a}|${w.b}`).sort();
    expect(keys).toEqual(['0,0|4000,0', '4000,0|4000,3000'].sort());
    // 두께는 .3dm에 보존 안 됨 → 기본 200으로
    const t = snapshot.types.find((x) => x.id === walls[0]!.typeId)!;
    expect('thickness' in t && t.thickness).toBe(200);
  });

  it('슬라브 경계 보존', async () => {
    const s = sample();
    const { snapshot } = await importRhino(await exportRhino(s.snapshot()));
    const slab = snapshot.elements.find((e): e is SlabElement => e.kind === 'slab')!;
    expect(slab.boundary).toEqual([[0, 0], [4000, 0], [4000, 3000], [0, 3000]]);
  });

  it('그리드 보존', async () => {
    const s = sample();
    const { snapshot } = await importRhino(await exportRhino(s.snapshot()));
    const grids = snapshot.elements.filter((e): e is GridLine => e.kind === 'grid');
    expect(grids).toHaveLength(1);
    expect(grids[0]!.a).toEqual([0, -500]);
    expect(grids[0]!.b).toEqual([0, 3500]);
  });

  it('다층 — z별 레벨 복원', async () => {
    const s = sample();
    s.addLevel({ name: '2층', elevation: 3000, height: 3000, order: 1 });
    const l2 = s.listLevels().find((l) => l.elevation === 3000)!;
    s.createWall({ levelId: l2.id, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    const { snapshot } = await importRhino(await exportRhino(s.snapshot()));
    const elevs = snapshot.levels.map((l) => l.elevation).sort((a, b) => a - b);
    expect(elevs).toContain(0);
    expect(elevs).toContain(3000);
    // 2층 벽이 올바른 레벨에
    const l2new = snapshot.levels.find((l) => l.elevation === 3000)!;
    const wallsL2 = snapshot.elements.filter((e): e is WallElement => e.kind === 'wall' && e.levelId === l2new.id);
    expect(wallsL2).toHaveLength(1);
  });

  it('기둥/보 — 곡선으로 export, 조용히 누락 안 됨 (import은 v1 스킵+카운트)', async () => {
    const s = new DocStore();
    seedDocument(s);
    s.createColumn({ levelId: SEED_IDS.level, typeId: SEED_IDS.column400, at: [1000, 1000] });
    s.createBeam({ levelId: SEED_IDS.level, typeId: SEED_IDS.beam300, a: [0, 0], b: [5000, 0] });
    const { skipped } = await importRhino(await exportRhino(s.snapshot()));
    // 기둥(닫힌 폴리라인) + 보(라인) = 구조요소 2건이 인식되어 스킵 카운트 (드롭 아님)
    const structKey = Object.keys(skipped).find((k) => k.includes('구조요소'));
    expect(structKey).toBeDefined();
    expect(skipped[structKey!]).toBe(2);
  });

  it('계단/난간/지붕 — 곡선으로 export, 슬라브로 오분류·드롭 안 됨 (import v1 스킵)', async () => {
    const s = new DocStore();
    seedDocument(s);
    s.createStair({ levelId: SEED_IDS.level, typeId: SEED_IDS.stair, a: [0, 0], b: [3000, 0] });
    s.createRailing({ levelId: SEED_IDS.level, typeId: SEED_IDS.railing, a: [0, 0], b: [3600, 0] });
    s.createRoof({ levelId: SEED_IDS.level, typeId: SEED_IDS.roof, boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] });
    const { skipped, snapshot } = await importRhino(await exportRhino(s.snapshot()));
    const structKey = Object.keys(skipped).find((k) => k.includes('구조요소'));
    expect(structKey).toBeDefined();
    // 계단 풋프린트(닫힘) + 난간 축(열림) + 지붕 경계(닫힘) = 3건 스킵
    expect(skipped[structKey!]).toBe(3);
    // 닫힌 곡선이 슬라브로 새지 않음
    expect(snapshot.elements.filter((e) => e.kind === 'slab')).toHaveLength(0);
  });

  it('유효 .3dm 바이트 (재오픈 가능)', async () => {
    const s = sample();
    const bytes = await exportRhino(s.snapshot());
    expect(bytes.length).toBeGreaterThan(100);
    const { snapshot } = await importRhino(bytes);
    expect(snapshot.elements.length).toBeGreaterThan(0);
  });
});
