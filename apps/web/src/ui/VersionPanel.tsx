import { useEffect, useState } from 'react';
import { diffSnapshots, diffSummary, type DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { commitVersion, fetchCommit, fetchLog, type CommitMeta } from '../version/versionClient';

/**
 * M6 버전 타임라인 패널 — 좌하단 (검사 패널과 같은 슬롯, 동시 열림 없음).
 * 커밋(메시지) / 타임라인 / 지금과 비교(시맨틱 diff) / 복원(importSnapshot — undo 가능).
 * 시점 3D 미리보기는 v1.5.
 */

function relTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return new Date(ts).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

export function VersionPanel({ store }: { store: DocStore }) {
  const versionOpen = useUiStore((s) => s.versionOpen);
  const [commits, setCommits] = useState<CommitMeta[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, string>>({}); // hash → 현재와의 diff 요약

  // 성공 시 notice를 건드리지 않음 — 직전 커밋/스킵 안내가 즉시 지워지면 안 됨
  const refresh = async () => {
    try {
      const log = await fetchLog();
      setCommits([...log.commits].reverse());
    } catch (e) {
      setNotice(`타임라인 로드 실패: ${e instanceof Error ? e.message : e}`);
    }
  };

  useEffect(() => {
    if (versionOpen) {
      setDiffs({}); // 닫혀 있는 동안의 편집으로 stale — 다시 열 때 비교 캐시 비움
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionOpen]);

  if (!versionOpen) return null;

  const doCommit = async () => {
    setBusy(true);
    try {
      const r = await commitVersion(message.trim());
      setMessage('');
      setDiffs({}); // 새 커밋으로 비교 기준이 바뀜
      setNotice(r.skipped ? '변경 없음 — 마지막 커밋과 동일해 스킵' : `✓ 커밋됨 (${r.meta!.hash.slice(0, 7)})`);
      await refresh();
    } catch (e) {
      setNotice(`커밋 실패: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  const showDiff = async (c: CommitMeta) => {
    if (diffs[c.hash]) {
      setDiffs(({ [c.hash]: _, ...rest }) => rest); // 토글 닫기
      return;
    }
    try {
      const snap = await fetchCommit(c.hash);
      // 커밋 → 현재 방향: "그때 이후 무엇이 달라졌나"
      const summary = diffSummary(diffSnapshots(snap, store.snapshot()));
      setDiffs((prev) => ({ ...prev, [c.hash]: summary }));
    } catch (e) {
      setNotice(`비교 실패: ${e instanceof Error ? e.message : e}`);
    }
  };

  const restore = async (c: CommitMeta) => {
    try {
      const snap = await fetchCommit(c.hash);
      const d = diffSnapshots(store.snapshot(), snap);
      if (
        !window.confirm(
          `'${c.message}' (${relTime(c.ts)}) 시점으로 복원합니다.\n변경: ${diffSummary(d)}\n협업 중인 모든 사용자에게 적용됩니다 (Ctrl+Z 가능). 계속할까요?`,
        )
      )
        return;
      store.importSnapshot(snap);
      setDiffs({}); // 문서가 바뀌어 기존 비교 결과는 무효
      setNotice(
        `✓ ${c.hash.slice(0, 7)} 시점으로 복원됨 — 메시지를 남기려면 커밋하세요 (안 해도 세션 종료 시 자동 기록)`,
      );
    } catch (e) {
      setNotice(`복원 실패: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <div className="version-panel">
      <div className="ai-head">
        <span className="ai-title">버전</span>
        <span className="ai-sub">커밋 = 문서 전체 스냅샷 (내용 같으면 자동 스킵)</span>
        <button className="ai-close" onClick={() => useUiStore.getState().setVersionOpen(false)}>
          ✕
        </button>
      </div>
      <div className="ver-commit">
        <input
          value={message}
          placeholder="커밋 메시지 (예: 1층 평면 확정)"
          maxLength={200}
          disabled={busy}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void doCommit();
          }}
        />
        <button disabled={busy} onClick={() => void doCommit()}>
          커밋
        </button>
      </div>
      {notice && <div className="ver-notice">{notice}</div>}
      <div className="ver-list">
        {commits.length === 0 && !notice && (
          <div className="lint-clean">아직 커밋이 없습니다 — 첫 커밋을 만들어 보세요</div>
        )}
        {commits.map((c) => (
          <div key={c.hash} className="ver-item">
            <div className="ver-row1">
              <span className="ver-msg">{c.message}</span>
              <span className="ver-hash">{c.hash.slice(0, 7)}</span>
            </div>
            <div className="ver-row2">
              <span>
                {c.author} · {relTime(c.ts)} · 요소 {c.elements}
              </span>
              <span className="ver-actions">
                <button onClick={() => void showDiff(c)}>비교</button>
                <button onClick={() => void restore(c)}>복원</button>
              </span>
            </div>
            {diffs[c.hash] && <div className="ver-diff">이후 변경: {diffs[c.hash]}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
