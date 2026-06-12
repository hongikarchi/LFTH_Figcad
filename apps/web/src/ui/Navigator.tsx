import { useState } from 'react';
import type { DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';
import { NumField, TextField } from './fields';

/**
 * ArchiCAD Navigator(Project Map)의 웹 경량판 — 우측 도킹.
 * 스토리: 클릭 = 평면 열기, ✎ = 인라인 편집(이름/레벨/층고/삭제).
 */
export function Navigator({ store }: { store: DocStore }) {
  useDocVersion(store);
  const viewMode = useUiStore((s) => s.viewMode);
  const activeLevelId = useUiStore((s) => s.activeLevelId);
  const { setViewMode, setActiveLevel } = useUiStore.getState();
  const [editing, setEditing] = useState<string | null>(null);

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
    <div className="navigator">
      <div className="nav-title">내비게이터</div>
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
            <button
              className="nav-edit"
              title="스토리 설정"
              onClick={() => setEditing(editing === l.id ? null : l.id)}
            >
              ✎
            </button>
          </div>
          {editing === l.id && (
            <div className="nav-editor">
              <TextField
                label="이름"
                value={l.name}
                maxLength={20}
                onCommit={(v) => store.updateLevel(l.id, { name: v })}
              />
              <NumField
                label="레벨(mm)"
                value={l.elevation}
                min={-100000}
                onCommit={(v) => store.updateLevel(l.id, { elevation: v })}
              />
              <NumField
                label="층고(mm)"
                value={l.height}
                min={1000}
                onCommit={(v) => store.updateLevel(l.id, { height: v })}
              />
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
