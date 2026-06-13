import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument, SEED_IDS } from '../src';

function docWithWall(): { store: DocStore; wallId: string } {
  const store = new DocStore();
  seedDocument(store);
  const wallId = store.createWall({
    levelId: SEED_IDS.level,
    typeId: SEED_IDS.wall200,
    a: [0, 0],
    b: [4000, 0],
  });
  return { store, wallId };
}

describe('importSnapshot', () => {
  it('문서 내용 전체 교체 — id 보존, undo 1스텝 복원', () => {
    const { store: src } = docWithWall();
    const { store: dst, wallId: oldWall } = docWithWall();
    dst.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall100, a: [0, 5000], b: [3000, 5000] });

    const undo = dst.createUndoManager();
    const snap = src.snapshot();
    dst.importSnapshot(snap);

    expect(dst.listElements()).toHaveLength(1); // src에는 벽 1개
    expect(dst.listLevels()).toEqual(src.listLevels());
    expect(dst.meta.projectName).toBe(src.meta.projectName);

    undo.undo(); // 단일 transact → 한 번에 원복
    expect(dst.listElements()).toHaveLength(2);
    expect(dst.getElement(oldWall)?.kind).toBe('wall');
  });

  it('미래 schemaVersion / 깨진 요소 → 거부 + 문서 무변경', () => {
    const { store, wallId } = docWithWall();
    const good = store.snapshot();

    expect(() =>
      store.importSnapshot({ ...good, meta: { ...good.meta, schemaVersion: 99 } }),
    ).toThrow(/schemaVersion/);

    const broken = structuredClone(good);
    (broken.elements[0] as { a: unknown }).a = 'garbage';
    expect(() => store.importSnapshot(broken)).toThrow();

    // 두 실패 모두 부분 적용 없음
    expect(store.getElement(wallId)?.kind).toBe('wall');
    expect(store.listElements()).toHaveLength(1);
  });
});

describe('updateType / deleteType', () => {
  it('두께 수정(양자화) + kind 변경 불가', () => {
    const { store, wallId } = docWithWall();
    store.updateType(SEED_IDS.wall200, { thickness: 249.6, name: '콘크리트벽 250', kind: 'slab' });
    const t = store.getType(SEED_IDS.wall200);
    expect(t).toMatchObject({ kind: 'wall', thickness: 250, name: '콘크리트벽 250' });
    // 참조 벽은 그대로 (파생 시 새 두께 반영)
    expect(store.getElement(wallId)).toMatchObject({ typeId: SEED_IDS.wall200 });
  });

  it('개구부 타입 부분 수정 — 나머지 opening 필드 보존', () => {
    const store = new DocStore();
    seedDocument(store);
    store.updateType(SEED_IDS.door900, { opening: { width: 1000 } });
    const t = store.getType(SEED_IDS.door900);
    expect(t).toMatchObject({ opening: { kind: 'door', width: 1000, height: 2100, sillHeight: 0 } });
  });

  it('참조 중 타입 삭제 거부, 미참조는 삭제', () => {
    const { store } = docWithWall();
    expect(store.deleteType(SEED_IDS.wall200)).toBe(false); // 벽이 참조 중
    expect(store.getType(SEED_IDS.wall200)).toBeDefined();
    expect(store.deleteType(SEED_IDS.wall100)).toBe(true); // 미참조
    expect(store.getType(SEED_IDS.wall100)).toBeUndefined();
  });
});
