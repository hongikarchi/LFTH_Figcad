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
  const [qrFailed, setQrFailed] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);
  // WebKit은 compositionend이 keydown(Enter, isComposing=false)보다 먼저 — 직후 Enter는 조합 확정용
  const composeEndAt = useRef(0);

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
    setQrFailed(false);
    // QR = 팝오버 열 때만 로드 (아이패드 카메라 스캔 → 같은 룸 즉시 참여).
    // catch는 체인 전체 — import 자체 실패(스테일 탭 재배포 404·오프라인)도 빈 캔버스 대신 폴백 안내.
    void import('qrcode')
      .then((QR) => (qrRef.current ? QR.toCanvas(qrRef.current, location.href, { width: 148, margin: 1 }) : undefined))
      .catch(() => setQrFailed(true));
  }, [shareOpen]);

  const commitRename = (raw: string) => {
    setRenaming(false);
    const name = raw.trim();
    if (name) collab.setUserName(name);
  };

  const copyUrl = () => {
    const fallback = () => window.prompt('이 URL을 복사해 공유하세요', location.href);
    // LAN HTTP(iPad 데브)는 비보안 컨텍스트 — navigator.clipboard 자체가 undefined (동기 throw 방지)
    if (!navigator.clipboard?.writeText) return void fallback();
    void navigator.clipboard
      .writeText(location.href)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(fallback);
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
            // 편집 중 아바타 탭 = 커밋+닫기. preventDefault로 포커스 강탈 차단 —
            // Chromium은 blur-커밋 후 click 토글이 재오픈, WebKit은 blur 없이 언마운트(입력 유실)라 토글 불가.
            onPointerDown={p.self && renaming ? (e) => e.preventDefault() : undefined}
            onClick={
              p.self
                ? () => {
                    if (renaming) commitRename(renameRef.current?.value ?? '');
                    else {
                      setShareOpen(false); // 같은 앵커 겹침 방지 — 팝오버 상호 배타
                      setRenaming(true);
                    }
                  }
                : undefined
            }
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
            onCompositionEnd={() => {
              composeEndAt.current = performance.now();
            }}
            onKeyDown={(e) => {
              // IME 조합 가드 — Chromium: isComposing=true / WebKit: compositionend 선행 후 평문 Enter
              if (e.nativeEvent.isComposing || performance.now() - composeEndAt.current < 60) return;
              if (e.key === 'Enter') commitRename((e.target as HTMLInputElement).value);
              else if (e.key === 'Escape') setRenaming(false);
            }}
            onBlur={(e) => commitRename(e.target.value)}
          />
        </div>
      )}
      <button
        className="presence-share"
        onClick={() => {
          if (renaming) commitRename(renameRef.current?.value ?? ''); // 팝오버 상호 배타 (WebKit은 blur 안 옴)
          setShareOpen((o) => !o);
        }}
        title="공유 — URL 복사·QR(아이패드 카메라로 스캔해 같은 룸 참여)"
      >
        공유
      </button>
      {shareOpen && (
        <div className="presence-pop presence-share-pop" role="dialog" aria-label="룸 공유">
          <canvas ref={qrRef} width={148} height={148} style={qrFailed ? { display: 'none' } : undefined} />
          <div className="presence-share-hint">
            {qrFailed ? 'QR 로드 실패 — 아래 URL 복사로 공유' : '카메라로 스캔 — 같은 룸 즉시 참여'}
          </div>
          <button className="presence-share" onClick={copyUrl}>
            {copied ? '✓ 복사됨' : 'URL 복사'}
          </button>
        </div>
      )}
    </div>
  );
}
