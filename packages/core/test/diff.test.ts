import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument, SEED_IDS, diffSnapshots, diffSummary, isDiffEmpty } from '../src';

function base(): DocStore {
  const store = new DocStore();
  seedDocument(store);
  store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
  return store;
}

describe('diffSnapshots', () => {
  it('동일 스냅샷 → 빈 diff', () => {
    const store = base();
    const d = diffSnapshots(store.snapshot(), store.snapshot());
    expect(isDiffEmpty(d)).toBe(true);
    expect(diffSummary(d)).toBe('변경 없음');
  });

  it('추가/삭제/필드 수정 분류', () => {
    const store = base();
    const before = store.snapshot();

    const [w1] = store.listElements();
    store.updateElement(w1!.id, { height: 2400 }); // 수정
    const w2 = store.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 5000], b: [3000, 5000] });
    store.createOpening({ hostId: w2, typeId: SEED_IDS.door900, offset: 1500 }); // 추가 2

    const d = diffSnapshots(before, store.snapshot());
    expect(d.added).toHaveLength(2);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toEqual([{ id: w1!.id, kind: 'wall', fields: ['height'] }]);
    expect(diffSummary(d)).toContain('+2');
    expect(diffSummary(d)).toContain('~1 수정');

    // 역방향 = 삭제
    const back = diffSnapshots(store.snapshot(), before);
    expect(back.removed).toHaveLength(2);
    expect(diffSummary(back)).toContain('−2');
  });

  it('레벨/타입 변경 카운트', () => {
    const store = base();
    const before = store.snapshot();
    store.updateLevel(SEED_IDS.level, { height: 3300 });
    store.updateType(SEED_IDS.wall200, { thickness: 250 });
    store.addLevel({ name: '2층', elevation: 3300, height: 3000, order: 1 });
    const d = diffSnapshots(before, store.snapshot());
    expect(d.levelChanges).toBe(2); // 수정 1 + 추가 1
    expect(d.typeChanges).toBe(1);
    expect(d.added).toHaveLength(0);
  });

  it('키 순서만 다른 스냅샷(canonical JSON 라운드트립) → 빈 diff', () => {
    const store = base();
    const snap = store.snapshot();
    // 커밋 저장 시와 동일하게 키를 정렬해 직렬화 → 파싱 (키 순서가 zod 순서와 달라짐)
    const sortKeys = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(sortKeys)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.keys(v as object)
                .sort()
                .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
            )
          : v;
    const roundtripped = JSON.parse(JSON.stringify(sortKeys(snap))) as typeof snap;
    expect(isDiffEmpty(diffSnapshots(roundtripped, snap))).toBe(true);
  });

  it('필드 제거(optional 필드 삭제)도 변경으로 잡음', () => {
    const store = base();
    const [w] = store.listElements();
    store.updateElement(w!.id, { height: 2400 });
    const withHeight = store.snapshot();
    store.updateElement(w!.id, { height: undefined });
    const d = diffSnapshots(withHeight, store.snapshot());
    expect(d.changed).toEqual([{ id: w!.id, kind: 'wall', fields: ['height'] }]);
  });
});
