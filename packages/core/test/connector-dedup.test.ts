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
    const seen = new Set(store.listElements().map((el) => elementContentKey(el)));
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
    const seen = new Set(store.listElements().map((el) => elementContentKey(el)));
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
    const seen = new Set(store.listElements().map((el) => elementContentKey(el)));
    const key = createOpContentKey('create_column', {
      levelId: seed.levelId,
      typeId: seed.columnTypeId,
      at: [1000.4, 1999.6],
    });
    expect(seen.has(key!)).toBe(true);
  });

  it('그리드 재푸시 = key 일치 (op id = create_grid_line, levelId/typeId 없음)', () => {
    const { store } = setup();
    store.createGridLine({ a: [200, 200], b: [200, 5200] });
    const seen = new Set(store.listElements().map((el) => elementContentKey(el)));
    const key = createOpContentKey('create_grid_line', { a: [200, 200], b: [200, 5200] });
    expect(key).not.toBeNull(); // 예전 dead 키('create_grid')면 null → 회귀 가드
    expect(seen.has(key!)).toBe(true);
  });

  it('존 재푸시 = key 일치 (typeId 없는 kind — 양쪽 빈 typeId 일치)', () => {
    const { store, seed } = setup();
    store.createZone({ levelId: seed.levelId, boundary: [[0, 0], [2000, 0], [2000, 2000], [0, 2000]], name: 'Z' });
    const seen = new Set(store.listElements().map((el) => elementContentKey(el)));
    const key = createOpContentKey('create_zone', {
      levelId: seed.levelId,
      boundary: [[0, 0], [2000, 0], [2000, 2000], [0, 2000]],
    });
    expect(key).not.toBeNull();
    expect(seen.has(key!)).toBe(true);
  });

  it('겹층 보 — 같은 평면축 zOffset만 다른 2개는 키가 다름 (조용한 삭제 방지)', () => {
    const { store, seed } = setup();
    store.createBeam({ levelId: seed.levelId, typeId: seed.beamTypeId, a: [0, 0], b: [5000, 0], zOffset: 2700 });
    const seen = new Set(store.listElements().map((el) => elementContentKey(el)));
    const args = (z: number) => ({ levelId: seed.levelId, typeId: seed.beamTypeId, a: [0, 0], b: [5000, 0], zOffset: z });
    expect(seen.has(createOpContentKey('create_beam', args(2700))!)).toBe(true); // 동일 재푸시 = 스킵
    expect(seen.has(createOpContentKey('create_beam', args(5700))!)).toBe(false); // 위층 보 = 적용
  });

  it('겹층 기둥 — 같은 at, baseOffset/height만 다른 것도 키가 다름', () => {
    const { store, seed } = setup();
    store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [1000, 1000], baseOffset: 0, height: 1500 });
    const seen = new Set(store.listElements().map((el) => elementContentKey(el)));
    const args = (baseOffset: number, height: number) => ({
      levelId: seed.levelId, typeId: seed.columnTypeId, at: [1000, 1000], baseOffset, height,
    });
    expect(seen.has(createOpContentKey('create_column', args(0, 1500))!)).toBe(true);
    expect(seen.has(createOpContentKey('create_column', args(1500, 1500))!)).toBe(false); // 상부 기둥
  });

  it('수직 파라미터 없는 요소 — 키 불변 (기존 문서와 매칭 유지)', () => {
    const { store, seed } = setup();
    store.createBeam({ levelId: seed.levelId, typeId: seed.beamTypeId, a: [0, 0], b: [5000, 0] }); // zOffset 미지정
    const seen = new Set(store.listElements().map((el) => elementContentKey(el)));
    const key = createOpContentKey('create_beam', { levelId: seed.levelId, typeId: seed.beamTypeId, a: [0, 0], b: [5000, 0] });
    expect(seen.has(key!)).toBe(true); // 양쪽 다 필드 생략 → 동일 파생
  });

  it('create 아닌 옵(update/delete) = null (항상 적용)', () => {
    expect(createOpContentKey('update_element', { id: 'x', a: [0, 0] })).toBeNull();
    expect(createOpContentKey('delete_elements', { ids: ['x'] })).toBeNull();
  });

  it('배치 내 중복도 첫 1개만 — seen 누적 시뮬레이션', () => {
    const { store, seed } = setup();
    const seen = new Set(store.listElements().map((el) => elementContentKey(el)));
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
