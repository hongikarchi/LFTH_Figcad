import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument, SEED_IDS } from '../src/store';
import { lint } from '../src/lint';
import type { Element } from '../src/schema';

/**
 * Slice9 — additive mergeSnapshot (멀티모델 허브 머지 게이트 코어).
 * (a)공존 (b)내부참조 재맵+by-content dedup (c)undo 1스텝 (d)lint 게이트 (e)projectOrigin reconcile.
 * 소스/타겟 둘 다 seed → seed 타입/레벨은 dedup(중복 안 만듦), 커스텀 타입만 신규 생성.
 */
type Opening = Extract<Element, { kind: 'opening' }>;
type Dimension = Extract<Element, { kind: 'dimension' }>;
type Grid = Extract<Element, { kind: 'grid' }>;
type Label = Extract<Element, { kind: 'label' }>;
type Wall = Extract<Element, { kind: 'wall' }>;
const isKind =
  <K extends Element['kind']>(k: K) =>
  (e: Element): e is Extract<Element, { kind: K }> =>
    e.kind === k;

function buildSource() {
  const store = new DocStore();
  const seed = seedDocument(store);
  const w1 = store.createWall({ levelId: seed.levelId, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
  const w2 = store.createWall({ levelId: seed.levelId, typeId: SEED_IDS.wall200, a: [4000, 0], b: [4000, 3000] });
  store.createOpening({ hostId: w1, typeId: SEED_IDS.door900, offset: 1000 });
  store.createDimension({ levelId: seed.levelId, a: [0, 0], b: [4000, 3000] }); // w1.a~w2.b 자동바인딩
  store.createGridLine({ a: [0, 0], b: [6000, 0] }); // 수평 → 'A'
  store.createColumn({ levelId: seed.levelId, typeId: SEED_IDS.column400, at: [0, 0] }); // seed 타입 → dedup
  store.createLabel({ levelId: seed.levelId, at: [500, 500], targetId: w1, template: 'name' });
  // 커스텀(비-seed) 타입 + 그걸 쓰는 벽 → 신규 타입 생성 경로 검증
  const customType = store.addType({ kind: 'wall', name: '커스텀벽333', thickness: 333, color: '#abcdef' });
  store.createWall({ levelId: seed.levelId, typeId: customType, a: [0, 3000], b: [2000, 3000] });
  return { store, w1, w2, customType };
}
function seededTarget() {
  const store = new DocStore();
  seedDocument(store);
  return store;
}

describe('mergeSnapshot — additive 머지(Slice9)', () => {
  it('(a) 공존 — 소스 요소가 타겟에 추가(교체 아님)', () => {
    const snap = buildSource().store.snapshot();
    const target = seededTarget();
    const before = target.listElements().length;
    const { created } = target.mergeSnapshot(snap);
    expect(created.length).toBe(snap.elements.length);
    expect(target.listElements().length).toBe(before + snap.elements.length);
  });

  it('(b) 참조 재맵 + by-content dedup', () => {
    const src = buildSource();
    const snap = src.store.snapshot();
    const target = seededTarget();
    target.createGridLine({ a: [0, 5000], b: [6000, 5000] }); // 타겟 수평 grid 'A' → 소스 'A' 충돌
    const typesBefore = target.listTypes().length;
    const { created, idMap } = target.mergeSnapshot(snap);
    const merged = created.map((id) => target.getElement(id)!);
    const srcEls = new Set([src.w1, src.w2]); // 소스 요소 id (재맵돼 사라져야)

    // 요소 참조 = 머지된 새 요소(소스 요소 id 잔존 0)
    const mOpening = merged.find(isKind('opening')) as Opening;
    expect(mOpening.hostId).toBe(idMap.get(src.w1));
    expect(srcEls.has(mOpening.hostId)).toBe(false);
    const mDim = merged.find(isKind('dimension')) as Dimension;
    expect(mDim.bindA?.id).toBe(idMap.get(src.w1)); // 중첩 DimBind
    expect(mDim.bindB?.id).toBe(idMap.get(src.w2));
    const mLabel = merged.find(isKind('label')) as Label;
    expect(mLabel.targetId).toBe(idMap.get(src.w1));

    // grid 라벨 재발급(타겟 'A' 회피)
    expect((merged.find(isKind('grid')) as Grid).label).not.toBe('A');

    // dedup: seed 타입/레벨은 타겟 기존 것 재사용 (id 그대로 SEED)
    const mCol = merged.find(isKind('column'))!;
    expect(mCol.typeId).toBe(SEED_IDS.column400); // dedup → 타겟 seed 타입
    for (const e of merged) if ('levelId' in e) expect(e.levelId).toBe(SEED_IDS.level); // 레벨 dedup

    // 커스텀 타입만 신규 생성 → 타입 +1, 그 벽 typeId = 새 id(SEED 아님)
    expect(target.listTypes().length).toBe(typesBefore + 1);
    const mCustomWall = merged.filter(isKind('wall')).find((w: Wall) => w.typeId === idMap.get(src.customType))!;
    expect(mCustomWall).toBeTruthy();
    expect(mCustomWall.typeId).not.toBe(src.customType); // 새 id로 재맵
    expect(target.getType(mCustomWall.typeId)?.name).toBe('커스텀벽333');
  });

  it('(c) undo 1스텝 — 요소·레벨·타입 전체 원복', () => {
    const snap = buildSource().store.snapshot();
    const target = seededTarget();
    const [bEls, bLv, bTy] = [target.listElements().length, target.listLevels().length, target.listTypes().length];
    const undo = target.createUndoManager();
    target.mergeSnapshot(snap);
    expect(target.listElements().length).toBeGreaterThan(bEls);
    expect(target.listTypes().length).toBe(bTy + 1); // 커스텀 1개 추가
    undo.undo();
    expect(target.listElements().length).toBe(bEls);
    expect(target.listLevels().length).toBe(bLv);
    expect(target.listTypes().length).toBe(bTy);
  });

  it('(d) lint 게이트 — 머지 요소 참조 정합(고아 없음)', () => {
    const snap = buildSource().store.snapshot();
    const target = seededTarget();
    const created = new Set(target.mergeSnapshot(snap).created);
    const onMerged = lint(target).filter((f) => f.elementIds.some((id) => created.has(id)));
    expect(onMerged.some((f) => f.code === 'orphan-dimension' || f.code === 'orphan-opening')).toBe(false);
  });

  it('(e) projectOrigin reconcile — 소스 원점 차만큼 좌표 평행이동', () => {
    const snap = buildSource().store.snapshot();
    // 소스가 원점 [10000,20000] 기준이라 명시 → 타겟(원점 0) 프레임으로 +[10000,20000] 이동돼야
    const shifted = { ...snap, meta: { ...snap.meta, projectOrigin: [10000, 20000] as [number, number] } };
    const target = seededTarget();
    const { created } = target.mergeSnapshot(shifted);
    const merged = created.map((id) => target.getElement(id)!);
    // 소스 stored a=[0,0]인 벽 → [10000,20000]로 착지
    const w = merged.filter(isKind('wall')).find((e: Wall) => e.a[0] === 10000 && e.a[1] === 20000);
    expect(w).toBeTruthy();
  });
});
