import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocStore, seedDocument, SEED_IDS } from '../src/store';
import { resolveCommentPoint } from '../src/select';

function setup() {
  const store = new DocStore();
  const seed = seedDocument(store);
  return { store, seed };
}

describe('코멘트 — CRUD/스레드', () => {
  it('addComment 루트 + replyComment 답글(parentId)', () => {
    const { store, seed } = setup();
    const root = store.addComment({ levelId: seed.levelId, at: [1000, 2000], author: '소장', text: '여기 벽 두께 확인' });
    const r1 = store.replyComment(root, { author: '실무', text: '200으로 했습니다' });
    expect(r1).toBeTruthy();
    const all = store.listComments();
    expect(all).toHaveLength(2);
    const reply = store.getComment(r1!)!;
    expect(reply.parentId).toBe(root);
    expect(store.getComment(root)!.parentId).toBeUndefined();
  });

  it('답글에는 답글 불가(루트만 대상)', () => {
    const { store, seed } = setup();
    const root = store.addComment({ levelId: seed.levelId, at: [0, 0], author: 'A', text: 'q' });
    const r = store.replyComment(root, { author: 'B', text: 'a' })!;
    expect(store.replyComment(r, { author: 'C', text: 'x' })).toBeNull();
  });

  it('resolve 토글 + delete 루트 = 답글 연쇄 삭제', () => {
    const { store, seed } = setup();
    const root = store.addComment({ levelId: seed.levelId, at: [0, 0], author: 'A', text: 'q' });
    store.replyComment(root, { author: 'B', text: 'a1' });
    store.replyComment(root, { author: 'C', text: 'a2' });
    store.resolveComment(root, true);
    expect(store.getComment(root)!.resolved).toBe(true);
    expect(store.listComments()).toHaveLength(3);
    store.deleteComment(root);
    expect(store.listComments()).toHaveLength(0); // 답글까지 연쇄
  });
});

describe('코멘트 — 앵커 추종 (D2 분리 재사용)', () => {
  it('anchorId 요소 추종 → 이동 따라감, 삭제 시 fallback at', () => {
    const { store, seed } = setup();
    const wall = store.createWall({ levelId: seed.levelId, typeId: SEED_IDS.wall200, a: [0, 0], b: [4000, 0] });
    const c = store.addComment({
      levelId: seed.levelId, at: [4000, 0], author: 'A', text: '이 끝점',
      anchorId: wall, anchorWhich: 'b',
    });
    const cm = () => store.getComment(c)!;
    expect(resolveCommentPoint(store, cm())).toEqual([4000, 0]); // wall.b
    store.updateElement(wall, { b: [5000, 0] });
    expect(resolveCommentPoint(store, cm())).toEqual([5000, 0]); // 추종
    store.deleteElements([wall]);
    expect(store.getComment(c)).toBeTruthy(); // 연쇄삭제 안 됨
    expect(resolveCommentPoint(store, cm())).toEqual([4000, 0]); // fallback at
  });
});

describe('코멘트 — 스냅샷 라운드트립 + v1 호환', () => {
  it('snapshot/fromSnapshot/importSnapshot 코멘트 보존', () => {
    const { store, seed } = setup();
    const root = store.addComment({ levelId: seed.levelId, at: [100, 200], author: 'A', text: 'q' });
    store.replyComment(root, { author: 'B', text: 'a' });
    const snap = store.snapshot();
    expect(snap.comments).toHaveLength(2);
    const restored = DocStore.fromSnapshot(snap);
    expect(restored.listComments()).toHaveLength(2);
    const s2 = new DocStore();
    seedDocument(s2);
    s2.importSnapshot(snap);
    expect(s2.listComments()).toHaveLength(2);
  });

  it('커밋 복원(comments 부재) = 라이브 코멘트 보존 / JSON([])=교체 (리뷰 critical 가드)', () => {
    const { store, seed } = setup();
    store.addComment({ levelId: seed.levelId, at: [0, 0], author: 'A', text: '리뷰 스레드' });
    const geomOnly = store.snapshot();
    // 커밋 blob엔 comments 없음(canonicalSnapshotJson 누락) → undefined로 복원
    const commitSnap = { ...geomOnly, comments: undefined };
    store.importSnapshot(commitSnap);
    expect(store.listComments()).toHaveLength(1); // 복원해도 코멘트 보존 (wipe 안 됨)
    // JSON 백업 복원은 comments 명시 → 교체 (빈 배열이면 비움)
    store.importSnapshot({ ...geomOnly, comments: [] });
    expect(store.listComments()).toHaveLength(0);
  });

  it('v1 스냅샷(comments 부재) import → throw 없음', () => {
    const { store } = setup();
    const snap = store.snapshot();
    expect(() => store.importSnapshot({ ...snap, meta: { ...snap.meta, schemaVersion: 1 }, comments: undefined })).not.toThrow();
  });
});

describe('코멘트 — 동시 답글 무클로버 (평면 엔트리 핵심)', () => {
  it('두 클라가 같은 루트에 동시 답글 → 둘 다 생존', () => {
    const a = new DocStore();
    seedDocument(a);
    const root = a.addComment({ levelId: SEED_IDS.level, at: [0, 0], author: 'A', text: 'q' });
    // a → b 동기화
    const b = new DocStore();
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    // 사이 동기화 없이 각자 답글
    a.replyComment(root, { author: 'A', text: '답A' });
    b.replyComment(root, { author: 'B', text: '답B' });
    // 상호 교환
    const av = Y.encodeStateVector(a.ydoc);
    const bv = Y.encodeStateVector(b.ydoc);
    Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, av));
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, bv));
    const repliesA = a.listComments().filter((c) => c.parentId === root).map((c) => c.text).sort();
    const repliesB = b.listComments().filter((c) => c.parentId === root).map((c) => c.text).sort();
    expect(repliesA).toEqual(['답A', '답B']); // 둘 다 생존 (클로버 없음)
    expect(repliesB).toEqual(['답A', '답B']);
  });
});
