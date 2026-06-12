import type { DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';

/**
 * ArchiCAD Navigator(Project Map)의 웹 경량판 — 우측 도킹.
 * 트리: 스토리 / 3D / (단면·입면은 post-MVP 자리만).
 * 항목 클릭 = 해당 뷰 활성 (ArchiCAD는 더블클릭, 웹은 단일 클릭으로 단순화).
 */
export function Navigator({ store }: { store: DocStore }) {
  useDocVersion(store);
  const viewMode = useUiStore((s) => s.viewMode);
  const activeLevelId = useUiStore((s) => s.activeLevelId);
  const { setViewMode, setActiveLevel } = useUiStore.getState();

  const levels = store.listLevels();

  const addStory = () => {
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
    <div className="navigator">
      <div className="nav-title">내비게이터</div>
      <div className="nav-section">프로젝트 맵</div>

      <div className="nav-subsection">스토리</div>
      {levels.map((l) => (
        <button
          key={l.id}
          className={`nav-item indent ${viewMode === 'plan' && activeLevelId === l.id ? 'active' : ''}`}
          onClick={() => {
            setActiveLevel(l.id);
            setViewMode('plan');
          }}
        >
          {l.name}
          <span className="nav-meta">{(l.elevation / 1000).toFixed(1)}m</span>
        </button>
      ))}
      <button className="nav-item indent add" onClick={addStory}>
        + 스토리 추가
      </button>

      <div className="nav-subsection">3D</div>
      <button
        className={`nav-item indent ${viewMode === '3d' ? 'active' : ''}`}
        onClick={() => setViewMode('3d')}
      >
        일반 원근
      </button>

      <div className="nav-subsection dim">단면 · 입면</div>
      <button className="nav-item indent" disabled title="2D 도면 단계 예정">
        (도면 생성 단계)
      </button>
    </div>
  );
}
