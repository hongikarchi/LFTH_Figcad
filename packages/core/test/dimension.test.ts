import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument, SEED_IDS } from '../src/store';
import { DeriveCache } from '../src/geometry';
import { runCapability } from '../src/capabilities';
import { lint } from '../src/lint';
import { elementFootprint } from '../src/select';
import type { DimensionElement } from '../src/schema';

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}

describe('치수 — 생성/파생', () => {
  it('자유 치수 (바인딩 없음) — 측정값 라벨 + 에지', () => {
    const { store, seed } = setup();
    const id = store.createDimension({ levelId: seed.levelId, a: [0, 0], b: [3000, 0], offset: 500 });
    const cache = new DeriveCache();
    const geo = cache.derive(store, id)!;
    expect(geo).not.toBeNull();
    expect(geo.labels?.[0]).toMatchObject({ text: '3000', style: 'dim' });
    expect(geo.edges.length).toBeGreaterThan(0); // 보조선+치수선+틱
    expect(geo.positions.length).toBeGreaterThan(0); // 픽 프록시 리본
  });

  it('끝점 mm-정확 일치 → 요소 바인딩 자동 캡처', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    const dim = store.createDimension({ levelId: seed.levelId, a: [0, 0], b: [4000, 0] });
    const d = store.getElement(dim) as DimensionElement;
    expect(d.bindA).toEqual({ id: wall, anchor: 'a' });
    expect(d.bindB).toEqual({ id: wall, anchor: 'b' });
  });

  it('바인딩 추종 — 벽 끝점 이동 시 치수 자동 갱신', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    const dim = store.createDimension({ levelId: seed.levelId, a: [0, 0], b: [4000, 0] });
    const cache = new DeriveCache();
    expect(cache.derive(store, dim)!.labels?.[0]?.text).toBe('4000');
    // 벽 b 끝점을 5000으로 이동 → 바인딩(anchor b)이 따라가 측정값 갱신
    store.updateElement(wall, { b: [5000, 0] });
    expect(cache.derive(store, dim)!.labels?.[0]?.text).toBe('5000');
  });

  it('고아 — 바인딩 요소 삭제 시 fallback 좌표 + lint 경고 (연쇄삭제 안 됨)', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    const dim = store.createDimension({ levelId: seed.levelId, a: [0, 0], b: [4000, 0] });
    store.deleteElements([wall]);
    // 치수는 연쇄삭제되지 않음
    expect(store.getElement(dim)).toBeTruthy();
    // derive는 throw 없이 fallback a/b 사용
    const geo = new DeriveCache().derive(store, dim)!;
    expect(geo.labels?.[0]?.text).toBe('4000');
    // lint 고아 경고
    expect(lint(store).some((f) => f.code === 'orphan-dimension')).toBe(true);
  });

  it('offset updateElement + 자유 치수 이동/복사', () => {
    const { store, seed } = setup();
    const id = store.createDimension({ levelId: seed.levelId, a: [0, 0], b: [3000, 0], offset: 500 });
    store.updateElement(id, { offset: 800 });
    expect((store.getElement(id) as DimensionElement).offset).toBe(800);
    store.moveElements([id], [1000, 0]);
    expect((store.getElement(id) as DimensionElement).a).toEqual([1000, 0]);
    // 복사 = 바인딩 해제된 자유 치수
    const [copy] = store.duplicateElements([id], [0, 2000]);
    const c = store.getElement(copy!) as DimensionElement;
    expect(c.a).toEqual([1000, 2000]);
    expect(c.bindA).toBeUndefined();
  });

  it('create_dimension capability — float 관용 + 끝점 일치 시 자동 바인딩', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    const id = runCapability(store, 'create_dimension', {
      levelId: seed.levelId,
      a: [0.4, 0.4],
      b: [4000.6, 0.4],
      offset: 600,
    }) as string;
    const d = store.getElement(id) as DimensionElement;
    expect(d.a).toEqual([0, 0]);
    expect(d.b).toEqual([4001, 0]);
    expect(d.offset).toBe(600);
    expect(d.bindA).toEqual({ id: wall, anchor: 'a' }); // [0,0] = wall.a 자동 캡처
  });

  it('풋프린트 = 세그먼트, lint 클린(자유 치수)', () => {
    const { store, seed } = setup();
    const id = store.createDimension({ levelId: seed.levelId, a: [0, 0], b: [3000, 0] });
    expect(elementFootprint(store.getElement(id)!, store)).toEqual({ kind: 'segment', a: [0, 0], b: [3000, 0] });
    expect(lint(store).filter((f) => f.elementIds.length)).toHaveLength(0);
  });
});

// 리뷰 확정 수정: stored vs resolved 분기 — copy/split/footprint가 바인딩을 해석해야 함
describe('치수 — 바인딩 해석 일관성 (리뷰 회귀)', () => {
  it('복사 = 해석된(보이는) 좌표 — 벽 이동 후에도 보이는 위치 복사', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    const dim = store.createDimension({ levelId: seed.levelId, a: [0, 0], b: [4000, 0] });
    // 벽만 이동 → stored a/b는 stale, resolved는 따라감
    store.updateElement(wall, { a: [0, 1000], b: [4000, 1000] });
    const [copy] = store.duplicateElements([dim], [0, 0]);
    const c = store.getElement(copy!) as DimensionElement;
    expect(c.a).toEqual([0, 1000]); // stale [0,0] 아님 — 보이는 위치
    expect(c.b).toEqual([4000, 1000]);
    expect(c.bindA).toBeUndefined();
  });

  it('splitWall이 바인딩 치수 재바인딩 (끝점 보존 → 추종 유지, 고아 아님)', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    const dim = store.createDimension({ levelId: seed.levelId, a: [0, 0], b: [4000, 0] });
    const res = store.splitWall(wall, [2000, 0])!;
    const [id1, id2] = res;
    const d = store.getElement(dim) as DimensionElement;
    expect(d.bindA).toEqual({ id: id1, anchor: 'a' });
    expect(d.bindB).toEqual({ id: id2, anchor: 'b' });
    // 새 sub-wall(id2) 이동 시 추종
    store.updateElement(id2, { b: [6000, 0] });
    expect(new DeriveCache().derive(store, dim)!.labels?.[0]?.text).toBe('6000');
    expect(lint(store).some((f) => f.code === 'orphan-dimension')).toBe(false);
  });

  it('풋프린트가 바인딩 해석 — 이동된 바인딩 치수도 박스선택 좌표 일치', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    const dim = store.createDimension({ levelId: seed.levelId, a: [0, 0], b: [4000, 0] });
    store.updateElement(wall, { a: [0, 1000], b: [4000, 1000] });
    expect(elementFootprint(store.getElement(dim)!, store)).toEqual({
      kind: 'segment',
      a: [0, 1000],
      b: [4000, 1000],
    });
  });
});
