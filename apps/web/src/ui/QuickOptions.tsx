import type { DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';
import { Icon } from './icons/Icon';

export interface ViewActions {
  /** 카메라 타깃 이동 (월드 m) — lint 요소 점프용 */
  focusWorld: (x: number, y: number, z: number) => void;
}

/**
 * ArchiCAD Quick Options Bar의 웹 경량판 — 하단 도킹.
 * 활성 탭(뷰)의 현재 설정 표시 + 빠른 변경 (줌, 활성 스토리).
 * (연결/인원 = P0 PresenceStrip · 검사/버전 = P1 Slice5 협업 mode + presence 배지로 이전.
 *  뷰/스토리·도면·AI는 Slice7/8/10서 정리. — QuickOptions 전체 해체 = Slice7.)
 */
export function QuickOptions({ store }: { store: DocStore }) {
  useDocVersion(store);
  const viewMode = useUiStore((s) => s.viewMode);
  const activeLevelId = useUiStore((s) => s.activeLevelId);
  const aiOpen = useUiStore((s) => s.aiOpen);
  const drawingOpen = useUiStore((s) => s.drawingOpen);

  const level = activeLevelId ? store.getLevel(activeLevelId) : undefined;
  const viewName = viewMode === '3d' ? '3D · 일반 원근' : `평면 · ${level?.name ?? '—'}`;

  return (
    <div className="quick-options">
      <span className="qo-view">{viewName}</span>
      <span className="qo-sep" />
      <label className="qo-story" title="활성 스토리 변경 (뷰 모드 유지 — 3D에서도 전환)">
        활성 스토리
        <select
          value={activeLevelId ?? ''}
          onChange={(e) => useUiStore.getState().setActiveLevel(e.target.value)}
        >
          {store.listLevels().map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <span className="qo-sep" />
      <button
        className={`qo-lint ${drawingOpen ? 'active' : ''}`}
        title="도면 — 평면/단면/입면 2D 도면 생성"
        onClick={() => useUiStore.getState().setDrawingOpen(!drawingOpen)}
      >
        <Icon name="slab" size={14} />
        도면
      </button>
      <button
        className={`qo-ai ${aiOpen ? 'active' : ''}`}
        title="AI 모드 — 자연어로 모델링 (계획 승인 방식)"
        onClick={() => useUiStore.getState().setAiOpen(!aiOpen)}
      >
        <Icon name="ai" size={14} />
        AI
      </button>
    </div>
  );
}
