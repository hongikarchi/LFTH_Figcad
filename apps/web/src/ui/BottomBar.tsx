import { useUiStore, type PhoneSheet } from '../state/uiStore';

/**
 * 폰 전용 하단 바 (모바일 리뷰/뷰어 — 엄지존). 기능 버튼: 모델·코멘트·AI + 선택 시 검사.
 * 모드 탭 없음(폰=리뷰/뷰어 고정). 각 버튼 = 집중 컴팩트 시트. undo/redo·fit·3D·층은 우하 ViewportCluster.
 */
export function BottomBar() {
  const phoneSheet = useUiStore((s) => s.phoneSheet);
  const setPhoneSheet = useUiStore((s) => s.setPhoneSheet);
  const aiOpen = useUiStore((s) => s.aiOpen);
  const setAiOpen = useUiStore((s) => s.setAiOpen);
  const hasSelection = useUiStore((s) => s.selection.length > 0);
  const toggle = (sheet: PhoneSheet): void => setPhoneSheet(phoneSheet === sheet ? null : sheet);
  return (
    <div className="bottom-bar">
      <button className={`bottom-bar-btn ${phoneSheet === 'models' ? 'active' : ''}`} onClick={() => toggle('models')}>
        📦 모델
      </button>
      <button className={`bottom-bar-btn ${phoneSheet === 'comment' ? 'active' : ''}`} onClick={() => toggle('comment')}>
        💬 코멘트
      </button>
      {hasSelection && (
        <button className={`bottom-bar-btn ${phoneSheet === 'inspect' ? 'active' : ''}`} onClick={() => toggle('inspect')}>
          ⓘ 검사
        </button>
      )}
      <button className={`bottom-bar-btn ${aiOpen ? 'active' : ''}`} onClick={() => setAiOpen(!aiOpen)}>
        ✦ AI
      </button>
    </div>
  );
}
