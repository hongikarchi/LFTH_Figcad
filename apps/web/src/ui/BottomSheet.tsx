import type { DocStore } from '@figcad/core';
import type { FederationReconciler } from '../engine/FederationReconciler';
import { useUiStore } from '../state/uiStore';
import { CommentPanel } from './CommentPanel';
import { ReviewInspector } from './ReviewInspector';
import { VersionPanel } from './VersionPanel';
import { PhoneModelsSheet } from './PhoneModelsSheet';
import type { ViewActions } from './App';

const TITLE = { models: '모델 · 도면', comment: '코멘트', inspect: '검사', version: '버전' } as const;

/**
 * 폰 전용 바텀시트 (모바일 리뷰/뷰어) — phoneSheet별 집중 컴팩트 콘텐츠.
 * v1의 WorkRail+Inspector 통째 덤프 제거 → 모델·코멘트·검사만(모델링/타입편집/허브장황 미노출).
 * 닫기 = 그립/백드롭/✕ 탭.
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
      <div className="bottom-sheet" role="dialog" aria-label={TITLE[phoneSheet]}>
        <div className="bottom-sheet-grip" onClick={() => setPhoneSheet(null)}>
          <span className="bottom-sheet-handle" />
          <span className="bottom-sheet-title">{TITLE[phoneSheet]}</span>
          <button className="bottom-sheet-close" onClick={() => setPhoneSheet(null)} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="bottom-sheet-body">
          {phoneSheet === 'models' && <PhoneModelsSheet store={store} federation={federation} />}
          {phoneSheet === 'comment' && <CommentPanel store={store} actions={actions} embedded />}
          {phoneSheet === 'inspect' && <ReviewInspector store={store} />}
          {phoneSheet === 'version' && <VersionPanel store={store} actions={actions} embedded />}
        </div>
      </div>
    </>
  );
}
