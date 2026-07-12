import { useEffect, useRef, useState } from 'react';
import type { DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useLint } from './LintPanel';
import type { CollabHandle } from './App';

/**
 * 실시간 협업 = 헤드라인 해자 (UI/UX 재구성 P0-2). 현 "N명 동시작업" 텍스트를 대체:
 * 아바타 파일(나 + 협업자) + 연결 점 + Share(URL 복사 + QR — 2기기 온보딩) +
 * 인라인 rename(내 아바타 탭 — window.prompt 대체, Presence 잔여 소품).
 * peers는 presence가 signature-diff로만 갱신(불변③ — 커서 이동마다 리렌더 안 함).
 * QR 인코더(qrcode)는 팝오버 열 때만 동적 import — 메인 번들 무영향.
 */
const CONN: Record<string, [string, string]> = {
  connected: ['#34c759', '실시간 연결됨'],
  connecting: ['#ff9500', '연결 중…'],
  offline: ['#8e8e93', '오프라인'],
};
const MAX_AVATARS = 5;
const initial = (name: string) => name.trim()[0]?.toUpperCase() ?? '?';

export function PresenceStrip({ collab, store }: { collab: CollabHandle; store: DocStore }) {
  const peers = useUiStore((s) => s.peers);
  const connection = useUiStore((s) => s.connection);
  const findings = useLint(store);
  const worst = findings[0]?.severity; // lint()는 심각도순 정렬
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);

  const [dotColor, connLabel] = CONN[connection] ?? CONN.offline!;
  const self = peers.find((p) => p.self);
  const others = peers.filter((p) => !p.self);
  const ordered = [...(self ? [self] : []), ...others];
  const shown = ordered.slice(0, MAX_AVATARS);
  const overflow = ordered.length - shown.length;

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);
  useEffect(() => {
    if (!shareOpen || !qrRef.current) return;
    // QR = 팝오버 열 때만 로드 (아이패드 카메라 스캔 → 같은 룸 즉시 참여)
    void import('qrcode').then((QR) =>
      QR.toCanvas(qrRef.current!, location.href, { width: 148, margin: 1 }).catch(() => {}),
    );
  }, [shareOpen]);

  const commitRename = (raw: string) => {
    setRenaming(false);
    const name = raw.trim();
    if (name) collab.setUserName(name);
  };

  const copyUrl = () => {
    void navigator.clipboard
      .writeText(location.href)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => window.prompt('이 URL을 복사해 공유하세요', location.href));
  };

  const aiOpen = useUiStore((s) => s.aiOpen);

  return (
    <div className="presence-strip">
      <button
        className={`ai-toggle ${aiOpen ? 'active' : ''}`}
        title="AI — 손그림→모델·자연어 편집 (전 모드에서 사용)"
        onClick={() => useUiStore.getState().setAiOpen(!aiOpen)}
      >
        ✦ AI
      </button>
      {findings.length > 0 && (
        <button
          className={`lint-badge ${worst ?? ''}`}
          title="데이터 위생 검사 — 눌러 모델 모드에서 문제 해결"
          onClick={() => {
            const s = useUiStore.getState();
            s.setMode('model');
            s.setLintOpen(true);
          }}
        >
          검사 {findings.length}
        </button>
      )}
      <span className="presence-dot" style={{ background: dotColor }} title={connLabel} />
      <div className="avatar-pile" title={`${ordered.length}명 (${connLabel})`}>
        {shown.map((p) => (
          <button
            key={p.clientId}
            className={`avatar ${p.self ? 'self' : ''}`}
            style={{ background: p.color }}
            title={p.self ? `${p.name} (나) — 탭하면 이름 변경` : p.name}
            onClick={p.self ? () => setRenaming((r) => !r) : undefined}
          >
            {initial(p.name)}
          </button>
        ))}
        {overflow > 0 && <span className="avatar more">+{overflow}</span>}
      </div>
      {renaming && (
        <div className="presence-pop" role="dialog" aria-label="이름 변경">
          <input
            ref={renameRef}
            className="presence-rename"
            defaultValue={useUiStore.getState().userName}
            maxLength={24}
            placeholder="표시 이름"
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return; // 한글 IME 조합 중 Enter 무시
              if (e.key === 'Enter') commitRename((e.target as HTMLInputElement).value);
              else if (e.key === 'Escape') setRenaming(false);
            }}
            onBlur={(e) => commitRename(e.target.value)}
          />
        </div>
      )}
      <button
        className="presence-share"
        onClick={() => setShareOpen((o) => !o)}
        title="공유 — URL 복사·QR(아이패드 카메라로 스캔해 같은 룸 참여)"
      >
        공유
      </button>
      {shareOpen && (
        <div className="presence-pop presence-share-pop" role="dialog" aria-label="룸 공유">
          <canvas ref={qrRef} width={148} height={148} />
          <div className="presence-share-hint">카메라로 스캔 — 같은 룸 즉시 참여</div>
          <button className="presence-share" onClick={copyUrl}>
            {copied ? '✓ 복사됨' : 'URL 복사'}
          </button>
        </div>
      )}
    </div>
  );
}
