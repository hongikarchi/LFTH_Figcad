import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { createOpContentKey, elementContentKey } from '../src/connectorDedup';

/**
 * 커넥터(Rhino figcadpushbreps) 멱등화 — 재푸시가 같은 content를 다시 보내면 서버가 스킵해
 * 정확중첩을 막는다(iter-2 2). 여기선 키 매칭(기존 요소 ↔ create 옵)을 검증.
 */
describe('커넥터 멱등화 — content key 매칭', () => {
  function setup() {
    const store = new DocStore();
    const seed = seedDocument(store);
    return { store, seed };
  }

  it('같은 벽 재푸시 = 기존 요소와 key 일치(= dedup 스킵 대상)', () => {
    const { store, seed } = setup();
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [3000, 0] });
    const seen = new Set(store.listElements().map(elementContentKey));
    const key = createOpContentKey('create_wall', {
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [3000, 0],
    });
    expect(key).not.toBeNull();
    expect(seen.has(key!)).toBe(true); // 동일 content → 재푸시 스킵
  });

  it('좌표가 다르면(Rhino서 이동 후 푸시) 새 요소 — 스킵 안 함', () => {
    const { store, seed } = setup();
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [3000, 0] });
    const seen = new Set(store.listElements().map(elementContentKey));
    const moved = createOpContentKey('create_wall', {
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [4000, 0],
    });
    expect(seen.has(moved!)).toBe(false);
  });

  it('옵 좌표 부동소수(3000.4)도 정수 요소(3000)와 일치 (라운드 정렬)', () => {
    const { store, seed } = setup();
    store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [1000, 2000] });
    const seen = new Set(store.listElements().map(elementContentKey));
    const key = createOpContentKey('create_column', {
      levelId: seed.levelId,
      typeId: seed.columnTypeId,
      at: [1000.4, 1999.6],
    });
    expect(seen.has(key!)).toBe(true);
  });

  it('create 아닌 옵(update/delete) = null (항상 적용)', () => {
    expect(createOpContentKey('update_element', { id: 'x', a: [0, 0] })).toBeNull();
    expect(createOpContentKey('delete_elements', { ids: ['x'] })).toBeNull();
  });

  it('배치 내 중복도 첫 1개만 — seen 누적 시뮬레이션', () => {
    const { store, seed } = setup();
    const seen = new Set(store.listElements().map(elementContentKey));
    const op = {
      op: 'create_slab',
      args: { levelId: seed.levelId, typeId: seed.slabTypeId, boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] },
    };
    let deduped = 0;
    const applied: typeof op[] = [];
    for (const e of [op, op, op]) {
      const k = createOpContentKey(e.op, e.args);
      if (k !== null) {
        if (seen.has(k)) { deduped++; continue; }
        seen.add(k);
      }
      applied.push(e);
    }
    expect(applied).toHaveLength(1); // 3개 중 1개만
    expect(deduped).toBe(2);
  });
});
