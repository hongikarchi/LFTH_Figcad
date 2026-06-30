import { useUiStore } from '../state/uiStore';
import { ModeTabs } from './ModeTabs';

/**
 * 폰 전용 하단 바 (모바일 반응형 — 엄지존). 모드 탭(재사용 ModeTabs) + 패널 시트 토글 + AI 토글.
 * 데스크톱/아이패드선 미렌더(App이 device==='phone'서만). undo/redo·fit·3D·층은 우하단 ViewportCluster 유지(역할 분리).
 */
export function BottomBar() {
  const phoneSheet = useUiStore((s) => s.phoneSheet);
  const setPhoneSheet = useUiStore((s) => s.setPhoneSheet);
  const aiOpen = useUiStore((s) => s.aiOpen);
  const setAiOpen = useUiStore((s) => s.setAiOpen);
  return (
    <div className="bottom-bar">
      <ModeTabs />
      <div className="bottom-bar-actions">
        <button
          className={`bottom-bar-btn ${phoneSheet ? 'active' : ''}`}
          onClick={() => setPhoneSheet(phoneSheet ? null : 'layers')}
          title="패널 — 탐색·검사·코멘트·버전"
        >
          ▤ 패널
        </button>
        <button
          className={`bottom-bar-btn ${aiOpen ? 'active' : ''}`}
          onClick={() => setAiOpen(!aiOpen)}
          title="AI"
        >
          ✦ AI
        </button>
      </div>
    </div>
  );
}
