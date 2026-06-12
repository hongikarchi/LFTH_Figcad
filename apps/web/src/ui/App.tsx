import { useEffect, useState } from 'react';
import type { DocStore } from '@figcad/core';
import { Toolbox } from './Toolbox';
import { InfoBox } from './InfoBox';
import { Navigator } from './Navigator';
import { EditActions } from './EditActions';
import { QuickOptions, type ViewActions } from './QuickOptions';

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
export function App({ store, actions }: { store: DocStore; actions: ViewActions }) {
  return (
    <>
      <Toolbox />
      <InfoBox store={store} />
      <EditActions store={store} />
      <Navigator store={store} />
      <QuickOptions store={store} actions={actions} />
    </>
  );
}
