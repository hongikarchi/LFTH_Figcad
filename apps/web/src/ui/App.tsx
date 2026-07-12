import { useEffect, useState } from 'react';
import type { DocStore, Viewpoint, DocSnapshot } from '@figcad/core';
import type { ViewPreset } from '../engine/CameraRig';
import type { FederationReconciler } from '../engine/FederationReconciler';
import { useUiStore, type ClipState } from '../state/uiStore';
import { TopBar } from './TopBar';
import { WorkRail } from './WorkRail';
import { Inspector } from './Inspector';
import { ViewportCluster } from './ViewportCluster';
import { CommandPalette } from './CommandPalette';
import { AiPanel } from './AiPanel';
import { DrawingPanel } from './DrawingPanel';
import { BottomBar } from './BottomBar';
import { BottomSheet } from './BottomSheet';

/** 협업 명령형 핸들 (presence) — React 패널에 노출되는 부분만. peers/connection은 uiStore. */
export interface CollabHandle {
  setUserName: (name: string) => void;
}

/** 뷰/카메라 명령형 액션 — 캔버스 코너 ViewportCluster + lint/comment 점프가 사용 (P1 Slice7). */
export interface ViewActions {
  /** 카메라 타깃 이동 (월드 m) — lint/comment 점프용 */
  focusWorld: (x: number, y: number, z: number) => void;
  undo: () => void;
  redo: () => void;
  /** 전체 맞춤 (zoom-to-fit) */
  fit: () => void;
  /** 선택 맞춤 (zoom-to-selection, Z) — 선택 없으면 전체 맞춤 폴백 */
  fitSelection: () => void;
  /** 단면(클리핑 플레인) 적용 — null=해제. 모델 bbox 기준 평면 계산 → 렌더러 clippingPlanes. */
  setClip: (clip: ClipState | null) => void;
  /** 현재 카메라+단면을 뷰포인트로 저장(문서·공유) → id. name 없으면 "단면 N" 자동. */
  saveViewpoint: (name?: string) => string;
  /** 저장된 뷰포인트로 점프 — 카메라 포즈 + viewMode + 클립 재현("N번 단면 봐주세요"). */
  jumpViewpoint: (vp: Viewpoint) => void;
  /** 버전 비교 3D 오버레이 — 커밋 스냅샷(before) 표시, null=끄기. 추가/삭제(고스트)/변경 색 표기(항목4). */
  previewDiff: (snap: DocSnapshot | null) => void;
  /** 뷰 기즈모 프리셋 전환 — Top/Front/Back/Left/Right/Iso(항목8a). */
  setView: (preset: ViewPreset) => void;
}

/** 문서 변경 시 리렌더 트리거 (React는 문서를 직접 안 들고 매 렌더 fresh 조회) */
export function useDocVersion(store: DocStore): number {
  const [v, setV] = useState(0);
  useEffect(() => store.observe(() => setV((x) => x + 1)), [store]);
  return v;
}

/**
 * UI/UX 재구성 Part4 (전면 구조 재구성) — moat-frame + mode-swap 코어.
 * P0: 항상-on TopBar(프레임) 도입 = 실시간 presence(우) + 멀티모델 hub(중앙, Slice2).
 * Toolbox(좌)·InfoBox(상단)·Navigator(우)·QuickOptions(하단)는 P1 mode 뼈대서 재배치.
 */
export function App({
  store,
  actions,
  federation,
  collab,
}: {
  store: DocStore;
  actions: ViewActions;
  federation: FederationReconciler;
  collab: CollabHandle;
}) {
  // 모바일 반응형: 폰 = 바텀바+시트(사이드 레일은 시트가 호스팅), 데스크톱/아이패드 = 현행 좌우 레일.
  const phone = useUiStore((s) => s.device === 'phone');
  return (
    <>
      <TopBar store={store} federation={federation} collab={collab} />
      {phone ? (
        <>
          <BottomBar />
          <BottomSheet store={store} actions={actions} federation={federation} />
        </>
      ) : (
        <>
          <WorkRail store={store} actions={actions} federation={federation} />
          <Inspector store={store} />
        </>
      )}
      <ViewportCluster store={store} actions={actions} />
      {/* 뷰 기즈모 = hud/AxisGizmo(명령형 DOM, main.ts 마운트) — 8a 텍스트 그리드는 S2에서 대체 */}
      <AiPanel store={store} federation={federation} actions={actions} />
      <DrawingPanel store={store} />
      <CommandPalette store={store} actions={actions} />
    </>
  );
}
