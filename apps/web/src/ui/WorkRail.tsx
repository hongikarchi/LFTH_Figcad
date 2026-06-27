import type { DocStore } from '@figcad/core';
import type { FederationReconciler } from '../engine/FederationReconciler';
import { useUiStore, MODE_TOOLS } from '../state/uiStore';
import { Toolbox } from './Toolbox';
import { ToolPalette } from './ToolPalette';
import { ProjectMap } from './ProjectMap';
import { CommentPanel } from './CommentPanel';
import { LintPanel } from './LintPanel';
import { VersionPanel } from './VersionPanel';
import { HubManage } from './HubManage';
import { useDocVersion, type ViewActions } from './App';

/**
 * 좌 WorkRail (UI/UX 재구성 iter-2) — mode별 working surface.
 * 협업·리뷰: 코멘트 + 버전(섹션). 모델: 도구(Toolbox) + 프로젝트 맵 + 검사(lintOpen 시 도킹).
 * 검사(lint)=모델링 이슈 해결이라 모델 모드에 둠(iter-2 1-1). 허브: HubManage. AI=탭 아닌 dock.
 */
export function WorkRail({
  store,
  actions,
  federation,
}: {
  store: DocStore;
  actions: ViewActions;
  federation: FederationReconciler;
}) {
  const activeMode = useUiStore((s) => s.activeMode);
  useDocVersion(store);

  if (activeMode === 'hub') {
    return (
      <div className="work-rail hub">
        <HubManage store={store} federation={federation} />
      </div>
    );
  }

  if (activeMode === 'review') {
    const noComments = store.listComments().length === 0;
    return (
      <div className="work-rail review">
        <ToolPalette tools={MODE_TOOLS.review} title="리뷰 도구" />
        {noComments && (
          <div className="review-onboard">
            협업·리뷰 — 코멘트·버전이 여기 모입니다. 상단 <b>공유</b>로 팀을 초대하세요. (검사는 모델 모드)
          </div>
        )}
        <CommentPanel store={store} actions={actions} embedded />
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
      {/* 검사(lint) — 모델 모드 도킹 패널. lintOpen일 때만 렌더(LintPanel 내부 게이트). */}
      <LintPanel store={store} actions={actions} />
    </div>
  );
}
