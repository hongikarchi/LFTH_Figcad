import { useState } from 'react';
import { resolveCommentPoint, type Comment, type DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';
import type { ViewActions } from './QuickOptions';

/**
 * 협업 코멘트 패널 (M9-B) — 우측 도킹. 소장님↔실무자 리뷰 루프.
 * 루트 코멘트 + 답글 스레드, 해결 토글, 핀 점프. 코멘트 도구로 평면에 배치.
 */
export function CommentPanel({
  store,
  actions,
  embedded,
}: {
  store: DocStore;
  actions: ViewActions;
  embedded?: boolean;
}) {
  useDocVersion(store);
  const open = useUiStore((s) => s.commentsOpen);
  const [showResolved, setShowResolved] = useState(false);
  const [reply, setReply] = useState<Record<string, string>>({});

  if (!embedded && !open) return null;

  const all = store.listComments();
  const roots = all.filter((c) => !c.parentId).sort((a, b) => a.ts - b.ts);
  const repliesOf = (id: string) => all.filter((c) => c.parentId === id).sort((a, b) => a.ts - b.ts);
  const author = localStorage.getItem('figcad.userName') ?? '게스트';
  const visible = roots.filter((c) => showResolved || !c.resolved);

  const focus = (c: Comment) => {
    const pt = resolveCommentPoint(store, c);
    const elev = (store.getLevel(c.levelId)?.elevation ?? 0) / 1000;
    if (store.getLevel(c.levelId)) useUiStore.getState().setActiveLevel(c.levelId);
    actions.focusWorld(pt[0] / 1000, elev, pt[1] / 1000);
  };
  const sendReply = (rootId: string) => {
    const t = (reply[rootId] ?? '').trim();
    if (!t) return;
    store.replyComment(rootId, { author, text: t });
    setReply((p) => ({ ...p, [rootId]: '' }));
  };

  return (
    <div className={embedded ? 'rail-section' : 'cmt-panel'}>
      <div className="cmt-head">
        <span className="cmt-title">코멘트 {roots.length ? `(${roots.length})` : ''}</span>
        <label className="cmt-filter">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          해결 포함
        </label>
        {!embedded && (
          <button className="cmt-close" onClick={() => useUiStore.getState().setCommentsOpen(false)}>
            ✕
          </button>
        )}
      </div>
      <div className="cmt-list">
        {visible.length === 0 && (
          <div className="cmt-empty">코멘트 도구(💬)로 평면을 클릭해 코멘트를 답니다. 요소 위를 클릭하면 그 요소를 따라갑니다.</div>
        )}
        {visible.map((c) => (
          <div key={c.id} className={`cmt-item ${c.resolved ? 'resolved' : ''}`}>
            <div className="cmt-row">
              <button className="cmt-jump" title="위치로 이동" onClick={() => focus(c)}>
                📍
              </button>
              <span className="cmt-author">{c.author}</span>
              <span className="cmt-actions">
                <button onClick={() => store.resolveComment(c.id, !c.resolved)}>
                  {c.resolved ? '되돌리기' : '해결'}
                </button>
                <button className="cmt-del" onClick={() => store.deleteComment(c.id)}>
                  삭제
                </button>
              </span>
            </div>
            <div className="cmt-text">{c.text}</div>
            {repliesOf(c.id).map((r) => (
              <div key={r.id} className="cmt-reply">
                <span className="cmt-author">{r.author}</span>
                <span className="cmt-text">{r.text}</span>
              </div>
            ))}
            <div className="cmt-reply-input">
              <input
                value={reply[c.id] ?? ''}
                placeholder="답글…"
                onChange={(e) => setReply((p) => ({ ...p, [c.id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendReply(c.id);
                }}
              />
              <button onClick={() => sendReply(c.id)}>답글</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
