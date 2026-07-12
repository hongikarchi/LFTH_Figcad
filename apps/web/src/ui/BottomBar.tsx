import { useUiStore } from '../state/uiStore';

/**
 * 폰 전용 하단 바 (모바일 리뷰/뷰어 — 엄지존). 리뷰 동사 도구 토글(선택·코멘트·측정) + 패널(모델·AI) + 검사.
 * 도구 버튼 = setTool → 캔버스 탭(InputManager tapTool 합성클릭)이 그 도구로 라우팅 = 폰서 코멘트/마크업 "새로" 가능.
 * 폰=review 고정(useDeviceClass) — 모델링 도구는 절대 안 띄움.
 */
export function BottomBar() {
  const activeTool = useUiStore((s) => s.activeTool);
  const phoneSheet = useUiStore((s) => s.phoneSheet);
  const aiOpen = useUiStore((s) => s.aiOpen);
  const hasSelection = useUiStore((s) => s.selection.length > 0);
  const { setTool, setPhoneSheet, setAiOpen } = useUiStore.getState();

  return (
    <div className="bottom-bar">
      <button
        className={`bottom-bar-btn ${activeTool === 'select' ? 'active' : ''}`}
        onClick={() => { setTool('select'); setPhoneSheet(null); }}
      >
        👆 선택
      </button>
      <button
        className={`bottom-bar-btn ${activeTool === 'comment' ? 'active' : ''}`}
        title="코멘트 — 탭해서 핀 달기"
        onClick={() => { setTool('comment'); setPhoneSheet('comment'); }}
      >
        💬 코멘트
      </button>
      <button
        className={`bottom-bar-btn ${activeTool === 'measure' ? 'active' : ''}`}
        title="측정 — 두 점 탭해서 거리(줄자)"
        onClick={() => { setTool('measure'); setPhoneSheet(null); }}
      >
        📏 측정
      </button>
      {/* 마크업(sketch-pen)=프리핸드 드래그 도구 — 폰 터치선 1지 드래그=카메라라 stroke 입력 불가(리뷰어 P0).
          탭=점 1개라 stroke 안 됨 → 폰선 미노출. 폰 마크업은 1지-드래그-stroke 입력(불변4 스코프) 후속. */}
      <button
        className={`bottom-bar-btn ${phoneSheet === 'models' ? 'active' : ''}`}
        onClick={() => setPhoneSheet(phoneSheet === 'models' ? null : 'models')}
      >
        📦 모델
      </button>
      <button
        className={`bottom-bar-btn ${phoneSheet === 'viewpoint' ? 'active' : ''}`}
        title="공유 뷰포인트 — 팀이 저장한 카메라·단면으로 점프"
        onClick={() => setPhoneSheet(phoneSheet === 'viewpoint' ? null : 'viewpoint')}
      >
        📍 뷰
      </button>
      {hasSelection && (
        <button
          className={`bottom-bar-btn ${phoneSheet === 'inspect' ? 'active' : ''}`}
          onClick={() => setPhoneSheet(phoneSheet === 'inspect' ? null : 'inspect')}
        >
          ⓘ 검사
        </button>
      )}
      <button className={`bottom-bar-btn ${aiOpen ? 'active' : ''}`} onClick={() => setAiOpen(!aiOpen)}>
        ✦ AI
      </button>
    </div>
  );
}
