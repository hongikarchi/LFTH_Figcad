import { create } from 'zustand';
import type { Id } from '@figcad/core';

export type ToolName = 'select' | 'wall' | 'door' | 'window' | 'slab' | 'grid';
export type TypeKind = 'wall' | 'door' | 'window' | 'slab';
export type ViewModeUi = '3d' | 'plan';
export type ConnectionState = 'connecting' | 'connected' | 'offline';

/**
 * UI 상태 전용 (불변 규칙 3: 문서 상태는 DocStore, 여기는 도구/선택/뷰 모드만).
 * React 밖(도구·씬)에서는 useUiStore.getState()/subscribe로 접근.
 */
interface UiState {
  activeTool: ToolName;
  selection: Id | null;
  viewMode: ViewModeUi;
  /** 도구별 활성 타입 (벽/문/창/슬라브) */
  activeTypes: Record<TypeKind, Id | null>;
  activeLevelId: Id | null;
  connection: ConnectionState;
  peerCount: number;
  setTool: (t: ToolName) => void;
  setSelection: (id: Id | null) => void;
  setViewMode: (m: ViewModeUi) => void;
  setActiveType: (kind: TypeKind, id: Id) => void;
  setActiveLevel: (id: Id) => void;
  setConnection: (c: ConnectionState) => void;
  setPeerCount: (n: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTool: 'wall',
  selection: null,
  viewMode: '3d',
  activeTypes: { wall: null, door: null, window: null, slab: null },
  activeLevelId: null,
  connection: 'connecting',
  peerCount: 0,
  setTool: (activeTool) => set({ activeTool, selection: null }),
  setSelection: (selection) => set({ selection }),
  setViewMode: (viewMode) => set({ viewMode }),
  setActiveType: (kind, id) =>
    set((s) => ({ activeTypes: { ...s.activeTypes, [kind]: id } })),
  setActiveLevel: (activeLevelId) => set({ activeLevelId }),
  setConnection: (connection) => set({ connection }),
  setPeerCount: (peerCount) => set({ peerCount }),
}));
