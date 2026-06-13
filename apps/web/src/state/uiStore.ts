import { create } from 'zustand';
import type { Id } from '@figcad/core';

export type ToolName = 'select' | 'wall' | 'door' | 'window' | 'slab' | 'grid';
export type TypeKind = 'wall' | 'door' | 'window' | 'slab';
export type ViewModeUi = '3d' | 'plan';
export type ConnectionState = 'connecting' | 'connected' | 'offline';
export type EditAction = 'move' | 'copy' | 'array' | 'split' | 'trim' | 'mirror' | 'rotate';

/**
 * UI 상태 전용 (불변 규칙 3: 문서 상태는 DocStore, 여기는 도구/선택/뷰 모드만).
 * React 밖(도구·씬)에서는 useUiStore.getState()/subscribe로 접근.
 */
interface UiState {
  activeTool: ToolName;
  /** 선택 요소 id 목록 (다중). 단일 선택 = 길이 1 */
  selection: Id[];
  viewMode: ViewModeUi;
  /** 도구별 활성 타입 (벽/문/창/슬라브) */
  activeTypes: Record<TypeKind, Id | null>;
  activeLevelId: Id | null;
  connection: ConnectionState;
  peerCount: number;
  /** 선택 후 무장된 편집 액션 (펫팔레트 경량판) */
  editAction: EditAction | null;
  arrayCount: number;
  rotateAngle: number; // 도(°), CCW+
  /** AI 모드 패널 표시 (M4) */
  aiOpen: boolean;
  /** 검사(lint) 패널 표시 (M5) */
  lintOpen: boolean;
  /** 버전 타임라인 패널 표시 (M6) — 검사 패널과 같은 슬롯(상호 배타) */
  versionOpen: boolean;
  setTool: (t: ToolName) => void;
  setSelection: (ids: Id[]) => void;
  setEditAction: (a: EditAction | null) => void;
  setArrayCount: (n: number) => void;
  setRotateAngle: (deg: number) => void;
  setAiOpen: (open: boolean) => void;
  setLintOpen: (open: boolean) => void;
  setVersionOpen: (open: boolean) => void;
  setViewMode: (m: ViewModeUi) => void;
  setActiveType: (kind: TypeKind, id: Id) => void;
  setActiveLevel: (id: Id) => void;
  setConnection: (c: ConnectionState) => void;
  setPeerCount: (n: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTool: 'wall',
  selection: [],
  viewMode: '3d',
  activeTypes: { wall: null, door: null, window: null, slab: null },
  activeLevelId: null,
  connection: 'connecting',
  peerCount: 0,
  editAction: null,
  arrayCount: 3,
  rotateAngle: 90,
  aiOpen: false,
  lintOpen: false,
  versionOpen: false,
  setTool: (activeTool) => set({ activeTool, selection: [], editAction: null }),
  setSelection: (selection) =>
    set((s) => ({ selection, editAction: selection.length ? s.editAction : null })),
  setEditAction: (editAction) => set({ editAction }),
  setArrayCount: (arrayCount) => set({ arrayCount: Math.max(1, Math.min(50, arrayCount)) }),
  setRotateAngle: (rotateAngle) => set({ rotateAngle }),
  setAiOpen: (aiOpen) => set({ aiOpen }),
  setLintOpen: (lintOpen) => set((s) => ({ lintOpen, versionOpen: lintOpen ? false : s.versionOpen })),
  setVersionOpen: (versionOpen) =>
    set((s) => ({ versionOpen, lintOpen: versionOpen ? false : s.lintOpen })),
  setViewMode: (viewMode) => set({ viewMode }),
  setActiveType: (kind, id) =>
    set((s) => ({ activeTypes: { ...s.activeTypes, [kind]: id } })),
  setActiveLevel: (activeLevelId) => set({ activeLevelId }),
  setConnection: (connection) => set({ connection }),
  setPeerCount: (peerCount) => set({ peerCount }),
}));
