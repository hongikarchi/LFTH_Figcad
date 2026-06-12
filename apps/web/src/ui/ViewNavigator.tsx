import type { DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';

/**
 * 뷰 내비게이터 — Revit Project Browser / ArchiCAD Navigator의 경량판.
 * [3D] + 층별 평면 뷰 + 레벨 추가. 평면 뷰 클릭 = 해당 층 활성 + 평면 모드.
 */
export function ViewNavigator({ store }: { store: DocStore }) {
  useDocVersion(store);
  const viewMode = useUiStore((s) => s.viewMode);
  const activeLevelId = useUiStore((s) => s.activeLevelId);
  const { setViewMode, setActiveLevel } = useUiStore.getState();

  const levels = store.listLevels();

  const addLevel = () => {
    const top = levels.reduce((acc, l) => Math.max(acc, l.elevation + l.height), 0);
    const order = levels.reduce((acc, l) => Math.max(acc, l.order), -1) + 1;
    const id = store.addLevel({
      name: `${levels.length + 1}층`,
      elevation: top,
      height: 3000,
      order,
    });
    setActiveLevel(id);
    setViewMode('plan');
  };

  return (
    <div className="view-nav">
      <div className="view-nav-title">뷰</div>
      <button
        className={viewMode === '3d' ? 'active' : ''}
        onClick={() => setViewMode('3d')}
      >
        3D
      </button>
      {levels.map((l) => (
        <button
          key={l.id}
          className={viewMode === 'plan' && activeLevelId === l.id ? 'active' : ''}
          onClick={() => {
            setActiveLevel(l.id);
            setViewMode('plan');
          }}
        >
          {l.name} 평면
        </button>
      ))}
      <button className="add-level" onClick={addLevel}>
        + 레벨
      </button>
    </div>
  );
}
