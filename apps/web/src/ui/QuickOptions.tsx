import type { DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';

export interface ViewActions {
  zoomIn: () => void;
  zoomOut: () => void;
}

/**
 * ArchiCAD Quick Options Bar의 웹 경량판 — 하단 도킹.
 * 활성 탭(뷰)의 현재 설정 표시 + 빠른 변경 (줌, 활성 스토리).
 */
export function QuickOptions({ store, actions }: { store: DocStore; actions: ViewActions }) {
  useDocVersion(store);
  const viewMode = useUiStore((s) => s.viewMode);
  const activeLevelId = useUiStore((s) => s.activeLevelId);

  const level = activeLevelId ? store.getLevel(activeLevelId) : undefined;
  const viewName = viewMode === '3d' ? '3D · 일반 원근' : `평면 · ${level?.name ?? '—'}`;

  return (
    <div className="quick-options">
      <span className="qo-view">{viewName}</span>
      <span className="qo-sep" />
      <span className="qo-label">활성 스토리: {level?.name ?? '—'}</span>
      <span className="qo-sep" />
      <button onClick={actions.zoomOut} title="줌아웃 (PageDown)">
        −
      </button>
      <button onClick={actions.zoomIn} title="줌인 (PageUp)">
        +
      </button>
    </div>
  );
}
