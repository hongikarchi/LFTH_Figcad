import { useEffect, useState } from 'react';
import type { DocStore, DrawingView } from '@figcad/core';
import type { FederationReconciler } from '../engine/FederationReconciler';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';
import { NumField, TextField } from './fields';
import { Icon } from './icons/Icon';
import { typeMeta, TypeEditor } from './NavigatorTypeEditor';
import { useNavigatorIO } from './useNavigatorIO';
import { useNavigatorFederation, SOURCE_BADGE } from './useNavigatorFederation';

/**
 * ArchiCAD Navigator(Project Map)의 웹 경량판 — 우측 도킹.
 * 스토리: 클릭 = 평면 열기, ✎ = 인라인 편집(이름/레벨/층고/삭제).
 * 타입: ✎ = 두께/색/치수 편집. 문서: JSON 내보내기/가져오기(백업 탈출구).
 * IO·federation 핸들러 = useNavigatorIO/useNavigatorFederation, 타입에디터 = NavigatorTypeEditor.
 */
export function Navigator({
  store,
  federation,
}: {
  store: DocStore;
  federation: FederationReconciler;
}) {
  useDocVersion(store);
  // 로드 상태(loading→ready/error)는 동기화 안 함 — store 변경 없이 reconciler가 통지.
  // useDocVersion(store)은 add/remove/setVisible(ops) 커버, 비동기 로드 완료는 onChange만 잡는다.
  const [, bumpFed] = useState(0);
  useEffect(() => federation.onChange(() => bumpFed((x) => x + 1)), [federation]);
  const viewMode = useUiStore((s) => s.viewMode);
  const activeLevelId = useUiStore((s) => s.activeLevelId);
  const activeViewId = useUiStore((s) => s.activeViewId);
  const drawingOpen = useUiStore((s) => s.drawingOpen);
  const { setViewMode, setActiveLevel, setActiveViewId, setDrawingOpen } = useUiStore.getState();
  const [editing, setEditing] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<string | null>(null);
  const { ifcBusy, FORMATS, exportJson, importJson, exportFile, importFile } = useNavigatorIO(store);
  const { fedInput, setFedInput, addFederationRoom, uploadFederationFile } =
    useNavigatorFederation(store);

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

  const sources = store.listFederationSources();
  const showAll = () => {
    for (const s of sources) if (!s.visible) store.setSourceVisible(s.id, true);
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
      <button className="nav-item indent" onClick={importJson}>
        JSON 가져오기
        <span className="nav-meta">교체</span>
      </button>
      <div className="nav-subsection">교환 (interop)</div>
      {(['ifc', 'rhino', 'dxf'] as const).map((fmt) => (
        <div key={fmt} className="nav-row">
          <button
            className="nav-item nav-interop"
            disabled={!!ifcBusy}
            title={`${FORMATS[fmt].label} 내보내기`}
            onClick={() => void exportFile(fmt)}
          >
            <Icon name={ifcBusy === 'export' ? 'download' : 'download'} size={14} />
            {FORMATS[fmt].label}
            <span className="nav-meta">{FORMATS[fmt].ext}</span>
          </button>
          <button
            className="nav-edit"
            disabled={!!ifcBusy}
            title={`${FORMATS[fmt].label} 가져오기 (문서 교체)`}
            onClick={() => importFile(fmt)}
          >
            <Icon name="upload" size={14} />
          </button>
        </div>
      ))}

      <div className="nav-section">연동 모델</div>
      <div className="nav-subsection">모델 추가 (Figcad 룸)</div>
      <div className="nav-row">
        <input
          className="nav-item indent"
          value={fedInput}
          placeholder="룸 id 또는 ?p=… 붙여넣기"
          onChange={(e) => setFedInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) addFederationRoom();
          }}
        />
        <button
          className="nav-edit"
          title="연동 모델 추가"
          disabled={!fedInput.trim()}
          onClick={addFederationRoom}
        >
          <Icon name="upload" size={14} />
        </button>
      </div>
      <div className="nav-row">
        <button className="nav-item indent" title="glTF(.glb/.gltf)·IFC(.ifc) 파일을 올려 read-only 오버레이로" onClick={uploadFederationFile}>
          glTF / IFC 업로드…
        </button>
      </div>

      <div className="nav-subsection">소스</div>
      {sources.length === 0 ? (
        <button className="nav-item indent" disabled title="위에 룸 id를 추가하면 read-only 오버레이로 겹쳐 봅니다">
          연동된 모델 없음
        </button>
      ) : (
        sources.map((s) => {
          const status = federation.statusOf(s.id) ?? 'loading';
          const err = federation.errorOf(s.id);
          const dot = status === 'ready' ? '🟢' : status === 'error' ? '🔴' : '⏳';
          const statusLabel = status === 'ready' ? '준비됨' : status === 'error' ? '오류' : '로딩…';
          return (
            <div key={s.id} className="nav-row">
              <button
                className="nav-item indent"
                title={err ?? `${s.name} (${SOURCE_BADGE[s.sourceType]}) — ${statusLabel}`}
                onClick={() => store.setSourceVisible(s.id, !s.visible)}
              >
                <span style={{ opacity: status === 'error' ? 0.6 : 1 }}>
                  {s.visible ? '👁' : '🚫'} {s.name}
                </span>
                <span className="nav-meta">
                  <span title={err ?? statusLabel}>{dot}</span> {SOURCE_BADGE[s.sourceType]}
                </span>
              </button>
              <button
                className="nav-delete"
                title="연동 모델 제거"
                onClick={() => store.removeFederationSource(s.id)}
              >
                ✕
              </button>
            </div>
          );
        })
      )}
      {sources.length > 1 && (
        <button className="nav-item indent add" onClick={showAll}>
          전체 보기
        </button>
      )}
    </div>
  );
}
