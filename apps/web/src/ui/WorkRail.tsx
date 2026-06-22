import type { DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { Toolbox } from './Toolbox';
import { ProjectMap } from './ProjectMap';
import { CommentPanel } from './CommentPanel';
import { LintPanel } from './LintPanel';
import { VersionPanel } from './VersionPanel';
import { useDocVersion } from './App';
import type { ViewActions } from './QuickOptions';

/**
 * 좌 WorkRail (UI/UX 재구성 P1) — mode별 working surface.
 * 협업·리뷰: 코멘트 + 검사 + 버전(섹션). 모델: 도구(Toolbox) + 프로젝트 맵.
 * 허브/도면 mode rail = Slice6/10. P1.1=모델, P1 Slice5=협업 추가.
 */
export function WorkRail({ store, actions }: { store: DocStore; actions: ViewActions }) {
  const activeMode = useUiStore((s) => s.activeMode);
  useDocVersion(store);

  if (activeMode === 'review') {
    const noComments = store.listComments().length === 0;
    return (
      <div className="work-rail review">
        {noComments && (
          <div className="review-onboard">
            협업·리뷰 — 코멘트·검사·버전이 여기 모입니다. 상단 <b>공유</b>로 팀을 초대하세요.
          </div>
        )}
        <CommentPanel store={store} actions={actions} embedded />
        <LintPanel store={store} actions={actions} embedded />
        <VersionPanel store={store} embedded />
      </div>
    );
  }

  if (activeMode !== 'model') {
    return (
      <div className="work-rail">
        <div className="rail-empty">곧</div>
      </div>
    );
  }

  return (
    <div className="work-rail">
      <Toolbox />
      <ProjectMap store={store} />
    </div>
  );
}
