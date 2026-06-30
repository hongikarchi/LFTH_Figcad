import { useEffect, useState } from 'react';
import type { DocStore } from '@figcad/core';
import type { FederationReconciler } from '../engine/FederationReconciler';
import { useUiStore } from '../state/uiStore';
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
      <AiPanel store={store} />
      <DrawingPanel store={store} />
      <CommandPalette store={store} actions={actions} />
    </>
  );
}
