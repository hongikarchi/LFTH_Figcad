import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { deriveSlab, slabDeriveKey } from '../src/geometry/deriveOthers';
import { deriveStair, stairDeriveKey } from '../src/geometry/deriveStructure';
import { executeOp } from '../src/ai';
import type { SlabElement, SlabType, StairElement, StairType } from '../src/schema';

/**
 * 커넥터 실측 z 보존 파라 — slab.zOffset(상면=레벨+zOffset) · stair.rise(총상승 오버라이드).
 * 근거: 실모델 260629 충실도 리포트 — 슬라브 z 최대 18.4m 어긋남·계단 상승 층고 고정 Δ3150.
 */

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}

const meshTopY = (positions: Float32Array): number => {
  let top = -Infinity;
  for (let i = 1; i < positions.length; i += 3) top = Math.max(top, positions[i]!);
  return top;
};
const meshBottomY = (positions: Float32Array): number => {
  let bot = Infinity;
  for (let i = 1; i < positions.length; i += 3) bot = Math.min(bot, positions[i]!);
  return bot;
};

describe('slab.zOffset — 상면 = 레벨 elevation + zOffset', () => {
  const type: SlabType = { id: 'T', kind: 'slab', name: 'S', thickness: 200, color: '#fff' };
  const level = { id: 'L', name: '1F', elevation: 0, order: 0, height: 3000 };
  const boundary: [number, number][] = [
    [0, 0],
    [4000, 0],
    [4000, 3000],
    [0, 3000],
  ];

  it('기본(zOffset 없음) = 상면 0 (현행 거동 보존)', () => {
    const slab = { id: 'e', kind: 'slab', levelId: 'L', typeId: 'T', boundary } as SlabElement;
    const g = deriveSlab({ slab, type, level });
    expect(meshTopY(g.positions)).toBeCloseTo(0, 6);
    expect(meshBottomY(g.positions)).toBeCloseTo(-0.2, 6);
  });

  it('zOffset -18400 → 상면 -18.4m (지하 슬라브 실측 z)', () => {
    const slab = { id: 'e', kind: 'slab', levelId: 'L', typeId: 'T', boundary, zOffset: -18400 } as SlabElement;
    const g = deriveSlab({ slab, type, level });
    expect(meshTopY(g.positions)).toBeCloseTo(-18.4, 6);
    expect(meshBottomY(g.positions)).toBeCloseTo(-18.6, 6);
  });

  it('deriveKey가 zOffset 포함 (메모이즈 무효화)', () => {
    const s1 = { id: 'e', kind: 'slab', levelId: 'L', typeId: 'T', boundary } as SlabElement;
    const s2 = { ...s1, zOffset: 500 } as SlabElement;
    expect(slabDeriveKey({ slab: s1, type, level })).not.toEqual(slabDeriveKey({ slab: s2, type, level }));
  });

  it('create_slab op + updateElement 경유 zOffset (quantize)', () => {
    const { store, seed } = setup();
    const id = executeOp(store, 'create_slab', {
      levelId: seed.levelId,
      typeId: seed.slabTypeId,
      boundary,
      zOffset: -18399.6,
    }) as string;
    const el = store.getElement(id) as SlabElement;
    expect(el.zOffset).toBe(-18400);
    store.updateElement(id, { zOffset: 250.4 });
    expect((store.getElement(id) as SlabElement).zOffset).toBe(250);
  });
});

describe('stair.rise — 총상승 오버라이드 (기본 = 층고)', () => {
  const type: StairType = { id: 'T', kind: 'stair', name: 'ST', width: 1200, riser: 170, color: '#fff' };
  const level = { id: 'L', name: '1F', elevation: 0, order: 0, height: 3000 };
  const base = { id: 'e', kind: 'stair', levelId: 'L', typeId: 'T', a: [0, 0], b: [2800, 0] } as StairElement;

  it('기본 = level.height 상승 (현행 거동 보존)', () => {
    const g = deriveStair({ stair: base, type, level });
    expect(meshTopY(g.positions)).toBeCloseTo(3.0, 6);
  });

  it('rise 1700 → 상승 1.7m + 단수 = round(1700/170) = 10', () => {
    const stair = { ...base, rise: 1700 } as StairElement;
    const g = deriveStair({ stair, type, level });
    expect(meshTopY(g.positions)).toBeCloseTo(1.7, 6);
    expect(g.anchors!.b[1]).toBeCloseTo(1.7, 6); // 상단 앵커도 rise 추종
  });

  it('deriveKey가 rise 포함', () => {
    expect(stairDeriveKey({ stair: base, type, level })).not.toEqual(
      stairDeriveKey({ stair: { ...base, rise: 1700 } as StairElement, type, level }),
    );
  });

  it('create_stair op rise (quantize) + rise ≤0 거부', () => {
    const { store, seed } = setup();
    const id = executeOp(store, 'create_stair', {
      levelId: seed.levelId,
      typeId: seed.stairTypeId,
      a: [0, 0],
      b: [2800, 0],
      rise: 1699.7,
    }) as string;
    expect((store.getElement(id) as StairElement).rise).toBe(1700);
    expect(() =>
      executeOp(store, 'create_stair', {
        levelId: seed.levelId,
        typeId: seed.stairTypeId,
        a: [0, 0],
        b: [2800, 0],
        rise: 0,
      }),
    ).toThrow();
    // update 경유 무효 rise = 패치 거부(기존값 유지)
    store.updateElement(id, { rise: -100 });
    expect((store.getElement(id) as StairElement).rise).toBe(1700);
  });
});
