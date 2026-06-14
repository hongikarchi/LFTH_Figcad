import { useState } from 'react';
import type { DocSnapshot, DocStore, DrawingView, ElemType } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';
import { NumField, TextField } from './fields';
import { Icon } from './icons/Icon';
import {
  downloadDxf,
  downloadIfc,
  downloadRhino,
  parseDxf,
  parseIfc,
  parseRhino,
} from '../interop/ifcClient';

/** 타입 라벨 메타 (목록 우측 요약) — kind별 핵심 치수 */
function typeMeta(t: ElemType): string {
  if (t.kind === 'stair') return `${t.width}w·${t.riser}r`;
  if (t.kind === 'railing') return `h${t.height}`;
  if (t.kind === 'curtainwall')
    return t.mullionSection.shape === 'circle'
      ? `Ø${t.mullionSection.diameter}`
      : `${t.mullionSection.width}×${t.mullionSection.depth}`;
  if ('thickness' in t) return `${t.thickness}`;
  if ('section' in t)
    return t.section.shape === 'circle' ? `Ø${t.section.diameter}` : `${t.section.width}×${t.section.depth}`;
  return `${t.opening.width}×${t.opening.height}`;
}

/** 타입 인라인 에디터 — kind별 필드 (이름/두께/색/단면/계단·난간 치수) */
function TypeEditor({ store, type }: { store: DocStore; type: ElemType }) {
  const inUse = store.listElements().some((e) => 'typeId' in e && e.typeId === type.id);
  return (
    <div className="nav-editor">
      <TextField label="이름" value={type.name} maxLength={20} onCommit={(v) => store.updateType(type.id, { name: v })} />
      {'thickness' in type && (
        <NumField label="두께(mm)" value={type.thickness} min={10} onCommit={(v) => store.updateType(type.id, { thickness: v })} />
      )}
      {type.kind === 'opening' && (
        <>
          <NumField label="폭(mm)" value={type.opening.width} min={100} onCommit={(v) => store.updateType(type.id, { opening: { width: v } })} />
          <NumField label="높이(mm)" value={type.opening.height} min={100} onCommit={(v) => store.updateType(type.id, { opening: { height: v } })} />
          <NumField label="창대(mm)" value={type.opening.sillHeight} min={0} onCommit={(v) => store.updateType(type.id, { opening: { sillHeight: v } })} />
        </>
      )}
      {'section' in type && type.section.shape === 'rect' && (
        <>
          <NumField label="폭(mm)" value={type.section.width} min={50} onCommit={(v) => store.updateType(type.id, { section: { shape: 'rect', width: v, depth: (type.section as { depth: number }).depth } })} />
          <NumField label="춤(mm)" value={type.section.depth} min={50} onCommit={(v) => store.updateType(type.id, { section: { shape: 'rect', width: (type.section as { width: number }).width, depth: v } })} />
        </>
      )}
      {'section' in type && type.section.shape === 'circle' && (
        <NumField label="지름(mm)" value={type.section.diameter} min={50} onCommit={(v) => store.updateType(type.id, { section: { shape: 'circle', diameter: v } })} />
      )}
      {type.kind === 'stair' && (
        <>
          <NumField label="폭(mm)" value={type.width} min={400} onCommit={(v) => store.updateType(type.id, { width: v })} />
          <NumField label="단높이(mm)" value={type.riser} min={50} onCommit={(v) => store.updateType(type.id, { riser: v })} />
        </>
      )}
      {type.kind === 'railing' && (
        <>
          <NumField label="높이(mm)" value={type.height} min={300} onCommit={(v) => store.updateType(type.id, { height: v })} />
          <NumField label="포스트 간격(mm)" value={type.postSpacing} min={100} onCommit={(v) => store.updateType(type.id, { postSpacing: v })} />
        </>
      )}
      <span className="infobox-field">
        <label>색</label>
        <input
          type="color"
          value={type.color}
          onChange={(e) => store.updateType(type.id, { color: e.target.value })}
        />
      </span>
      <button
        className="nav-delete"
        disabled={inUse}
        title={inUse ? '이 타입을 쓰는 요소가 있어 삭제 불가' : undefined}
        onClick={() => store.deleteType(type.id)}
      >
        {inUse ? '사용 중 — 삭제 불가' : '타입 삭제'}
      </button>
    </div>
  );
}

/**
 * ArchiCAD Navigator(Project Map)의 웹 경량판 — 우측 도킹.
 * 스토리: 클릭 = 평면 열기, ✎ = 인라인 편집(이름/레벨/층고/삭제).
 * 타입: ✎ = 두께/색/치수 편집. 문서: JSON 내보내기/가져오기(백업 탈출구).
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
  const [ifcBusy, setIfcBusy] = useState<'export' | 'import' | null>(null);

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

  const exportJson = () => {
    const snap = store.snapshot();
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${snap.meta.projectName || 'figcad'}.figcad.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        try {
          const snap = JSON.parse(text) as DocSnapshot;
          const n = store.listElements().length;
          if (
            !window.confirm(
              `현재 문서(요소 ${n}개)를 '${file.name}' 내용으로 교체합니다.\n협업 중인 모든 사용자에게 즉시 적용됩니다 (Ctrl+Z로 되돌리기 가능). 계속할까요?`,
            )
          )
            return;
          store.importSnapshot(snap);
        } catch (e) {
          window.alert(`가져오기 실패: ${e instanceof Error ? e.message : e}`);
        }
      });
    };
    input.click();
  };

  // setState 직후 busy 라벨이 페인트될 틈을 준다 — 이어지는 WASM 동기 호출이
  // 메인 스레드를 막아 '눌렀는데 반응 없음'으로 보이는 것 방지
  const paintYield = () => new Promise((r) => requestAnimationFrame(() => r(null)));

  type IfcFormat = { ext: '.ifc' | '.3dm' | '.dxf'; label: string; binary: boolean };
  const FORMATS: Record<'ifc' | 'rhino' | 'dxf', IfcFormat> = {
    ifc: { ext: '.ifc', label: 'IFC', binary: true },
    rhino: { ext: '.3dm', label: 'Rhino .3dm', binary: true },
    dxf: { ext: '.dxf', label: 'DXF', binary: false },
  };

  const exportFile = async (fmt: keyof typeof FORMATS) => {
    setIfcBusy('export');
    try {
      await paintYield();
      const snap = store.snapshot();
      if (fmt === 'ifc') await downloadIfc(snap);
      else if (fmt === 'rhino') await downloadRhino(snap);
      else await downloadDxf(snap);
    } catch (e) {
      window.alert(`${FORMATS[fmt].label} 내보내기 실패: ${e instanceof Error ? e.message : e}`);
    } finally {
      setIfcBusy(null);
    }
  };

  const importFile = (fmt: keyof typeof FORMATS) => {
    const f = FORMATS[fmt];
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = f.ext;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const readP = f.binary ? file.arrayBuffer() : file.text();
      void readP.then(async (data) => {
        setIfcBusy('import');
        try {
          await paintYield();
          const result =
            fmt === 'ifc'
              ? await parseIfc(new Uint8Array(data as ArrayBuffer))
              : fmt === 'rhino'
                ? await parseRhino(new Uint8Array(data as ArrayBuffer))
                : await parseDxf(data as string);
          const { snapshot, skipped } = result;
          const skipNote = Object.keys(skipped).length
            ? `\n무시된 항목: ${Object.entries(skipped).map(([k, n]) => `${k} ${n}`).join(', ')}`
            : '';
          const lossNote =
            fmt === 'ifc' ? '' : '\n(이 포맷은 지오메트리 레벨 — 벽 두께/타입은 기본값으로 들어옵니다)';
          const n = store.listElements().length;
          if (
            !window.confirm(
              `'${file.name}'에서 요소 ${snapshot.elements.length}개를 가져와 현재 문서(요소 ${n}개)를 교체합니다.${skipNote}${lossNote}\n협업 중인 모든 사용자에게 적용됩니다 (Ctrl+Z 가능). 계속할까요?`,
            )
          )
            return;
          store.importSnapshot(snapshot);
        } catch (e) {
          window.alert(`${f.label} 가져오기 실패: ${e instanceof Error ? e.message : e}`);
        } finally {
          setIfcBusy(null);
        }
      });
    };
    input.click();
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
    </div>
  );
}
