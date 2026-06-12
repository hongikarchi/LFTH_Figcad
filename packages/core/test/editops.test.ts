import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import type { OpeningElement, WallElement } from '../src/schema';

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  const wall = store.createWall({
    levelId: seed.levelId,
    typeId: seed.wallTypeIds[0]!,
    a: [0, 0],
    b: [6000, 0],
  });
  return { store, seed, wall };
}

const wallOf = (store: DocStore, id: string) => store.getElement(id) as WallElement;

describe('moveElements', () => {
  it('벽 이동 — 개구부는 자동 추종 (상대 좌표)', () => {
    const { store, seed, wall } = setup();
    const door = store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 2000 });
    store.moveElements([wall], [1000, 500]);
    expect(wallOf(store, wall).a).toEqual([1000, 500]);
    expect((store.getElement(door) as OpeningElement).offset).toBe(2000); // 불변
  });

  it('슬라브/그리드 이동', () => {
    const { store, seed } = setup();
    const slab = store.createSlab({
      levelId: seed.levelId,
      typeId: seed.slabTypeId,
      boundary: [
        [0, 0],
        [4000, 0],
        [4000, 4000],
        [0, 4000],
      ],
    });
    const grid = store.createGridLine({ a: [0, 0], b: [0, 5000] });
    store.moveElements([slab, grid], [500, 500]);
    const s = store.getElement(slab);
    expect(s?.kind === 'slab' && s.boundary[0]).toEqual([500, 500]);
    const g = store.getElement(grid);
    expect(g?.kind === 'grid' && g.a).toEqual([500, 500]);
  });
});

describe('duplicateElements / arrayElements', () => {
  it('벽 복사 — 개구부 동반, 새 호스트로 재호스트', () => {
    const { store, seed, wall } = setup();
    store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 2000 });
    const created = store.duplicateElements([wall], [0, 3000]);
    expect(created).toHaveLength(2); // 벽 + 문
    const newWall = created
      .map((id) => store.getElement(id))
      .find((e) => e?.kind === 'wall') as WallElement;
    const newDoor = created
      .map((id) => store.getElement(id))
      .find((e) => e?.kind === 'opening') as OpeningElement;
    expect(newWall.a).toEqual([0, 3000]);
    expect(newDoor.hostId).toBe(newWall.id);
    expect(newDoor.offset).toBe(2000);
  });

  it('배열 — count개, 누적 간격, undo 1스텝', () => {
    const { store, wall } = setup();
    const undo = store.createUndoManager();
    const created = store.arrayElements([wall], [0, 3000], 3);
    expect(created).toHaveLength(3);
    const ys = created.map((id) => wallOf(store, id).a[1]).sort((a, b) => a - b);
    expect(ys).toEqual([3000, 6000, 9000]);
    undo.undo();
    expect(store.listElements().filter((e) => e.kind === 'wall')).toHaveLength(1); // 원본만
  });
});

describe('splitWall', () => {
  it('두 벽으로 분할 + 개구부 재호스트 (양쪽)', () => {
    const { store, seed, wall } = setup();
    const d1 = store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 1500 });
    const d2 = store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 4500 });
    const result = store.splitWall(wall, [3000, 50]); // 중심선 투영 → s=3000
    expect(result).not.toBeNull();
    const [w1, w2] = result!;
    expect(wallOf(store, w1).b).toEqual([3000, 0]);
    expect(wallOf(store, w2).a).toEqual([3000, 0]);
    expect(store.getElement(wall)).toBeUndefined(); // 원본 삭제
    expect(store.getElement(d1)).toBeUndefined(); // 재호스트로 새 id
    expect(store.getElement(d2)).toBeUndefined();
    const o1 = store.openingsOf(w1)[0]!;
    const o2 = store.openingsOf(w2)[0]!;
    expect(o1.offset).toBe(1500);
    expect(o2.offset).toBe(1500); // 4500 - 3000
  });

  it('끝 100mm 이내 분할 거부', () => {
    const { store, wall } = setup();
    expect(store.splitWall(wall, [50, 0])).toBeNull();
    expect(store.splitWall(wall, [5950, 0])).toBeNull();
  });
});

describe('trimExtendWall', () => {
  it('b끝 연장 — 타겟 직선 교차점까지, 개구부 offset 불변', () => {
    const { store, seed, wall } = setup();
    const door = store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 2000 });
    // 타겟: x=8000 수직선
    const ok = store.trimExtendWall(wall, 'b', { a: [8000, -1000], b: [8000, 1000] });
    expect(ok).toBe(true);
    expect(wallOf(store, wall).b).toEqual([8000, 0]);
    expect((store.getElement(door) as OpeningElement).offset).toBe(2000);
  });

  it('a끝 자르기 — 개구부 offset 보정 (a 기준 거리 유지)', () => {
    const { store, seed, wall } = setup();
    const door = store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 3000 });
    // 타겟: x=1000 수직선 → a가 (0,0)→(1000,0)으로 잘림 → shift = -1000
    const ok = store.trimExtendWall(wall, 'a', { a: [1000, -1000], b: [1000, 1000] });
    expect(ok).toBe(true);
    expect(wallOf(store, wall).a).toEqual([1000, 0]);
    expect((store.getElement(door) as OpeningElement).offset).toBe(2000); // 같은 절대 위치
  });

  it('평행 타겟 거부', () => {
    const { store, wall } = setup();
    expect(store.trimExtendWall(wall, 'b', { a: [0, 1000], b: [6000, 1000] })).toBe(false);
  });
});

describe('mirrorElements', () => {
  it('y축 대칭 복사 — 개구부 offset 보존 + flip 토글', () => {
    const { store, seed, wall } = setup();
    store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 2000 });
    const created = store.mirrorElements([wall], [0, 0], [0, 1000]); // x=0 축
    const newWall = created
      .map((id) => store.getElement(id))
      .find((e) => e?.kind === 'wall') as WallElement;
    const newDoor = created
      .map((id) => store.getElement(id))
      .find((e) => e?.kind === 'opening') as OpeningElement;
    expect(newWall.a).toEqual([0, 0]);
    expect(newWall.b).toEqual([-6000, 0]);
    expect(newDoor.offset).toBe(2000); // 등거리 보존
    expect(newDoor.flip).toBe(true); // 스윙 반전
  });
});

describe('rotateElements', () => {
  it('90도 제자리 회전', () => {
    const { store, wall } = setup();
    store.rotateElements([wall], [0, 0], Math.PI / 2);
    const w = wallOf(store, wall);
    expect(w.a).toEqual([0, 0]);
    expect(w.b).toEqual([0, 6000]); // (6000,0) → (0,6000)
  });
});
