import { useEffect, useState } from 'react';
import type { DocStore } from '@figcad/core';
import { Toolbar } from './Toolbar';
import { PropertiesPanel } from './PropertiesPanel';

/** 문서 변경 시 리렌더 트리거 (React는 문서를 직접 안 들고 매 렌더 fresh 조회) */
export function useDocVersion(store: DocStore): number {
  const [v, setV] = useState(0);
  useEffect(() => store.observe(() => setV((x) => x + 1)), [store]);
  return v;
}

export function App({ store }: { store: DocStore }) {
  return (
    <>
      <Toolbar store={store} />
      <PropertiesPanel store={store} />
    </>
  );
}
