import { create } from 'zustand';
import type { Id } from '@figcad/core';

export type ToolName = 'select' | 'wall';
export type ViewModeUi = '3d' | 'plan';

/**
 * UI 상태 전용 (불변 규칙 3: 문서 상태는 DocStore, 여기는 도구/선택/뷰 모드만).
 * React 밖(도구·씬)에서는 useUiStore.getState()/subscribe로 접근.
 */
interface UiState {
  activeTool: ToolName;
  selection: Id | null;
  viewMode: ViewModeUi;
  activeWallTypeId: Id | null;
  activeLevelId: Id | null;
  setTool: (t: ToolName) => void;
  setSelection: (id: Id | null) => void;
  setViewMode: (m: ViewModeUi) => void;
  setActiveWallType: (id: Id) => void;
  setActiveLevel: (id: Id) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTool: 'wall',
  selection: null,
  viewMode: '3d',
  activeWallTypeId: null,
  activeLevelId: null,
  setTool: (activeTool) => set({ activeTool, selection: null }),
  setSelection: (selection) => set({ selection }),
  setViewMode: (viewMode) => set({ viewMode }),
  setActiveWallType: (activeWallTypeId) => set({ activeWallTypeId }),
  setActiveLevel: (activeLevelId) => set({ activeLevelId }),
}));
