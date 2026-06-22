import { useState } from 'react';
import type { DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';

/**
 * 협업·리뷰 mode Inspector (UI/UX 재구성 P1 Slice5, mode-gated 선택) —
 * 요소 선택 시 그 요소(anchorId)의 코멘트 스레드 표시(속성 아님 — 속성은 모델 mode).
 * 새 핀은 코멘트 도구(💬)로. 여기선 기존 스레드 읽기/답글/해결.
 */
export function ReviewInspector({ store }: { store: DocStore }) {
  useDocVersion(store);
  const selection = useUiStore((s) => s.selection);
  const [reply, setReply] = useState<Record<string, string>>({});
  const author = localStorage.getItem('figcad.userName') ?? '게스트';

  if (selection.length !== 1) {
    return (
      <div className="inspector-hint">
        요소를 선택하면 그 요소의 코멘트 스레드가 여기 표시됩니다. 코멘트 도구(💬)로 요소 위를 클릭해 새 핀을 답니다.
      </div>
    );
  }

  const id = selection[0]!;
  const all = store.listComments();
  const roots = all.filter((c) => !c.parentId && c.anchorId === id).sort((a, b) => a.ts - b.ts);
  const repliesOf = (rid: string) => all.filter((c) => c.parentId === rid).sort((a, b) => a.ts - b.ts);
  const sendReply = (rootId: string) => {
    const t = (reply[rootId] ?? '').trim();
    if (!t) return;
    store.replyComment(rootId, { author, text: t });
    setReply((p) => ({ ...p, [rootId]: '' }));
  };

  return (
    <div className="review-inspector">
      <div className="ai-head">
        <span className="ai-title">코멘트</span>
        <span className="ai-sub">선택 요소 · {roots.length}건</span>
      </div>
      {roots.length === 0 && (
        <div className="inspector-hint">이 요소에 코멘트 없음. 코멘트 도구(💬)로 요소 위를 클릭해 답니다.</div>
      )}
      {roots.map((c) => (
        <div key={c.id} className={`cmt-item ${c.resolved ? 'resolved' : ''}`}>
          <div className="cmt-row">
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
  );
}
