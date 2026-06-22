import type { CollabHandle } from './App';
import { PresenceStrip } from './PresenceStrip';

/**
 * Moat-frame (UI/UX 재구성 Part4) — 절대 unmount 안 하는 항상-on 상단 프레임.
 * 정체성 헤드라인: 멀티모델 hub(중앙, Slice2) + 실시간 presence(우).
 * 좌 = 룸 식별(P1서 ☰ Doc 메뉴 + mode 탭). 중앙 = hub strip 슬롯(Slice2 채움).
 */
export function TopBar({ collab }: { collab: CollabHandle }) {
  const room = new URL(location.href).searchParams.get('p') ?? '—';
  return (
    <div className="topbar">
      <div className="topbar-left">
        <span className="topbar-brand">Figcad</span>
        <span className="topbar-room" title="이 프로젝트 룸 (?p=) — 공유 = 이 URL">
          {room}
        </span>
      </div>
      <div className="topbar-center">{/* Slice2: HubStrip (멀티모델 hub) */}</div>
      <div className="topbar-right">
        <PresenceStrip collab={collab} />
      </div>
    </div>
  );
}
