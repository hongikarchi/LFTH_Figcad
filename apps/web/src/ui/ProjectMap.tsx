import { useState } from 'react';
import type { DocStore, DrawingView } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';
import { NumField, TextField } from './fields';
import { Icon } from './icons/Icon';

/**
 * 프로젝트 맵 (UI/UX 재구성 P1) — 좌 WorkRail의 영구 섹션(모델 mode).
 * 스토리(레벨 CRUD)·3D·도면(2D 뷰) — Navigator에서 추출. 타입은 우 Inspector로 분리.
 * `.navigator.embedded` = 기존 nav-* 스타일 재사용(컨테이너는 WorkRail이 chrome 제공).
 */
export function ProjectMap({ store }: { store: DocStore }) {
  useDocVersion(store);
  const viewMode = useUiStore((s) => s.viewMode);
  const activeLevelId = useUiStore((s) => s.activeLevelId);
  const activeViewId = useUiStore((s) => s.activeViewId);
  const drawingOpen = useUiStore((s) => s.drawingOpen);
  const { setViewMode, setActiveLevel, setActiveViewId, setDrawingOpen } = useUiStore.getState();
  const [editing, setEditing] = useState<string | null>(null);

  const levels = store.listLevels();
  const VIEW_ORDER = { plan: 0, section: 1, elevation: 2 } as const;
  const views = [...store.listViews()].sort(
    (a, b) => VIEW_ORDER[a.type] - VIEW_ORDER[b.type] || a.name.localeCompare(b.name, 'ko'),
  );

  const openView = (v: DrawingView) => {
    setActiveViewId(v.id);
    if (v.type === 'plan' && v.levelId) setActiveLevel(v.levelId);
    setDrawingOpen(true);
  };
  const openOrCreatePlan = (levelId: string, levelName: string) => {
    const existing = store.listViews().find((v) => v.type === 'plan' && v.levelId === levelId);
    const id =
      existing?.id ??
      store.createView({ name: `평면 · ${levelName}`, type: 'plan', levelId, cutHeight: 1200 });
    setActiveViewId(id);
    setActiveLevel(levelId);
    setDrawingOpen(true);
  };

  const addStory = () => {
    const top = levels.reduce((acc, l) => Math.max(acc, l.elevation + l.height), 0);
    const order = levels.reduce((acc, l) => Math.max(acc, l.order), -1) + 1;
    const id = store.addLevel({ name: `${levels.length + 1}층`, elevation: top, height: 3000, order });
    setActiveLevel(id);
    setViewMode('plan');
  };

  const removeStory = (id: string, name: string) => {
    const count = store.listElements().filter((e) => 'levelId' in e && e.levelId === id).length;
    const msg = count
      ? `'${name}'와 그 층의 요소 ${count}개를 삭제합니다. 계속할까요?`
      : `'${name}'를 삭제합니다.`;
    if (!window.confirm(msg)) return;
    store.deleteLevel(id);
    setEditing(null);
    const remaining = store.listLevels();
    if (remaining.length && activeLevelId === id) setActiveLevel(remaining[0]!.id);
  };

  return (
    <div className="navigator embedded">
      <div className="nav-section">프로젝트 맵</div>

      <div className="nav-subsection">스토리</div>
      {levels.map((l) => (
        <div key={l.id}>
          <div className="nav-row">
            <button
              className={`nav-item indent ${viewMode === 'plan' && activeLevelId === l.id ? 'active' : ''}`}
              onClick={() => {
                setActiveLevel(l.id);
                setViewMode('plan');
              }}
            >
              {l.name}
              <span className="nav-meta">{(l.elevation / 1000).toFixed(1)}m</span>
            </button>
            <button className="nav-edit" title="평면도 열기/생성" onClick={() => openOrCreatePlan(l.id, l.name)}>
              <Icon name="slab" size={14} />
            </button>
            <button
              className="nav-edit"
              title="스토리 설정"
              onClick={() => setEditing(editing === l.id ? null : l.id)}
            >
              <Icon name="pencil" size={14} />
            </button>
          </div>
          {editing === l.id && (
            <div className="nav-editor">
              <TextField label="이름" value={l.name} maxLength={20} onCommit={(v) => store.updateLevel(l.id, { name: v })} />
              <NumField label="레벨(mm)" value={l.elevation} min={-100000} onCommit={(v) => store.updateLevel(l.id, { elevation: v })} />
              <NumField label="층고(mm)" value={l.height} min={1000} onCommit={(v) => store.updateLevel(l.id, { height: v })} />
              {levels.length > 1 && (
                <button className="nav-delete" onClick={() => removeStory(l.id, l.name)}>
                  스토리 삭제
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      <button className="nav-item indent add" onClick={addStory}>
        + 스토리 추가
      </button>

      <div className="nav-subsection">3D</div>
      <button className={`nav-item indent ${viewMode === '3d' ? 'active' : ''}`} onClick={() => setViewMode('3d')}>
        일반 원근
      </button>

      <div className="nav-subsection">도면 (2D)</div>
      {views.length === 0 ? (
        <button className="nav-item indent" disabled title="스토리의 도면 아이콘 또는 단면/입면 도구로 생성">
          아직 도면 없음
        </button>
      ) : (
        views.map((v) => (
          <button
            key={v.id}
            className={`nav-item indent ${drawingOpen && activeViewId === v.id ? 'active' : ''}`}
            title={`${v.name} 열기`}
            onClick={() => openView(v)}
          >
            {v.name}
            <span className="nav-meta">
              {v.type === 'plan' ? '평면' : v.type === 'section' ? '단면' : '입면'}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
