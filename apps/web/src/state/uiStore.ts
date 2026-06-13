import { create } from 'zustand';
import type { Id } from '@figcad/core';

export type ToolName =
  | 'select'
  | 'wall'
  | 'door'
  | 'window'
  | 'slab'
  | 'grid'
  | 'column'
  | 'beam'
  | 'stair'
  | 'railing'
  | 'roof'
  | 'dimension'
  | 'text'
  | 'sketch'
  | 'comment'
  | 'section';
export type TypeKind =
  | 'wall'
  | 'door'
  | 'window'
  | 'slab'
  | 'column'
  | 'beam'
  | 'stair'
  | 'railing'
  | 'roof';
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
  /** 협업 코멘트 패널 표시 (M9-B) */
  commentsOpen: boolean;
  /** 도면 시트 패널 표시 (M11) */
  drawingOpen: boolean;
  /** 활성 도면 뷰 id */
  activeViewId: Id | null;
  setTool: (t: ToolName) => void;
  setSelection: (ids: Id[]) => void;
  setEditAction: (a: EditAction | null) => void;
  setArrayCount: (n: number) => void;
  setRotateAngle: (deg: number) => void;
  setAiOpen: (open: boolean) => void;
  setLintOpen: (open: boolean) => void;
  setVersionOpen: (open: boolean) => void;
  setCommentsOpen: (open: boolean) => void;
  setDrawingOpen: (open: boolean) => void;
  setActiveViewId: (id: Id | null) => void;
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
  activeTypes: {
    wall: null,
    door: null,
    window: null,
    slab: null,
    column: null,
    beam: null,
    stair: null,
    railing: null,
    roof: null,
  },
  activeLevelId: null,
  connection: 'connecting',
  peerCount: 0,
  editAction: null,
  arrayCount: 3,
  rotateAngle: 90,
  aiOpen: false,
  lintOpen: false,
  versionOpen: false,
  commentsOpen: false,
  drawingOpen: false,
  activeViewId: null,
  setTool: (activeTool) =>
    set(
      activeTool === 'sketch'
        ? // 스케치 = AI 입력 → AI 패널 + 북향 평면(SketchTool.activate가 theta 스냅)
          { activeTool, selection: [], editAction: null, aiOpen: true, viewMode: 'plan' }
        : activeTool === 'comment'
          ? // 코멘트 도구 = 코멘트 패널 표시
            { activeTool, selection: [], editAction: null, commentsOpen: true }
          : { activeTool, selection: [], editAction: null },
    ),
  setSelection: (selection) =>
    set((s) => ({ selection, editAction: selection.length ? s.editAction : null })),
  setEditAction: (editAction) => set({ editAction }),
  setArrayCount: (arrayCount) => set({ arrayCount: Math.max(1, Math.min(50, arrayCount)) }),
  setRotateAngle: (rotateAngle) => set({ rotateAngle }),
  setAiOpen: (aiOpen) => set({ aiOpen }),
  setLintOpen: (lintOpen) => set((s) => ({ lintOpen, versionOpen: lintOpen ? false : s.versionOpen })),
  setVersionOpen: (versionOpen) =>
    set((s) => ({ versionOpen, lintOpen: versionOpen ? false : s.lintOpen })),
  setCommentsOpen: (commentsOpen) => set({ commentsOpen }),
  setDrawingOpen: (drawingOpen) => set({ drawingOpen }),
  setActiveViewId: (activeViewId) => set({ activeViewId }),
  setViewMode: (viewMode) => set({ viewMode }),
  setActiveType: (kind, id) =>
    set((s) => ({ activeTypes: { ...s.activeTypes, [kind]: id } })),
  setActiveLevel: (activeLevelId) => set({ activeLevelId }),
  setConnection: (connection) => set({ connection }),
  setPeerCount: (peerCount) => set({ peerCount }),
}));
