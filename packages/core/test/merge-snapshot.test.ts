import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument, SEED_IDS } from '../src/store';
import { lint } from '../src/lint';
import type { Element } from '../src/schema';

/**
 * Slice9 스파이크 — additive mergeSnapshot (멀티모델 허브 머지 게이트 코어).
 * 검증: (a) 공존(교체 아님) (b) 내부참조 재맵(host/bind/target/level/type/grid, 소스 id 잔존 0)
 * (c) undo 1스텝 전체 원복 (d) lint 게이트(머지 요소 참조 정합).
 * 소스/타겟 둘 다 seed → SEED_IDS 충돌(L-001/T-w200) = 재맵이 충돌 처리하는지 증명.
 */
type Opening = Extract<Element, { kind: 'opening' }>;
type Dimension = Extract<Element, { kind: 'dimension' }>;
type Grid = Extract<Element, { kind: 'grid' }>;
const isKind =
  <K extends Element['kind']>(k: K) =>
  (e: Element): e is Extract<Element, { kind: K }> =>
    e.kind === k;

function buildSource() {
  const store = new DocStore();
  const seed = seedDocument(store);
  // w1 호스트 + 개구부 · w2 직교벽 · dimension은 w1.a~w2.b 끝점 자동바인딩(중첩 DimBind 2개 다른 벽)
  const w1 = store.createWall({ levelId: seed.levelId, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
  const w2 = store.createWall({ levelId: seed.levelId, typeId: SEED_IDS.wall200, a: [4000, 0], b: [4000, 3000] });
  store.createOpening({ hostId: w1, typeId: SEED_IDS.door900, offset: 1000 });
  store.createDimension({ levelId: seed.levelId, a: [0, 0], b: [4000, 3000] });
  store.createGridLine({ a: [0, 0], b: [6000, 0] }); // 수평 → 라벨 'A'
  return { store, w1, w2 };
}
function seededTarget() {
  const store = new DocStore();
  seedDocument(store);
  return store;
}

describe('mergeSnapshot — additive 머지(Slice9 스파이크)', () => {
  it('(a) 공존 — 소스 요소가 타겟에 추가(교체 아님)', () => {
    const snap = buildSource().store.snapshot();
    const target = seededTarget();
    const before = target.listElements().length;
    const { created } = target.mergeSnapshot(snap);
    expect(created.length).toBe(snap.elements.length);
    expect(target.listElements().length).toBe(before + snap.elements.length);
  });

  it('(b) 내부참조 재맵 — host/bind/target/level/type/grid, 소스 id 잔존 0', () => {
    const src = buildSource();
    const snap = src.store.snapshot();
    const target = seededTarget();
    target.createGridLine({ a: [0, 5000], b: [6000, 5000] }); // 타겟 수평 grid 'A' → 소스 'A' 충돌 유발
    const { created, idMap } = target.mergeSnapshot(snap);
    const merged = created.map((id) => target.getElement(id)!);
    const srcIds = new Set(idMap.keys());

    // opening.hostId → 머지된 새 벽 (소스 벽 id 아님)
    const mOpening = merged.find(isKind('opening')) as Opening;
    expect(mOpening.hostId).toBe(idMap.get(src.w1));
    expect(srcIds.has(mOpening.hostId)).toBe(false);

    // dimension 중첩 DimBind → 머지된 새 벽 (transformCopy/remapArgs 둘 다 실패하던 지점)
    const mDim = merged.find(isKind('dimension')) as Dimension;
    expect(mDim.bindA?.id).toBe(idMap.get(src.w1));
    expect(mDim.bindB?.id).toBe(idMap.get(src.w2));

    // grid 라벨 재발급 (타겟 'A'와 충돌 회피)
    expect((merged.find(isKind('grid')) as Grid).label).not.toBe('A');

    // level/type 재맵 + 어떤 머지 요소 참조에도 소스 id 잔존 0 (load-bearing)
    for (const e of merged) {
      if ('levelId' in e) expect(e.levelId).not.toBe(SEED_IDS.level);
      if ('typeId' in e && e.typeId) expect(e.typeId).not.toBe(SEED_IDS.wall200);
      if (e.kind === 'opening') expect(srcIds.has(e.hostId)).toBe(false);
      if (e.kind === 'dimension') {
        if (e.bindA) expect(srcIds.has(e.bindA.id)).toBe(false);
        if (e.bindB) expect(srcIds.has(e.bindB.id)).toBe(false);
      }
    }
  });

  it('(c) undo 1스텝 — 요소·레벨·타입 전체 원복', () => {
    const snap = buildSource().store.snapshot();
    const target = seededTarget();
    const [bEls, bLv, bTy] = [target.listElements().length, target.listLevels().length, target.listTypes().length];
    const undo = target.createUndoManager();
    target.mergeSnapshot(snap);
    expect(target.listElements().length).toBeGreaterThan(bEls);
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
});
