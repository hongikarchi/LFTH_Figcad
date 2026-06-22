import { useState } from 'react';
import { useUiStore } from '../state/uiStore';
import type { CollabHandle } from './App';

/**
 * 실시간 협업 = 헤드라인 해자 (UI/UX 재구성 P0-2). 현 "N명 동시작업" 텍스트를 대체:
 * 아바타 파일(나 + 협업자) + 연결 점 + Share(룸 URL 복사) + rename(내 아바타 탭).
 * peers는 presence가 signature-diff로만 갱신(불변③ — 커서 이동마다 리렌더 안 함).
 */
const CONN: Record<string, [string, string]> = {
  connected: ['#34c759', '실시간 연결됨'],
  connecting: ['#ff9500', '연결 중…'],
  offline: ['#8e8e93', '오프라인'],
};
const MAX_AVATARS = 5;
const initial = (name: string) => name.trim()[0]?.toUpperCase() ?? '?';

export function PresenceStrip({ collab }: { collab: CollabHandle }) {
  const peers = useUiStore((s) => s.peers);
  const connection = useUiStore((s) => s.connection);
  const [copied, setCopied] = useState(false);

  const [dotColor, connLabel] = CONN[connection] ?? CONN.offline!;
  const self = peers.find((p) => p.self);
  const others = peers.filter((p) => !p.self);
  const ordered = [...(self ? [self] : []), ...others];
  const shown = ordered.slice(0, MAX_AVATARS);
  const overflow = ordered.length - shown.length;

  const rename = () => {
    const name = window.prompt('표시 이름', useUiStore.getState().userName);
    if (name && name.trim()) collab.setUserName(name.trim());
  };

  const share = () => {
    void navigator.clipboard
      .writeText(location.href)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => window.prompt('이 URL을 복사해 공유하세요', location.href));
  };

  return (
    <div className="presence-strip">
      <span className="presence-dot" style={{ background: dotColor }} title={connLabel} />
      <div className="avatar-pile" title={`${ordered.length}명 (${connLabel})`}>
        {shown.map((p) => (
          <button
            key={p.clientId}
            className={`avatar ${p.self ? 'self' : ''}`}
            style={{ background: p.color }}
            title={p.self ? `${p.name} (나) — 탭하면 이름 변경` : p.name}
            onClick={p.self ? rename : undefined}
          >
            {initial(p.name)}
          </button>
        ))}
        {overflow > 0 && <span className="avatar more">+{overflow}</span>}
      </div>
      <button className="presence-share" onClick={share} title="이 룸 URL을 복사해 공유">
        {copied ? '✓ 복사됨' : '공유'}
      </button>
    </div>
  );
}
