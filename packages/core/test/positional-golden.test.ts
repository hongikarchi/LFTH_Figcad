import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument } from '../src/store';
import { elementFootprint } from '../src/select';
import type {
  BeamElement,
  ColumnElement,
  DimensionElement,
  GridLine,
  LabelElement,
  OpeningElement,
  RoofElement,
  SlabElement,
  WallElement,
  ZoneElement,
} from '../src/schema';

/**
 * POSITIONAL 레지스트리(def.positional) 리팩터의 **특성화(golden) 테스트**.
 * 현재 store.ts move/rotate/transformCopy + select.ts footprint 동작을 그대로 pin한다.
 * 목적: behavior-preserving 리팩터(S2/S3)가 동작을 1mm도 안 바꾸는지 보증.
 *
 * advisor 지정 load-bearing = **비대칭 하위케이스**(naive 픽스처가 놓치는 곳):
 *  1. grid copy → label 재발급(≠ 원본)
 *  2. label copy 타깃 IN 셋(재타깃) vs OUT(원본 유지) — 둘 다
 *  3. dimension copy 바인딩 + 해석좌표 ≠ stored a/b → 새 좌표=해석값, bind 클리어
 *  4. roof move(slope 불변) vs rotate(원점회전) vs copy(선형부) — 한 필드 3 op 3 동작
 *  5. opening copy host IN(재호스트) vs OUT(복사 안 함) + mirror flip 토글
 *
 * **이 파일은 미변경 코드에서 먼저 전부 green이어야 한다(게이트). 그 뒤에만 리팩터 시작.**
 * 모든 assert = 양자화 정수 출력.
 */

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}

const el = <T>(store: DocStore, id: string): T => store.getElement(id) as unknown as T;
const findKind = <T>(store: DocStore, ids: string[], kind: string): T =>
  ids.map((id) => store.getElement(id)).find((e) => e?.kind === kind) as unknown as T;

// ─────────────────────────────────────────────────────────────────────────
// 기계적 카테고리 — segment(a,b) / polygon(boundary) / point(at)
// ─────────────────────────────────────────────────────────────────────────

describe('golden: 기계적 카테고리 move/rotate', () => {
  it('segment(wall/beam) — move·rotate a,b', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [6000, 0] });
    const beam = store.createBeam({ levelId: seed.levelId, typeId: seed.beamTypeId, a: [0, 0], b: [4000, 0] });
    store.moveElements([wall, beam], [1000, 500]);
    expect(el<WallElement>(store, wall).a).toEqual([1000, 500]);
    expect(el<WallElement>(store, wall).b).toEqual([7000, 500]);
    expect(el<BeamElement>(store, beam).b).toEqual([5000, 500]);
    store.rotateElements([wall], [1000, 500], Math.PI / 2); // a를 중심으로 90°
    expect(el<WallElement>(store, wall).a).toEqual([1000, 500]);
    expect(el<WallElement>(store, wall).b).toEqual([1000, 6500]); // (7000,500)→(1000,6500)
  });

  it('polygon(slab/zone) — move·rotate boundary', () => {
    const { store, seed } = setup();
    const slab = store.createSlab({
      levelId: seed.levelId,
      typeId: seed.slabTypeId,
      boundary: [[0, 0], [4000, 0], [4000, 4000], [0, 4000]],
    });
    const zone = store.createZone({ levelId: seed.levelId, boundary: [[0, 0], [2000, 0], [2000, 2000], [0, 2000]], name: 'A' });
    store.moveElements([slab, zone], [500, 500]);
    expect(el<SlabElement>(store, slab).boundary[0]).toEqual([500, 500]);
    expect(el<SlabElement>(store, slab).boundary[2]).toEqual([4500, 4500]);
    expect(el<ZoneElement>(store, zone).boundary[2]).toEqual([2500, 2500]);
    store.rotateElements([slab], [0, 0], Math.PI / 2);
    expect(el<SlabElement>(store, slab).boundary[0]).toEqual([-500, 500]); // (500,500)→(-500,500)
  });

  it('point(column/text) — move·rotate at', () => {
    const { store, seed } = setup();
    const col = store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [1000, 2000] });
    const text = store.createText({ levelId: seed.levelId, at: [3000, 0], text: 'x' });
    store.moveElements([col, text], [100, 200]);
    expect(el<ColumnElement>(store, col).at).toEqual([1100, 2200]);
    expect(el<{ at: [number, number] }>(store, text).at).toEqual([3100, 200]);
    store.rotateElements([col], [0, 0], Math.PI / 2);
    expect(el<ColumnElement>(store, col).at).toEqual([-2200, 1100]); // (1100,2200)→(-2200,1100)
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 1. grid copy → label 재발급
// ─────────────────────────────────────────────────────────────────────────

describe('golden: grid copy 라벨 재발급', () => {
  it('수직 그리드 1 복사 → 2 (원본과 다름)', () => {
    const { store } = setup();
    const grid = store.createGridLine({ a: [0, 0], b: [0, 5000], label: '1' });
    const [copy] = store.duplicateElements([grid], [3000, 0]);
    expect(el<GridLine>(store, grid).label).toBe('1');
    expect(el<GridLine>(store, copy!).label).toBe('2'); // 재발급 — verbatim 복사 아님
    expect(el<GridLine>(store, copy!).a).toEqual([3000, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. label copy 타깃 IN vs OUT
// ─────────────────────────────────────────────────────────────────────────

describe('golden: label copy 타깃 재바인딩', () => {
  it('타깃 IN 셋 → 새 타깃 id로 재바인딩', () => {
    const { store, seed } = setup();
    const col = store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [1000, 1000] });
    const label = store.createLabel({ levelId: seed.levelId, at: [1200, 1200], template: 'name', targetId: col, leader: true });
    const created = store.duplicateElements([col, label], [5000, 0]);
    const newCol = findKind<ColumnElement>(store, created, 'column');
    const newLabel = findKind<LabelElement>(store, created, 'label');
    expect(newLabel.targetId).toBe(newCol.id); // 같은 복사셋 → 새 타깃
    expect(newLabel.at).toEqual([6200, 1200]);
  });

  it('타깃 OUT 셋 → 원본 targetId 유지', () => {
    const { store, seed } = setup();
    const col = store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [1000, 1000] });
    const label = store.createLabel({ levelId: seed.levelId, at: [1200, 1200], template: 'name', targetId: col });
    const [copy] = store.duplicateElements([label], [5000, 0]); // col 미포함
    expect(el<LabelElement>(store, copy!).targetId).toBe(col); // 원본 유지 (name 퇴화 방지)
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. dimension copy — 바인딩 해석 + 언바인딩 (해석 ≠ stored 로 구별)
// ─────────────────────────────────────────────────────────────────────────

describe('golden: dimension copy 해석좌표 + 언바인딩', () => {
  it('바인딩 치수 복사 → 새 좌표=해석값(stored 아님), bind 클리어', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [1000, 1000], b: [5000, 1000] });
    // stored a/b를 일부러 wall 끝점과 다르게 → 해석값(wall.a/b)과 stored가 구별됨
    const dim = store.createDimension({
      levelId: seed.levelId,
      a: [0, 0],
      b: [8000, 8000],
      bindA: { id: wall, anchor: 'a' },
      bindB: { id: wall, anchor: 'b' },
    });
    const [copy] = store.duplicateElements([dim], [100, 200]); // wall 미포함
    const c = el<DimensionElement>(store, copy!);
    // 해석값(wall.a=[1000,1000]) + delta = [1100,1200] — stored([0,0])+delta=[100,200] 아님
    expect(c.a).toEqual([1100, 1200]);
    expect(c.b).toEqual([5100, 1200]);
    expect(c.bindA).toBeUndefined();
    expect(c.bindB).toBeUndefined();
  });

  it('바인딩 치수 move → stored a/b 이동·바인딩 보존, footprint는 벽 추종(이동 무시)', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [1000, 1000], b: [5000, 1000] });
    const dim = store.createDimension({
      levelId: seed.levelId,
      a: [0, 0],
      b: [8000, 8000],
      bindA: { id: wall, anchor: 'a' },
      bindB: { id: wall, anchor: 'b' },
    });
    store.moveElements([dim], [100, 200]); // 벽 미포함
    const d = el<DimensionElement>(store, dim);
    expect(d.a).toEqual([100, 200]); // stored 이동 (segment 기계동작)
    expect(d.bindA).toEqual({ id: wall, anchor: 'a' }); // 바인딩 보존 — 언바인딩은 copy만(copy와 비대칭)
    const fp = elementFootprint(d, store);
    expect(fp).toEqual({ kind: 'segment', a: [1000, 1000], b: [5000, 1000] }); // 벽 끝점(stored 이동 무시)
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. roof slope — move 불변 / rotate 원점회전 / copy 선형부
// ─────────────────────────────────────────────────────────────────────────

describe('golden: roof slope.dir 3 op 3 동작', () => {
  const mkRoof = (store: DocStore, levelId: string, typeId: string) =>
    store.createRoof({
      levelId,
      typeId,
      boundary: [[0, 0], [4000, 0], [4000, 4000], [0, 4000]],
      slope: { dir: [1000, 0], pitch: 200 },
    });

  it('move → slope.dir 불변, boundary만 이동', () => {
    const { store, seed } = setup();
    const roof = mkRoof(store, seed.levelId, seed.roofTypeId);
    store.moveElements([roof], [500, 700]);
    const r = el<RoofElement>(store, roof);
    expect(r.boundary[0]).toEqual([500, 700]);
    expect(r.slope!.dir).toEqual([1000, 0]); // 불변 (평행이동은 방향 안 바꿈)
    expect(r.slope!.pitch).toBe(200);
  });

  it('rotate → slope.dir 원점 기준 회전', () => {
    const { store, seed } = setup();
    const roof = mkRoof(store, seed.levelId, seed.roofTypeId);
    store.rotateElements([roof], [2000, 2000], Math.PI / 2); // 중심은 [2000,2000]
    const r = el<RoofElement>(store, roof);
    expect(r.slope!.dir).toEqual([0, 1000]); // (1000,0)→원점회전→(0,1000) (중심 무관)
    expect(r.slope!.pitch).toBe(200);
  });

  it('mirror(copy) → slope.dir = 변환 선형부', () => {
    const { store, seed } = setup();
    const roof = mkRoof(store, seed.levelId, seed.roofTypeId);
    const [copy] = store.mirrorElements([roof], [2000, 0], [2000, 1000]); // x=2000 축(원점 밖)
    const r = el<RoofElement>(store, copy!);
    // 선형부 = xform([1000,0]) - xform([0,0]) = [3000,0]-[4000,0] = [-1000,0].
    // 축이 원점 밖이라 -xform(0) 항이 실제로 작동 → 선형부 규칙을 자기충족 검증(원점 축이면 무의미했음).
    expect(r.slope!.dir).toEqual([-1000, 0]);
    expect(r.slope!.pitch).toBe(200);
  });

  it('duplicate(평행이동 copy) → slope.dir 불변(선형부=항등)', () => {
    const { store, seed } = setup();
    const roof = mkRoof(store, seed.levelId, seed.roofTypeId);
    const [copy] = store.duplicateElements([roof], [500, 700]);
    expect(el<RoofElement>(store, copy!).slope!.dir).toEqual([1000, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. opening copy — host IN / OUT / mirror flip
// ─────────────────────────────────────────────────────────────────────────

describe('golden: opening copy 호스트 의존', () => {
  it('host IN 셋 → 새 벽으로 재호스트, offset 보존', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [6000, 0] });
    store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 2000 });
    const created = store.duplicateElements([wall], [0, 3000]); // 벽 선택 → 개구부 자동 동반
    expect(created).toHaveLength(2);
    const nw = findKind<WallElement>(store, created, 'wall');
    const no = findKind<OpeningElement>(store, created, 'opening');
    expect(no.hostId).toBe(nw.id);
    expect(no.offset).toBe(2000);
  });

  it('host OUT 셋 → 개구부 단독 복사 안 함 (0개)', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [6000, 0] });
    const door = store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 2000 });
    const created = store.duplicateElements([door], [0, 3000]); // 호스트 미포함
    expect(created).toHaveLength(0);
  });

  it('mirror → 개구부 flip 토글, offset 보존', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [6000, 0] });
    store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 2000, flip: false });
    const created = store.mirrorElements([wall], [0, 0], [0, 1000]);
    const no = findKind<OpeningElement>(store, created, 'opening');
    expect(no.flip).toBe(true);
    expect(no.offset).toBe(2000);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// footprint — 카테고리별 + dimension 바인딩 해석 + opening 호스트 투영
// ─────────────────────────────────────────────────────────────────────────

describe('golden: elementFootprint 카테고리 + 특수', () => {
  it('segment / polygon / point', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [6000, 0] });
    const slab = store.createSlab({ levelId: seed.levelId, typeId: seed.slabTypeId, boundary: [[0, 0], [4000, 0], [4000, 4000], [0, 4000]] });
    const col = store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [1000, 2000] });
    const fw = elementFootprint(el(store, wall), store);
    const fs = elementFootprint(el(store, slab), store);
    const fc = elementFootprint(el(store, col), store);
    expect(fw).toEqual({ kind: 'segment', a: [0, 0], b: [6000, 0] });
    expect(fs?.kind === 'polygon' && fs.pts.length).toBe(4);
    expect(fc).toEqual({ kind: 'point', p: [1000, 2000] });
  });

  it('dimension footprint = 바인딩 해석 좌표 (이동된 바인딩 추종)', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [1000, 1000], b: [5000, 1000] });
    const dim = store.createDimension({
      levelId: seed.levelId,
      a: [0, 0],
      b: [9000, 9000],
      bindA: { id: wall, anchor: 'a' },
      bindB: { id: wall, anchor: 'b' },
    });
    const fp = elementFootprint(el(store, dim), store);
    // stored([0,0],[9000,9000])이 아니라 해석값(wall 끝점)
    expect(fp).toEqual({ kind: 'segment', a: [1000, 1000], b: [5000, 1000] });
  });

  it('opening footprint = 호스트 위 투영 점 (양 좌표 pin)', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: seed.wallTypeIds[0]!, a: [0, 0], b: [6000, 0] });
    const door = store.createOpening({ hostId: wall, typeId: seed.doorTypeId, offset: 2000 });
    const fp = elementFootprint(el(store, door), store);
    // 호스트 방향 [1,0] × offset 2000 → [2000,0]. p[0]까지 pin(투영 회귀 가드 — p[1]만 보면 항상 0이라 무의미).
    expect(fp).toEqual({ kind: 'point', p: [2000, 0] });
  });
});
