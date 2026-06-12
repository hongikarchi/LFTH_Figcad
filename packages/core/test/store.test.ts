import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, ...seed };
}

describe('DocStore', () => {
  it('시드: 레벨 1개 + 벽 타입 2개', () => {
    const { store } = setup();
    expect(store.listLevels()).toHaveLength(1);
    expect(store.listTypes('wall')).toHaveLength(2);
  });

  it('벽 생성 — 좌표가 mm 정수로 양자화된다', () => {
    const { store, levelId, wallTypeIds } = setup();
    const id = store.createWall({
      levelId,
      typeId: wallTypeIds[0]!,
      a: [0.4, 99.6],
      b: [4000.2, 0.1],
    });
    const wall = store.getElement(id);
    expect(wall).toBeDefined();
    if (wall?.kind === 'wall') {
      expect(wall.a).toEqual([0, 100]);
      expect(wall.b).toEqual([4000, 0]);
    }
  });

  it('관찰자 — 추가/수정/삭제 이벤트', () => {
    const { store, levelId, wallTypeIds } = setup();
    const events: string[] = [];
    store.observe((c) => {
      if (c.added.length) events.push('added');
      if (c.updated.length) events.push('updated');
      if (c.removed.length) events.push('removed');
    });
    const id = store.createWall({ levelId, typeId: wallTypeIds[0]!, a: [0, 0], b: [1000, 0] });
    store.updateElement(id, { height: 2400 });
    store.deleteElements([id]);
    expect(events).toEqual(['added', 'updated', 'removed']);
    expect(store.getElement(id)).toBeUndefined();
  });

  it('updateElement — 존재하지 않는 id는 무시', () => {
    const { store } = setup();
    expect(() => store.updateElement('nope', { height: 100 })).not.toThrow();
  });

  it('wallEndpoints — 같은 레벨, 자기 제외', () => {
    const { store, levelId, wallTypeIds } = setup();
    const w1 = store.createWall({ levelId, typeId: wallTypeIds[0]!, a: [0, 0], b: [1000, 0] });
    store.createWall({ levelId, typeId: wallTypeIds[0]!, a: [1000, 0], b: [1000, 2000] });
    const pts = store.wallEndpoints(levelId, w1);
    expect(pts).toHaveLength(2);
    expect(pts).toContainEqual([1000, 0]);
    expect(pts).toContainEqual([1000, 2000]);
  });
});
