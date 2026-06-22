import { useEffect, useState } from 'react';
import type { DocStore } from '@figcad/core';
import type { FederationReconciler } from '../engine/FederationReconciler';
import { TopBar } from './TopBar';
import { WorkRail } from './WorkRail';
import { Inspector } from './Inspector';
import { QuickOptions, type ViewActions } from './QuickOptions';
import { AiPanel } from './AiPanel';
import { DrawingPanel } from './DrawingPanel';

/** 협업 명령형 핸들 (presence) — React 패널에 노출되는 부분만. peers/connection은 uiStore. */
export interface CollabHandle {
  setUserName: (name: string) => void;
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
  return (
    <>
      <TopBar store={store} federation={federation} collab={collab} />
      <WorkRail store={store} actions={actions} />
      <Inspector store={store} />
      <QuickOptions store={store} />
      <AiPanel store={store} />
      <DrawingPanel store={store} />
    </>
  );
}
