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
  | 'curtainwall'
  | 'zone'
  | 'dimension'
  | 'text'
  | 'label'
  | 'sketch'
  | 'comment'
  | 'section'
  | 'elevation';
export type TypeKind =
  | 'wall'
  | 'door'
  | 'window'
  | 'slab'
  | 'column'
  | 'beam'
  | 'stair'
  | 'railing'
  | 'roof'
  | 'curtainwall';
export type ViewModeUi = '3d' | 'plan';
export type ConnectionState = 'connecting' | 'connected' | 'offline';
export type EditAction = 'move' | 'copy' | 'array' | 'split' | 'trim' | 'mirror' | 'rotate';
/** 정체성 순 작업 모드 (UI/UX 재구성 Part4) — P0=상태만 추가, mode 뼈대는 P1 Slice3. */
export type WorkspaceMode = 'review' | 'model' | 'hub' | 'drawing';
/** presence 아바타 파일용 협업자 정체성 (커서 위치 아님 — join/leave/rename/color만 변경) */
export interface PeerIdentity {
  clientId: number;
  name: string;
  color: string;
  self: boolean;
}

/**
 * UI 상태 전용 (불변 규칙 3: 문서 상태는 DocStore, 여기는 도구/선택/뷰 모드만).
 * React 밖(도구·씬)에서는 useUiStore.getState()/subscribe로 접근.
 */
interface UiState {
  activeTool: ToolName;
  /** 선택 요소 id 목록 (다중). 단일 선택 = 길이 1 */
  selection: Id[];
  viewMode: ViewModeUi;
  /** 정체성 순 작업 모드 (P0=미사용 prep, P1 mode 뼈대서 소비) */
  activeMode: WorkspaceMode;
  /** 도구별 활성 타입 (벽/문/창/슬라브) */
  activeTypes: Record<TypeKind, Id | null>;
  activeLevelId: Id | null;
  connection: ConnectionState;
  peerCount: number;
  /** 내 표시 이름 (presence 아바타 + 커서 라벨) */
  userName: string;
  /** 협업자 정체성 목록 (self + 원격) — 아바타 파일. presence가 signature-diff로만 갱신. */
  peers: PeerIdentity[];
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
  setMode: (m: WorkspaceMode) => void;
  setActiveType: (kind: TypeKind, id: Id) => void;
  setActiveLevel: (id: Id) => void;
  setConnection: (c: ConnectionState) => void;
  setPeerCount: (n: number) => void;
  setUserName: (name: string) => void;
  setPeers: (peers: PeerIdentity[]) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTool: 'wall',
  selection: [],
  viewMode: '3d',
  activeMode: 'review', // P1 Slice5: 협업·리뷰 = default 랜딩(헤드라인 해자 먼저). 모델링은 모델 탭.
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
    curtainwall: null,
  },
  activeLevelId: null,
  connection: 'connecting',
  peerCount: 0,
  userName: localStorage.getItem('figcad.userName') ?? '게스트',
  peers: [],
  editAction: null,
  arrayCount: 3,
  rotateAngle: 90,
  aiOpen: false,
  lintOpen: false,
  versionOpen: false,
  commentsOpen: false,
  drawingOpen: false,
  activeViewId: null,
  // 도구 부작용 전부 제거(P1): 스케치 무장(aiOpen+평면)은 AI dock 버튼, 코멘트는 핀만.
  setTool: (activeTool) => set({ activeTool, selection: [], editAction: null }),
  setSelection: (selection) =>
    set((s) => ({ selection, editAction: selection.length ? s.editAction : null })),
  setEditAction: (editAction) => set({ editAction }),
  setArrayCount: (arrayCount) => set({ arrayCount: Math.max(1, Math.min(50, arrayCount)) }),
  setRotateAngle: (rotateAngle) => set({ rotateAngle }),
  setAiOpen: (aiOpen) => set({ aiOpen }),
  // 배타 제거(P1 Slice5, Slice0 연기분) — lint/version은 협업 mode 레일 독립 섹션.
  setLintOpen: (lintOpen) => set({ lintOpen }),
  setVersionOpen: (versionOpen) => set({ versionOpen }),
  setCommentsOpen: (commentsOpen) => set({ commentsOpen }),
  setDrawingOpen: (drawingOpen) => set({ drawingOpen }),
  setActiveViewId: (activeViewId) => set({ activeViewId }),
  setViewMode: (viewMode) => set({ viewMode }),
  setMode: (activeMode) => set({ activeMode }),
  setUserName: (userName) => set({ userName }),
  setPeers: (peers) => set({ peers }),
  setActiveType: (kind, id) =>
    set((s) => ({ activeTypes: { ...s.activeTypes, [kind]: id } })),
  setActiveLevel: (activeLevelId) => set({ activeLevelId }),
  setConnection: (connection) => set({ connection }),
  setPeerCount: (peerCount) => set({ peerCount }),
}));
