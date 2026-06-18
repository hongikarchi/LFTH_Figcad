import { useEffect, useState } from 'react';
import type { DocStore } from '@figcad/core';
import type { FederationReconciler } from '../engine/FederationReconciler';
import { Toolbox } from './Toolbox';
import { InfoBox } from './InfoBox';
import { Navigator } from './Navigator';
import { EditActions } from './EditActions';
import { QuickOptions, type ViewActions } from './QuickOptions';
import { AiPanel } from './AiPanel';
import { LintPanel } from './LintPanel';
import { VersionPanel } from './VersionPanel';
import { CommentPanel } from './CommentPanel';
import { DrawingPanel } from './DrawingPanel';

/** 문서 변경 시 리렌더 트리거 (React는 문서를 직접 안 들고 매 렌더 fresh 조회) */
export function useDocVersion(store: DocStore): number {
  const [v, setV] = useState(0);
  useEffect(() => store.observe(() => setV((x) => x + 1)), [store]);
  return v;
}

/**
 * ArchiCAD 기본 워크스페이스의 웹 적응 (help.graphisoft.com 기본 팔레트 5종):
 * Toolbox(좌) · Info Box(상단 가로) · Navigator(우) · Quick Options(하단).
 * Tab Bar는 뷰 탭 수요가 생기는 2D 도면 단계에 도입.
 */
export function App({
  store,
  actions,
  federation,
}: {
  store: DocStore;
  actions: ViewActions;
  federation: FederationReconciler;
}) {
  return (
    <>
      <Toolbox />
      <InfoBox store={store} />
      <EditActions store={store} />
      <Navigator store={store} federation={federation} />
      <QuickOptions store={store} />
      <AiPanel store={store} />
      <LintPanel store={store} actions={actions} />
      <VersionPanel store={store} />
      <CommentPanel store={store} actions={actions} />
      <DrawingPanel store={store} />
    </>
  );
}
