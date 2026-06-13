import { describe, expect, it } from 'vitest';
import { DeriveCache, deriveSlab, deriveGrid } from '../src/geometry';
import { DocStore, isSimplePolygon, seedDocument } from '../src/store';
import type { SlabType, Level, GridLine } from '../src/schema';

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}

describe('시드 v2', () => {
  it('문/창/슬라브 타입 추가됨', () => {
    const { store, seed } = setup();
    expect(store.getType(seed.doorTypeId)?.kind).toBe('opening');
    expect(store.getType(seed.windowTypeId)?.kind).toBe('opening');
    expect(store.getType(seed.slabTypeId)?.kind).toBe('slab');
  });

  it('구버전 문서(벽 타입만)에 새 타입 보충', () => {
    const { store } = setup();
    // 시드 2회 호출해도 멱등
    const again = seedDocument(store);
    expect(store.listTypes()).toHaveLength(10); // 벽2 + 문 + 창 + 슬라브 + 기둥 + 보 + 계단 + 난간 + 지붕
    expect(again.doorTypeId).toBeDefined();
    expect(again.columnTypeId).toBeDefined();
    expect(again.beamTypeId).toBeDefined();
    expect(again.stairTypeId).toBeDefined();
    expect(again.railingTypeId).toBeDefined();
    expect(again.roofTypeId).toBeDefined();
  });
});

/** non-indexed 메시의 부호 부피 (다이버전스 정리) — 솔리드 정합성 검증 */
function signedVolume(positions: Float32Array): number {
  let v = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i]!,
      ay = positions[i + 1]!,
      az = positions[i + 2]!;
    const bx = positions[i + 3]!,
      by = positions[i + 4]!,
      bz = positions[i + 5]!;
    const cx = positions[i + 6]!,
      cy = positions[i + 7]!,
      cz = positions[i + 8]!;
    v += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

describe('개구부 — 메시 정합성 (리뷰 회귀)', () => {
  it('겹치는 개구부 — 뒤 개구부 스킵, 부피 = 문 1개와 동일', () => {
    const { store, seed } = setup();
    const wall = store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [6000, 0],
    });
    const cache = new DeriveCache();
    store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 3000 });
    const oneDoor = signedVolume(cache.derive(store, wall)!.positions);
    store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 3300 }); // 겹침
    const overlapped = signedVolume(cache.derive(store, wall)!.positions);
    expect(Math.abs(overlapped)).toBeCloseTo(Math.abs(oneDoor), 6);
  });

  it('L-마이터 끝의 문 — 양면 일관 클램프 (부피 = 벽 − 클램프된 구멍)', () => {
    const { store, seed } = setup();
    const wall = store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [3000, 0],
    });
    store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [0, 3000],
    }); // 직각 이웃 → a끝 마이터 (내측 면 s=+100부터)
    const cache = new DeriveCache();
    const solid = signedVolume(cache.derive(store, wall)!.positions);
    store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 0 }); // 최소로 클램프(500)
    const withDoor = signedVolume(cache.derive(store, wall)!.positions);
    // 클램프: sL=50 → usableLo=110, sR=950 → 제거 부피 = 0.84m × 2.1m × 0.2m
    const expectedRemoved = 0.84 * 2.1 * 0.2;
    expect(Math.abs(solid) - Math.abs(withDoor)).toBeCloseTo(expectedRemoved, 4);
  });
});

describe('개구부', () => {
  it('벽에 문 생성 → 벽 메시에 구멍 (삼각형 수 증가) + 패널 메시 존재', () => {
    const { store, seed } = setup();
    const wall = store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [6000, 0],
    });
    const cache = new DeriveCache();
    const solidTris = cache.derive(store, wall)!.positions.length / 9;

    const door = store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 3000 });
    const withHole = cache.derive(store, wall)!;
    expect(withHole.positions.length / 9).toBeGreaterThan(solidTris); // 구멍+리빌

    const panel = cache.derive(store, door)!;
    expect(panel.positions.length).toBeGreaterThan(0);
    // 패널 중심 anchors가 벽 위 offset 위치 (x=3m)
    expect(panel.anchors.a[0]).toBeCloseTo(3, 3);
  });

  it('offset이 벽 밖이어도 derive가 클램프', () => {
    const { store, seed } = setup();
    const wall = store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [3000, 0],
    });
    const door = store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 10000 });
    const cache = new DeriveCache();
    const panel = cache.derive(store, door)!;
    // 클램프: 중심 ≤ len - w/2 - 50 = 3000-450-50 = 2500
    expect(panel.anchors.a[0]).toBeLessThanOrEqual(2.5 + 1e-6);
  });

  it('벽 삭제 → 개구부 연쇄 삭제', () => {
    const { store, seed } = setup();
    const wall = store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [6000, 0],
    });
    const door = store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 2000 });
    store.deleteElements([wall]);
    expect(store.getElement(door)).toBeUndefined();
  });

  it('벽 이동 → 개구부 derive 키 변경 (자동 추종)', () => {
    const { store, seed } = setup();
    const wall = store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [6000, 0],
    });
    const door = store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 3000 });
    const cache = new DeriveCache();
    const before = cache.derive(store, door)!;
    store.updateElement(wall, { a: [0, 1000], b: [6000, 1000] });
    const after = cache.derive(store, door)!;
    expect(after).not.toBe(before); // 재파생됨
    expect(after.anchors.a[2]).toBeCloseTo(1, 3); // z(문서 y) = 1m 따라감
  });
});

describe('슬라브', () => {
  const level: Level = { id: 'L', name: '1층', elevation: 3000, height: 3000, order: 0 };
  const type: SlabType = { id: 'T', kind: 'slab', name: 's', thickness: 150, color: '#fff' };

  it('상면 = 레벨 elevation, 아래로 두께', () => {
    const geo = deriveSlab({
      slab: {
        id: 'S',
        kind: 'slab',
        levelId: 'L',
        typeId: 'T',
        boundary: [
          [0, 0],
          [4000, 0],
          [4000, 4000],
          [0, 4000],
        ],
      },
      type,
      level,
    });
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < geo.positions.length; i += 3) {
      minY = Math.min(minY, geo.positions[i]!);
      maxY = Math.max(maxY, geo.positions[i]!);
    }
    expect(maxY).toBeCloseTo(3, 5); // 상면 = 3m
    expect(minY).toBeCloseTo(2.85, 5); // 3m - 150mm
  });

  it('자가교차 폴리곤 거부', () => {
    const { store, seed } = setup();
    expect(() =>
      store.createSlab({
        levelId: seed.levelId,
        typeId: seed.slabTypeId,
        boundary: [
          [0, 0],
          [4000, 4000],
          [4000, 0],
          [0, 4000],
        ], // 나비 모양
      }),
    ).toThrow();
  });
});

describe('isSimplePolygon', () => {
  it('사각형 OK / 나비 거부', () => {
    expect(
      isSimplePolygon([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
    ).toBe(true);
    expect(
      isSimplePolygon([
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 10],
      ]),
    ).toBe(false);
  });
});

describe('그리드', () => {
  it('자동 라벨: 세로선 = 숫자, 가로선 = 알파벳', () => {
    const { store } = setup();
    store.createGridLine({ a: [0, 0], b: [0, 10000] }); // 세로
    store.createGridLine({ a: [3000, 0], b: [3000, 10000] });
    store.createGridLine({ a: [0, 0], b: [10000, 0] }); // 가로
    const grids = store.listElements().filter((e) => e.kind === 'grid') as GridLine[];
    const labels = grids.map((g) => g.label).sort();
    expect(labels).toEqual(['1', '2', 'A']);
  });

  it('그리드 교차점이 스냅 후보에 포함', () => {
    const { store, seed } = setup();
    store.createGridLine({ a: [0, -5000], b: [0, 5000] });
    store.createGridLine({ a: [-5000, 0], b: [5000, 0] });
    const pts = store.wallEndpoints(seed.levelId);
    expect(pts).toContainEqual([0, 0]);
  });

  it('derive: 라인 엣지 + 픽킹 리본 + 버블 앵커(1m 연장)', () => {
    const geo = deriveGrid({ id: 'G', kind: 'grid', label: '1', a: [0, 0], b: [5000, 0] });
    expect(geo.edges.length).toBe(6); // 선분 1개
    expect(geo.positions.length).toBeGreaterThan(0); // 리본
    expect(geo.anchors.a[0]).toBeCloseTo(-1, 5); // a쪽 1m 연장
    expect(geo.anchors.b[0]).toBeCloseTo(6, 5);
  });
});

describe('레벨 편집', () => {
  it('updateLevel — elevation 변경이 mirror에 반영', () => {
    const { store, seed } = setup();
    store.updateLevel(seed.levelId, { elevation: 3300, name: '2층' });
    const level = store.getLevel(seed.levelId)!;
    expect(level.elevation).toBe(3300);
    expect(level.name).toBe('2층');
  });

  it('deleteLevel — 레벨 요소(개구부 포함) 연쇄 삭제', () => {
    const { store, seed } = setup();
    const wall = store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [6000, 0],
    });
    const door = store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 2000 });
    store.deleteLevel(seed.levelId);
    expect(store.getLevel(seed.levelId)).toBeUndefined();
    expect(store.getElement(wall)).toBeUndefined();
    expect(store.getElement(door)).toBeUndefined();
  });
});
