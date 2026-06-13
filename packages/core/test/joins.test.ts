import { describe, expect, it } from 'vitest';
import { DeriveCache, deriveWall, endCorners } from '../src/geometry';
import { DocStore, seedDocument } from '../src/store';
import type { Level, WallElement, WallType } from '../src/schema';

describe('endCorners', () => {
  it('자유 끝 — 사각 캡 (±t/2)', () => {
    const c = endCorners([0, 0], [1, 0], 200, null);
    expect(c.plus).toEqual([0, 100]);
    expect(c.minus).toEqual([0, -100]);
  });

  it('90도 L자 마이터 — 안/밖 코너', () => {
    // 이 벽: +x 방향, 이웃: +y 방향, 둘 다 t=200
    const c = endCorners([0, 0], [1, 0], 200, { dir: [0, 1], thickness: 200 });
    expect(c.plus[0]).toBeCloseTo(100);
    expect(c.plus[1]).toBeCloseTo(100);
    expect(c.minus[0]).toBeCloseTo(-100);
    expect(c.minus[1]).toBeCloseTo(-100);
  });

  it('두께 다른 90도 조인 — 이웃 두께 반영', () => {
    const c = endCorners([0, 0], [1, 0], 200, { dir: [0, 1], thickness: 100 });
    // 이 벽 엣지 y=±100, 이웃 엣지 x=±50
    expect(c.plus).toEqual([50, 100]);
    expect(c.minus).toEqual([-50, -100]);
  });

  it('일직선(평행) — butt 폴백', () => {
    const c = endCorners([4000, 0], [-1, 0], 200, { dir: [1, 0], thickness: 200 });
    expect(c.plus[0]).toBeCloseTo(4000);
    expect(c.minus[0]).toBeCloseTo(4000);
  });

  it('예각 마이터 폭주 — butt 폴백', () => {
    // 10도 — 마이터 길이 t/2/sin(5°) ≈ 1147mm > 4*200
    const rad = (10 * Math.PI) / 180;
    const c = endCorners([0, 0], [1, 0], 200, {
      dir: [Math.cos(rad), Math.sin(rad)],
      thickness: 200,
    });
    expect(c.plus).toEqual([0, 100]);
  });
});

describe('deriveWall + joins', () => {
  const level: Level = { id: 'L1', name: '1층', elevation: 0, height: 3000, order: 0 };
  const type: WallType = { id: 'T1', kind: 'wall', name: '벽200', thickness: 200, color: '#fff' };
  const wall: WallElement = {
    id: 'W1',
    kind: 'wall',
    levelId: 'L1',
    typeId: 'T1',
    a: [0, 0],
    b: [4000, 0],
  };

  function bboxX(positions: Float32Array): [number, number] {
    let min = Infinity,
      max = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      min = Math.min(min, positions[i]!);
      max = Math.max(max, positions[i]!);
    }
    return [min, max];
  }

  it('조인 없음 — 사각 캡 (x: 0~4m)', () => {
    const geo = deriveWall({ wall, type, level });
    const [minX, maxX] = bboxX(geo.positions);
    expect(minX).toBeCloseTo(0, 5);
    expect(maxX).toBeCloseTo(4, 5);
  });

  it('A끝 90도 조인 — 외측 마이터 코너가 -0.1m까지 확장', () => {
    const geo = deriveWall({
      wall,
      type,
      level,
      joins: { a: { dir: [0, 1], thickness: 200 }, b: null },
    });
    const [minX] = bboxX(geo.positions);
    expect(minX).toBeCloseTo(-0.1, 5);
  });

  it('상면 법선이 +Y (풋프린트 압출 와인딩 검증)', () => {
    const geo = deriveWall({ wall, type, level });
    // 첫 삼각형 = 프로필 앞면 = 상면
    expect(geo.normals[1]).toBeCloseTo(1, 5);
  });
});

describe('DeriveCache 조인 자동 감지', () => {
  it('끝점 공유 벽 → 마이터, 이웃 이동 → 재파생', () => {
    const store = new DocStore();
    const { levelId, wallTypeIds } = seedDocument(store);
    const t = wallTypeIds[0]!;
    const w1 = store.createWall({ levelId, typeId: t, a: [0, 0], b: [4000, 0] });
    const w2 = store.createWall({ levelId, typeId: t, a: [0, 0], b: [0, 4000] });

    const cache = new DeriveCache();
    const geo1 = cache.derive(store, w1)!;
    let minX = Infinity;
    for (let i = 0; i < geo1.positions.length; i += 3) {
      minX = Math.min(minX, geo1.positions[i]!);
    }
    expect(minX).toBeCloseTo(-0.1, 5); // 마이터 외측 코너

    // 이웃을 떼어내면 butt로 복귀
    store.updateElement(w2, { a: [10000, 0], b: [10000, 4000] });
    const geo1b = cache.derive(store, w1)!;
    minX = Infinity;
    for (let i = 0; i < geo1b.positions.length; i += 3) {
      minX = Math.min(minX, geo1b.positions[i]!);
    }
    expect(minX).toBeCloseTo(0, 5);
  });

  it('한 점에 벽 3개 — butt 폴백', () => {
    const store = new DocStore();
    const { levelId, wallTypeIds } = seedDocument(store);
    const t = wallTypeIds[0]!;
    const w1 = store.createWall({ levelId, typeId: t, a: [0, 0], b: [4000, 0] });
    store.createWall({ levelId, typeId: t, a: [0, 0], b: [0, 4000] });
    store.createWall({ levelId, typeId: t, a: [0, 0], b: [0, -4000] });

    const cache = new DeriveCache();
    const geo = cache.derive(store, w1)!;
    let minX = Infinity;
    for (let i = 0; i < geo.positions.length; i += 3) {
      minX = Math.min(minX, geo.positions[i]!);
    }
    expect(minX).toBeCloseTo(0, 5); // 마이터 없음
  });
});

describe('DeriveIndex — 인덱스 경로 = 전체 스캔 경로', () => {
  it('조인·개구부가 있는 문서에서 두 경로가 같은 캐시 키/지오메트리를 낸다', async () => {
    const { buildDeriveIndex } = await import('../src/geometry');
    const { SEED_IDS } = await import('../src/store');
    const store = new DocStore();
    seedDocument(store);
    // L자 조인 2벽 + 자유 끝 1벽 + 개구부
    const w1 = store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    const w2 = store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [4000, 0], b: [4000, 3000] });
    const w3 = store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall100, a: [0, 6000], b: [3000, 6000] });
    store.createOpening({ hostId: w1, typeId: SEED_IDS.door900, offset: 2000 });

    const index = buildDeriveIndex(store);
    for (const id of [w1, w2, w3]) {
      const plain = new DeriveCache().derive(store, id); // 전체 스캔 폴백
      const indexed = new DeriveCache().derive(store, id, index); // 인덱스 경로
      expect(indexed?.positions).toEqual(plain?.positions);
      expect(indexed?.anchors).toEqual(plain?.anchors);
    }
  });
});
