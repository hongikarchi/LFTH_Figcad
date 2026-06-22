import type { DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { Toolbox } from './Toolbox';
import { ProjectMap } from './ProjectMap';

/**
 * 좌 WorkRail (UI/UX 재구성 P1) — mode별 working surface.
 * 모델: 도구(Toolbox) + 프로젝트 맵(스토리·3D·도면).
 * 협업/허브/도면 mode rail = Slice5/6/10. P1.1은 모델만(나머지 탭 disabled).
 */
export function WorkRail({ store }: { store: DocStore }) {
  const activeMode = useUiStore((s) => s.activeMode);
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
