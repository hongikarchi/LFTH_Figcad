import type { DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { InfoBox } from './InfoBox';
import { EditActions } from './EditActions';
import { TypesSection } from './TypesSection';
import { ReviewInspector } from './ReviewInspector';

/**
 * 우 Inspector (UI/UX 재구성 P1) — 영구 도킹 셸, 내용 = (selection × mode).
 * 한 함수가 mode별 내용 결정(advisor): mode-gated↔selection-persistent 전환을 1곳 변경으로.
 * 모델: 선택 속성(InfoBox, additive) + 변환 스트립(EditActions) + 타입(영구, 선택 무관).
 * 협업/허브/도면 = Slice5/6/10. P1.1은 모델만(나머지 탭 disabled).
 *
 * ⚠ 미해결 fork(advisor): Inspector를 mode-gated로 둘지 selection-persistent로 둘지는
 * 실사용 검증 필요(Slice5 전 결정). Figma 메타포와의 유일한 이탈점.
 */
export function Inspector({ store }: { store: DocStore }) {
  const activeMode = useUiStore((s) => s.activeMode);
  const selection = useUiStore((s) => s.selection);
  const activeTool = useUiStore((s) => s.activeTool);
  // mode-gated(사용자 결정): 협업 = 선택 요소의 코멘트 스레드, 모델 = 속성. 한 곳서 분기.
  if (activeMode === 'review') {
    // 협업·리뷰에도 주석(치수·레이블) 편집 노출(iter-2 3-1) — 선택이 주석이면 InfoBox 에디터 + 코멘트.
    // 페인트 도구는 컨텍스트 패널(색·투명도·지우기·스포이드)이 필수라 리뷰에도 InfoBox 마운트
    // (setTool이 selection을 비우므로 도구 컨텍스트가 렌더됨 — isAnnot과 상호배타).
    const el = selection.length === 1 ? store.getElement(selection[0]!) : undefined;
    const isAnnot = el && (el.kind === 'dimension' || el.kind === 'label' || el.kind === 'text');
    return (
      <div className="inspector">
        {(isAnnot || activeTool === 'paint') && <InfoBox store={store} />}
        <ReviewInspector store={store} />
      </div>
    );
  }
  if (activeMode === 'hub') {
    return (
      <div className="inspector">
        <div className="inspector-hint">
          연동 소스 정렬·편집 머지는 추후(staging 게이트). 지금은 좌측 허브 패널에서 read-only 오버레이를 관리합니다.
        </div>
      </div>
    );
  }
  if (activeMode !== 'model') {
    return (
      <div className="inspector">
        <div className="rail-empty">곧</div>
      </div>
    );
  }
  return (
    <div className="inspector">
      <InfoBox store={store} />
      <EditActions store={store} />
      <TypesSection store={store} />
    </div>
  );
}
