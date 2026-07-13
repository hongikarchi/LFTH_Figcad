import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { createOpContentKey, elementContentKey, type LevelLookup } from '../src/connectorDedup';
import { runCapability } from '../src/capabilities';
import { lint } from '../src/lint';

/**
 * 레벨 구조화 M2 — dedup 키 절대 z 정규화.
 * 평탄 푸시(전부 1층 + 큰 오프셋) 요소와 층 구조화 재푸시(다른 레벨 + 작은 오프셋)가
 * 같은 절대 위치면 매칭돼 전량 중복을 막는다. levels 미제공 = v1 키 그대로(back-compat).
 */
describe('커넥터 멱등화 v2 — 절대 z 폴드', () => {
  function setup() {
    const store = new DocStore();
    const seed = seedDocument(store);
    // 2층 추가 (1층 elevation 0 · height 3000 가정 — seed 기본)
    const l2 = store.addLevel({ name: '2층', elevation: 3400, height: 3000, order: 1 });
    const lookup: LevelLookup = new Map(
      store.listLevels().map((l) => [l.id, { elevation: l.elevation, height: l.height }]),
    );
    return { store, seed, l2, lookup };
  }

  it('(a) 평탄(1층+baseOffset 3400) 요소 = 구조화(2층+0) 옵과 키 일치 — 크로스레벨 매칭', () => {
    const { store, seed, l2, lookup } = setup();
    store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [3000, 0],
      baseOffset: 3400,
    });
    const seen = new Set(store.listElements().map((el) => elementContentKey(el, lookup)));
    const structured = createOpContentKey(
      'create_wall',
      { levelId: l2, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [3000, 0] },
      lookup,
    );
    expect(seen.has(structured!)).toBe(true);
  });

  it('(b) 같은 평면 좌표에 층층이 쌓인 벽 — 절대 z 다르면 키 구분 유지', () => {
    const { store, seed, lookup } = setup();
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [3000, 0] });
    const seen = new Set(store.listElements().map((el) => elementContentKey(el, lookup)));
    const upper = createOpContentKey(
      'create_wall',
      { levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [3000, 0], baseOffset: 3400 },
      lookup,
    );
    expect(seen.has(upper!)).toBe(false);
  });

  it('(c) 보 zOffset 부재 = 레벨 국한 센티널 — 크로스레벨 매칭 안 함 (파생 기본값은 타입 의존)', () => {
    const { store, seed, l2, lookup } = setup();
    store.createBeam({ levelId: seed.levelId, typeId: seed.beamTypeId, a: [0, 0], b: [5000, 0] });
    const seen = new Set(store.listElements().map((el) => elementContentKey(el, lookup)));
    const other = createOpContentKey(
      'create_beam',
      { levelId: l2, typeId: seed.beamTypeId, a: [0, 0], b: [5000, 0] },
      lookup,
    );
    expect(seen.has(other!)).toBe(false);
    // 같은 레벨 재푸시는 여전히 매칭
    const same = createOpContentKey(
      'create_beam',
      { levelId: seed.levelId, typeId: seed.beamTypeId, a: [0, 0], b: [5000, 0] },
      lookup,
    );
    expect(seen.has(same!)).toBe(true);
  });

  it('(d) 보 zOffset 명시 = 절대 축 z로 크로스레벨 매칭', () => {
    const { store, seed, l2, lookup } = setup();
    store.createBeam({
      levelId: seed.levelId,
      typeId: seed.beamTypeId,
      a: [0, 0],
      b: [5000, 0],
      zOffset: 6100, // 절대 6100 (1층 elev 0)
    });
    const seen = new Set(store.listElements().map((el) => elementContentKey(el, lookup)));
    const structured = createOpContentKey(
      'create_beam',
      { levelId: l2, typeId: seed.beamTypeId, a: [0, 0], b: [5000, 0], zOffset: 2700 }, // 3400+2700=6100
      lookup,
    );
    expect(seen.has(structured!)).toBe(true);
  });

  it('(e) 미해석 levelId(토큰/미생성) = v1 키 그대로 — 바이트 동일', () => {
    const { seed, lookup } = setup();
    const args = {
      levelId: '{LEVELID:1}',
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [3000, 0],
      baseOffset: 3400,
    };
    expect(createOpContentKey('create_wall', args, lookup)).toBe(createOpContentKey('create_wall', args));
  });

  it('(f) 지붕 = elev+height+baseOffset 폴드 — 층고 다른 레벨 간 절대 처마 일치 시 매칭', () => {
    const { store, seed, lookup } = setup();
    // 1층(0/3000) baseOffset 400 → 처마 3400 == 2층(3400/3000) 기준 elev+height+(-3000)
    store.createRoof({
      levelId: seed.levelId,
      typeId: seed.roofTypeId,
      boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]],
      baseOffset: 400,
    });
    const seen = new Set(store.listElements().map((el) => elementContentKey(el, lookup)));
    const same = createOpContentKey(
      'create_roof',
      {
        levelId: seed.levelId,
        typeId: seed.roofTypeId,
        boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]],
        baseOffset: 400,
      },
      lookup,
    );
    expect(seen.has(same!)).toBe(true);
  });

  it('(g) levels 미전달 = v1 동작 그대로 (기존 호출부 back-compat)', () => {
    const { store, seed } = setup();
    store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [3000, 0],
      baseOffset: 3400,
    });
    const el = store.listElements().find((e) => e.kind === 'wall')!;
    // v1 키 형식: kind|levelId|typeId|pos|vert — levelId 성분 보존
    expect(elementContentKey(el)).toContain(`wall|${seed.levelId}|`);
    expect(elementContentKey(el)).toContain('baseOffset:3400');
  });

  it('슬라브 zOffset — 절대 상면 z 크로스레벨 매칭', () => {
    const { store, seed, l2, lookup } = setup();
    store.createSlab({
      levelId: seed.levelId,
      typeId: seed.slabTypeId,
      boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]],
      zOffset: 3400,
    });
    const seen = new Set(store.listElements().map((el) => elementContentKey(el, lookup)));
    const structured = createOpContentKey(
      'create_slab',
      { levelId: l2, typeId: seed.slabTypeId, boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] },
      lookup,
    );
    expect(seen.has(structured!)).toBe(true);
  });
});

describe('update_element — levelId/baseOffset (레벨 구조화 M1 수정)', () => {
  it('levelId 패치 = 층 이동 + baseOffset 재기저 한 번에', () => {
    const store = new DocStore();
    const seed = seedDocument(store);
    const l2 = store.addLevel({ name: '2층', elevation: 3400, height: 3000, order: 1 });
    const id = store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [3000, 0],
      baseOffset: 3400,
    });
    runCapability(store, 'update_element', { id, levelId: l2, baseOffset: 0 });
    const el = store.getElement(id)!;
    expect((el as { levelId: string }).levelId).toBe(l2);
    expect((el as { baseOffset?: number }).baseOffset).toBe(0);
  });

  it('존재하지 않는 levelId = 거부 (missing-ref 차단)', () => {
    const store = new DocStore();
    const seed = seedDocument(store);
    const id = store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 0],
      b: [3000, 0],
    });
    expect(() => runCapability(store, 'update_element', { id, levelId: 'no-such-level' })).toThrow(
      /level not found/,
    );
  });

  it('levelId 없는 kind(그리드) = 거부 — zod strip 성공 위장 방지 (리뷰)', () => {
    const store = new DocStore();
    seedDocument(store);
    const gid = store.createGridLine({ a: [0, 0], b: [0, 5000] });
    const l2 = store.addLevel({ name: '2층', elevation: 3400, height: 3000, order: 1 });
    expect(() => runCapability(store, 'update_element', { id: gid, levelId: l2 })).toThrow(
      /levelId 이동 불가/,
    );
  });
});

describe('lint level-band-mismatch — 평탄 푸시 감지', () => {
  it('층고+여유 초과 baseOffset = info 1건(레벨별 집계), 정상 요소는 미발화', () => {
    const store = new DocStore();
    const seed = seedDocument(store);
    store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [3000, 0] }); // 정상
    store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 500],
      b: [3000, 500],
      baseOffset: 6800, // 3층 높이 — 평탄 푸시 신호
    });
    store.createColumn({
      levelId: seed.levelId,
      typeId: seed.columnTypeId,
      at: [1000, 1000],
      baseOffset: 6800,
    });
    const found = lint(store).filter((f) => f.code === 'level-band-mismatch');
    expect(found).toHaveLength(1); // 레벨별 집계 1건
    expect(found[0]!.severity).toBe('info');
    expect(found[0]!.elementIds).toHaveLength(2);
  });

  it('1층 변위(offset 3400 · 층고 3000)도 발화 — 평탄 푸시 2층 건물의 표준 케이스 (리뷰 임계 수정)', () => {
    const store = new DocStore();
    const seed = seedDocument(store);
    store.createWall({
      levelId: seed.levelId,
      typeId: seed.wallTypeIds[0]!,
      a: [0, 500],
      b: [3000, 500],
      baseOffset: 3400,
    });
    expect(lint(store).filter((f) => f.code === 'level-band-mismatch')).toHaveLength(1);
    // 파라펫급(밴드 내)·기초급(-500)은 통과
    const store2 = new DocStore();
    const seed2 = seedDocument(store2);
    store2.createWall({ levelId: seed2.levelId, typeId: seed2.wallTypeIds[0]!, a: [0, 0], b: [3000, 0], baseOffset: 2900 });
    store2.createColumn({ levelId: seed2.levelId, typeId: seed2.columnTypeId, at: [1000, 1000], baseOffset: -500 });
    expect(lint(store2).filter((f) => f.code === 'level-band-mismatch')).toHaveLength(0);
  });

  it('보 zOffset 부재·roof는 제외 — 오탐 없음', () => {
    const store = new DocStore();
    const seed = seedDocument(store);
    store.createBeam({ levelId: seed.levelId, typeId: seed.beamTypeId, a: [0, 0], b: [5000, 0] });
    store.createRoof({
      levelId: seed.levelId,
      typeId: seed.roofTypeId,
      boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]],
      baseOffset: 400,
    });
    expect(lint(store).filter((f) => f.code === 'level-band-mismatch')).toHaveLength(0);
  });
});
