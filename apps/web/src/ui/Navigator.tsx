import { useState } from 'react';
import type { DocStore, DrawingView } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';
import { NumField, TextField } from './fields';
import { Icon } from './icons/Icon';
import { typeMeta, TypeEditor } from './NavigatorTypeEditor';
import { useNavigatorIO } from './useNavigatorIO';

/**
 * ArchiCAD Navigator(Project Map)의 웹 경량판 — 우측 도킹.
 * 스토리: 클릭 = 평면 열기, ✎ = 인라인 편집(이름/레벨/층고/삭제).
 * 타입: ✎ = 두께/색/치수 편집. 문서: JSON 백업 + interop 내보내기.
 * (연동 모델[federation 오버레이]은 P0서 상단 HubStrip으로 이전.)
 * IO 핸들러 = useNavigatorIO, 타입에디터 = NavigatorTypeEditor.
 */
export function Navigator({ store }: { store: DocStore }) {
  useDocVersion(store);
  const viewMode = useUiStore((s) => s.viewMode);
  const activeLevelId = useUiStore((s) => s.activeLevelId);
  const activeViewId = useUiStore((s) => s.activeViewId);
  const drawingOpen = useUiStore((s) => s.drawingOpen);
  const { setViewMode, setActiveLevel, setActiveViewId, setDrawingOpen } = useUiStore.getState();
  const [editing, setEditing] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<string | null>(null);
  const { ifcBusy, FORMATS, exportJson, importJson, exportFile } = useNavigatorIO(store);

  const levels = store.listLevels();
  const types = store.listTypes();
  const VIEW_ORDER = { plan: 0, section: 1, elevation: 2 } as const;
  const views = [...store.listViews()].sort(
    (a, b) => VIEW_ORDER[a.type] - VIEW_ORDER[b.type] || a.name.localeCompare(b.name, 'ko'),
  );

  // 도면 뷰 클릭 = 해당 뷰 열기 (Revit Project Browser / ArchiCAD Project Map 관례)
  const openView = (v: DrawingView) => {
    setActiveViewId(v.id);
    if (v.type === 'plan' && v.levelId) setActiveLevel(v.levelId);
    setDrawingOpen(true);
  };
  // 스토리 평면도 — 있으면 열고, 없으면 생성 후 열기 (멱등)
  const openOrCreatePlan = (levelId: string, levelName: string) => {
    const existing = store.listViews().find((v) => v.type === 'plan' && v.levelId === levelId);
    const id = existing?.id ?? store.createView({ name: `평면 · ${levelName}`, type: 'plan', levelId, cutHeight: 1200 });
    setActiveViewId(id);
    setActiveLevel(levelId);
    setDrawingOpen(true);
  };

  const KIND_ORDER = { wall: 0, opening: 1, slab: 2, column: 3, beam: 4, stair: 5, railing: 6, roof: 7, curtainwall: 8 } as const;
  const sortedTypes = [...types].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, 'ko'),
  );

  const addWallType = () => {
    const id = store.addType({ kind: 'wall', name: `새 벽 타입 ${types.filter((t) => t.kind === 'wall').length + 1}`, thickness: 150, color: '#e8e6e1' });
    setEditingType(id);
  };

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
              title="평면도 열기/생성"
              onClick={() => openOrCreatePlan(l.id, l.name)}
            >
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

      <div className="nav-section">타입</div>
      {sortedTypes.map((t) => (
        <div key={t.id}>
          <div className="nav-row">
            <button className="nav-item indent" onClick={() => setEditingType(editingType === t.id ? null : t.id)}>
              {t.name}
              <span className="nav-meta">
                <span className="type-swatch" style={{ background: t.color }} />
                {typeMeta(t)}
              </span>
            </button>
            <button className="nav-edit" title="타입 설정" onClick={() => setEditingType(editingType === t.id ? null : t.id)}>
              <Icon name="pencil" size={14} />
            </button>
          </div>
          {editingType === t.id && <TypeEditor store={store} type={t} />}
        </div>
      ))}
      <button className="nav-item indent add" onClick={addWallType}>
        + 벽 타입 추가
      </button>

      <div className="nav-section">문서</div>
      <button className="nav-item indent" onClick={exportJson}>
        JSON 내보내기
        <span className="nav-meta">백업</span>
      </button>
      <button
        className="nav-item indent"
        onClick={importJson}
        title="현재 문서를 JSON 백업 내용으로 전체 교체 (파괴적 — 협업자 전원 적용, Ctrl+Z 가능)"
      >
        JSON 가져오기
        <span className="nav-meta">⚠ 문서 교체</span>
      </button>
      <div className="nav-subsection">내보내기 (interop)</div>
      {(['ifc', 'rhino', 'dxf'] as const).map((fmt) => (
        <div key={fmt} className="nav-row">
          <button
            className="nav-item nav-interop"
            disabled={!!ifcBusy}
            title={`${FORMATS[fmt].label} 내보내기`}
            onClick={() => void exportFile(fmt)}
          >
            <Icon name="download" size={14} />
            {FORMATS[fmt].label}
            <span className="nav-meta">{FORMATS[fmt].ext}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
