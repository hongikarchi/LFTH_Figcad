import type { DocStore } from '@figcad/core';
import type { FederationReconciler } from '../engine/FederationReconciler';
import { useUiStore } from '../state/uiStore';
import { WorkRail } from './WorkRail';
import { Inspector } from './Inspector';
import type { ViewActions } from './App';

/**
 * 폰 전용 바텀시트 (모바일 반응형) — 사이드 레일(WorkRail)+Inspector 내용을 드로어로 호스팅.
 * 컴포넌트 재사용: 시트 안에서 CSS가 .work-rail/.inspector를 static으로 재배치(로직 중복 없음).
 * 폰선 standalone 레일을 안 그리므로(App 분기) 시트가 유일 마운트 — 이중 마운트/옵저버 중복 없음.
 * 닫기 = 그립/백드롭/✕ 탭 (드래그-투-디스미스는 v2).
 */
export function BottomSheet({
  store,
  actions,
  federation,
}: {
  store: DocStore;
  actions: ViewActions;
  federation: FederationReconciler;
}) {
  const phoneSheet = useUiStore((s) => s.phoneSheet);
  const setPhoneSheet = useUiStore((s) => s.setPhoneSheet);
  if (!phoneSheet) return null;
  return (
    <>
      <div className="bottom-sheet-backdrop" onClick={() => setPhoneSheet(null)} />
      <div className="bottom-sheet" role="dialog" aria-label="패널">
        <div className="bottom-sheet-grip" onClick={() => setPhoneSheet(null)}>
          <span className="bottom-sheet-handle" />
          <button className="bottom-sheet-close" onClick={() => setPhoneSheet(null)} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="bottom-sheet-body">
          <WorkRail store={store} actions={actions} federation={federation} />
          <Inspector store={store} />
        </div>
      </div>
    </>
  );
}
