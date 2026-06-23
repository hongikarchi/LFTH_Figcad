import type { DocStore, DrawingView } from '@figcad/core';
import { useUiStore, MODE_TOOLS } from '../state/uiStore';
import { useDocVersion } from './App';
import { ToolPalette } from './ToolPalette';

/**
 * 도면 mode 좌 WorkRail (UI/UX 재구성 P1 Slice10) — 도면 도구 팔레트 + 2D 뷰 목록.
 * 도구(단면·입면·치수·텍스트·레이블)는 캔버스서 그리고, 뷰 클릭/생성은 가운데 DrawingPanel(모달)을 연다.
 * (full Sheet-as-canvas = 후속/리스크 — 지금은 기존 DrawingPanel 모달 재사용.)
 */
export function DrawingRail({ store }: { store: DocStore }) {
  useDocVersion(store);
  const activeLevelId = useUiStore((s) => s.activeLevelId);
  const activeViewId = useUiStore((s) => s.activeViewId);
  const drawingOpen = useUiStore((s) => s.drawingOpen);
  const { setActiveViewId, setActiveLevel, setDrawingOpen } = useUiStore.getState();

  const VIEW_ORDER = { plan: 0, section: 1, elevation: 2 } as const;
  const views = [...store.listViews()].sort(
    (a, b) => VIEW_ORDER[a.type] - VIEW_ORDER[b.type] || a.name.localeCompare(b.name, 'ko'),
  );

  const openView = (v: DrawingView) => {
    setActiveViewId(v.id);
    if (v.type === 'plan' && v.levelId) setActiveLevel(v.levelId);
    setDrawingOpen(true);
  };
  const newPlan = () => {
    if (!activeLevelId) return;
    const lvl = store.getLevel(activeLevelId);
    const existing = store.listViews().find((v) => v.type === 'plan' && v.levelId === activeLevelId);
    const id =
      existing?.id ??
      store.createView({ name: `평면 · ${lvl?.name ?? '레벨'}`, type: 'plan', levelId: activeLevelId, cutHeight: 1200 });
    setActiveViewId(id);
    setDrawingOpen(true);
  };

  return (
    <div className="work-rail">
      <ToolPalette tools={MODE_TOOLS.drawing} title="도면 도구" />
      <div className="navigator embedded">
        <div className="nav-section">도면 뷰</div>
        {views.length === 0 ? (
          <div className="rail-hint">아직 도면 없음 — 현재 층 평면 생성 또는 단면/입면 도구로 그리기.</div>
        ) : (
          views.map((v) => (
            <button
              key={v.id}
              className={`nav-item indent ${drawingOpen && activeViewId === v.id ? 'active' : ''}`}
              onClick={() => openView(v)}
            >
              {v.name}
              <span className="nav-meta">
                {v.type === 'plan' ? '평면' : v.type === 'section' ? '단면' : '입면'}
              </span>
            </button>
          ))
        )}
        <button className="nav-item indent add" onClick={newPlan} disabled={!activeLevelId} title="현재 활성 층의 평면도 생성">
          + 현재 층 평면
        </button>
      </div>
    </div>
  );
}
