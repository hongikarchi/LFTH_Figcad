import { create } from 'zustand';
import type { Id, SketchStyle, AssetKind } from '@figcad/core';

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
  | 'asset'
  | 'dimension'
  | 'measure'
  | 'label'
  | 'sketch'
  | 'sketch-pen'
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
/** 정체성 순 작업 모드 (UI/UX 재구성 iter-2). AI = 탭 아닌 앰비언트 dock(전 모드 토글, aiOpen). 도면=mode 아닌 view. */
export type WorkspaceMode = 'review' | 'model' | 'hub';
/** 디바이스 클래스 — 폰(모바일 네이티브 셸) vs 데스크톱/아이패드(현행 사이드 레일). useDeviceClass가 matchMedia로 셋. */
export type DeviceClass = 'phone' | 'desktop';
/** 단면(클리핑 플레인) — null=끔. axis=평면 법선축, t=모델 bbox 0~1 위치, flip=남길 쪽 반전. */
export type ClipState = { axis: 'x' | 'y' | 'z'; t: number; flip: boolean };
/** 폰 바텀시트 콘텐츠 (모바일 리뷰/뷰어 전용) — null=닫힘. 집중형 컴팩트 시트. */
export type PhoneSheet = 'models' | 'comment' | 'inspect' | 'version' | null;

/**
 * mode별 도구 팔레트 — select = 만능 baseline(전 모드). 모델=그리기,
 * 협업·리뷰=선택·스케치·주석(코멘트/레이블/치수). mode 전환 시 도구가 팔레트에 없으면 select로 리셋.
 * 텍스트('text')는 도구·AI 생성 완전 제거(레이블로 대체) — 스키마·deriveText·렌더만 back-compat 보존(기존 문서).
 * AI 도구(스케치)는 mode 아닌 AI dock서 무장. 도면(단면·입면)은 DrawingPanel서 진입.
 */
export const MODE_TOOLS: Record<WorkspaceMode, ToolName[]> = {
  review: ['select', 'measure', 'sketch', 'sketch-pen', 'comment', 'label'],
  model: [
    'select', 'wall', 'door', 'window', 'slab', 'grid', 'column', 'beam',
    'stair', 'railing', 'roof', 'curtainwall', 'zone', 'asset', 'measure', 'label', 'sketch-pen',
  ],
  hub: ['select'],
};

/** 마크업 펜 기본 스타일 (iter-3 스케치 업그레이드) */
export const DEFAULT_SKETCH_STYLE: SketchStyle = {
  color: '#0a84ff',
  opacity: 1,
  width: 3,
  lineType: 'solid',
};

/** AI 모델 선택 (서버 allowlist와 동기) — 정확(opus)/균형(sonnet)/빠름(haiku). */
export type AiModelId = 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001';
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
  /** AI 모델 선택(정확/균형/빠름) */
  aiModel: AiModelId;
  /** AI auto mode — 계획 승인 게이트 건너뛰고 자동 적용(에러 잔존 시 게이트 fallback) */
  aiAutoApply: boolean;
  /** AI dock 표시 (iter-2: AI = 탭 아닌 전 모드 앰비언트 dock 토글) */
  aiOpen: boolean;
  /** 마크업 펜 스타일·모드 (iter-3 스케치 업그레이드) — MarkupTool이 createSketch에 사용 */
  sketchStyle: SketchStyle;
  sketchMode: 'line' | 'zone';
  /** 오브젝트(엔투라지) 배치 종류 (항목7) — AssetTool이 createAsset에 사용 */
  assetKind: AssetKind;
  /** 디바이스 클래스 (모바일 반응형) — 폰이면 모바일 셸(바텀바·시트), 아니면 현행 레일 */
  device: DeviceClass;
  /** 폰 바텀시트 콘텐츠 (폰 전용) */
  phoneSheet: PhoneSheet;
  /** 단면(클리핑 플레인) — null=끔. 엔진 적용은 ViewActions.setClip(렌더러 clippingPlanes). */
  clip: ClipState | null;
  setDevice: (d: DeviceClass) => void;
  setPhoneSheet: (s: PhoneSheet) => void;
  setClipState: (c: ClipState | null) => void;
  setTool: (t: ToolName) => void;
  setSketchStyle: (patch: Partial<SketchStyle>) => void;
  setSketchMode: (m: 'line' | 'zone') => void;
  setAssetKind: (k: AssetKind) => void;
  setSelection: (ids: Id[]) => void;
  setEditAction: (a: EditAction | null) => void;
  setArrayCount: (n: number) => void;
  setRotateAngle: (deg: number) => void;
  setLintOpen: (open: boolean) => void;
  setVersionOpen: (open: boolean) => void;
  setCommentsOpen: (open: boolean) => void;
  setDrawingOpen: (open: boolean) => void;
  setActiveViewId: (id: Id | null) => void;
  setAiModel: (m: AiModelId) => void;
  setAiAutoApply: (v: boolean) => void;
  setAiOpen: (open: boolean) => void;
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
  activeTool: 'select', // 만능 baseline(피드백) — 협업 default서 클릭이 그리기 아닌 선택이 되도록
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
  lintOpen: false,
  versionOpen: false,
  commentsOpen: false,
  drawingOpen: false,
  activeViewId: null,
  aiModel: (localStorage.getItem('figcad.aiModel') as AiModelId | null) ?? 'claude-opus-4-8',
  aiAutoApply: false,
  aiOpen: false,
  sketchStyle: { ...DEFAULT_SKETCH_STYLE },
  sketchMode: 'line',
  assetKind: 'tree',
  device: 'desktop', // useDeviceClass가 mount 전 matchMedia로 교정(폰이면 'phone')
  phoneSheet: null,
  clip: null,
  setDevice: (device) => set({ device }),
  setPhoneSheet: (phoneSheet) => set({ phoneSheet }),
  setClipState: (clip) => set({ clip }),
  // 스케치는 평면+북향 필수(도구 요건) — 그 커플링만 유지. 패널 부작용(aiOpen)은 제거.
  setTool: (activeTool) =>
    set(
      activeTool === 'sketch'
        ? { activeTool, selection: [], editAction: null, viewMode: 'plan' }
        : { activeTool, selection: [], editAction: null },
    ),
  setSelection: (selection) =>
    set((s) => ({ selection, editAction: selection.length ? s.editAction : null })),
  setEditAction: (editAction) => set({ editAction }),
  setArrayCount: (arrayCount) => set({ arrayCount: Math.max(1, Math.min(50, arrayCount)) }),
  setRotateAngle: (rotateAngle) => set({ rotateAngle }),
  // 배타 제거(P1 Slice5, Slice0 연기분) — lint/version은 협업 mode 레일 독립 섹션.
  setLintOpen: (lintOpen) => set({ lintOpen }),
  setVersionOpen: (versionOpen) => set({ versionOpen }),
  setCommentsOpen: (commentsOpen) => set({ commentsOpen }),
  setDrawingOpen: (drawingOpen) => set({ drawingOpen }),
  setActiveViewId: (activeViewId) => set({ activeViewId }),
  setAiModel: (aiModel) => {
    localStorage.setItem('figcad.aiModel', aiModel);
    set({ aiModel });
  },
  setAiAutoApply: (aiAutoApply) => set({ aiAutoApply }),
  setAiOpen: (aiOpen) => set({ aiOpen }),
  setSketchStyle: (patch) => set((s) => ({ sketchStyle: { ...s.sketchStyle, ...patch } })),
  setSketchMode: (sketchMode) => set({ sketchMode }),
  setAssetKind: (assetKind) => set({ assetKind }),
  setViewMode: (viewMode) => set({ viewMode }),
  // mode 전환 = 그 mode 팔레트에 현재 도구 없으면 select로 리셋(한 곳, advisor)
  setMode: (activeMode) =>
    set((s) => ({
      activeMode,
      activeTool: MODE_TOOLS[activeMode].includes(s.activeTool) ? s.activeTool : 'select',
    })),
  setUserName: (userName) => set({ userName }),
  setPeers: (peers) => set({ peers }),
  setActiveType: (kind, id) =>
    set((s) => ({ activeTypes: { ...s.activeTypes, [kind]: id } })),
  setActiveLevel: (activeLevelId) => set({ activeLevelId }),
  setConnection: (connection) => set({ connection }),
  setPeerCount: (peerCount) => set({ peerCount }),
}));
