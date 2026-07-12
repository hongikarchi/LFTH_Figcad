import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument, SEED_IDS } from '../src/store';

// PDF 다중 페이지 — setUnderlayPage 계약(리뷰: core 단위 테스트 부재 지적 해소).

function withPdf(store: DocStore, underlay = true) {
  return store.addFederationSource({
    name: 'a.pdf',
    sourceType: 'pdf',
    ref: 'blob:x',
    visible: true,
    addedBy: 't',
    ...(underlay
      ? { underlay: { levelId: SEED_IDS.level, origin: [0, 0] as [number, number], rotation: 0, scale: 1 } }
      : {}),
  });
}

describe('setUnderlayPage', () => {
  it('pdf+underlay만 갱신, 하한 1 클램프·반올림', () => {
    const s = new DocStore();
    seedDocument(s);
    const id = withPdf(s);
    s.setUnderlayPage(id, 3);
    expect(s.getFederationSource(id)?.underlay?.page).toBe(3);
    s.setUnderlayPage(id, 0);
    expect(s.getFederationSource(id)?.underlay?.page).toBe(1); // 하한
    s.setUnderlayPage(id, 2.6);
    expect(s.getFederationSource(id)?.underlay?.page).toBe(3); // 반올림 (int 스키마)
  });

  it('underlay 없는 pdf·비pdf 소스 = no-op (fed-register 유래 방어)', () => {
    const s = new DocStore();
    seedDocument(s);
    const bare = withPdf(s, false);
    s.setUnderlayPage(bare, 2);
    expect(s.getFederationSource(bare)?.underlay).toBeUndefined();

    const img = s.addFederationSource({
      name: 'x.png', sourceType: 'image', ref: 'blob:y', visible: true, addedBy: 't',
      underlay: { levelId: SEED_IDS.level, origin: [0, 0], rotation: 0, scale: 1 },
    });
    s.setUnderlayPage(img, 2);
    expect(s.getFederationSource(img)?.underlay?.page).toBeUndefined();
  });

  it('스냅샷 라운드트립에 page 보존 (federation 채널 관통)', () => {
    const a = new DocStore();
    seedDocument(a);
    const id = withPdf(a);
    a.setUnderlayPage(id, 4);
    const b = DocStore.fromSnapshot(a.snapshot());
    expect(b.getFederationSource(id)?.underlay?.page).toBe(4);
  });
});
