import { useState } from 'react';
import type { DocSnapshot, DocStore, ElemType } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';
import { NumField, TextField } from './fields';
import { downloadIfc, parseIfc } from '../interop/ifcClient';

/** 타입 인라인 에디터 — kind별 필드 (이름/두께/색/개구부 치수) */
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
  const { setViewMode, setActiveLevel } = useUiStore.getState();
  const [editing, setEditing] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<string | null>(null);
  const [ifcBusy, setIfcBusy] = useState<'export' | 'import' | null>(null);

  const levels = store.listLevels();
  const types = store.listTypes();

  const KIND_ORDER = { wall: 0, opening: 1, slab: 2 } as const;
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

  const exportIfcFile = async () => {
    setIfcBusy('export');
    try {
      await downloadIfc(store.snapshot());
    } catch (e) {
      window.alert(`IFC 내보내기 실패: ${e instanceof Error ? e.message : e}`);
    } finally {
      setIfcBusy(null);
    }
  };

  const importIfcFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ifc';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.arrayBuffer().then(async (buf) => {
        setIfcBusy('import');
        try {
          const { snapshot, skipped } = await parseIfc(new Uint8Array(buf));
          const elems = snapshot.elements.length;
          const skipNote = Object.keys(skipped).length
            ? `\n무시된 항목: ${Object.entries(skipped).map(([k, n]) => `${k} ${n}`).join(', ')}`
            : '';
          const n = store.listElements().length;
          if (
            !window.confirm(
              `'${file.name}'에서 요소 ${elems}개를 가져와 현재 문서(요소 ${n}개)를 교체합니다.${skipNote}\n협업 중인 모든 사용자에게 적용됩니다 (Ctrl+Z 가능). 계속할까요?`,
            )
          )
            return;
          store.importSnapshot(snapshot);
        } catch (e) {
          window.alert(`IFC 가져오기 실패: ${e instanceof Error ? e.message : e}`);
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

      <div className="nav-section">타입</div>
      {sortedTypes.map((t) => (
        <div key={t.id}>
          <div className="nav-row">
            <button className="nav-item indent" onClick={() => setEditingType(editingType === t.id ? null : t.id)}>
              {t.name}
              <span className="nav-meta">
                <span className="type-swatch" style={{ background: t.color }} />
                {'thickness' in t ? `${t.thickness}` : `${t.opening.width}×${t.opening.height}`}
              </span>
            </button>
            <button className="nav-edit" title="타입 설정" onClick={() => setEditingType(editingType === t.id ? null : t.id)}>
              ✎
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
      <button className="nav-item indent" disabled={!!ifcBusy} onClick={() => void exportIfcFile()}>
        {ifcBusy === 'export' ? 'IFC 내보내는 중…' : 'IFC 내보내기'}
        <span className="nav-meta">.ifc</span>
      </button>
      <button className="nav-item indent" disabled={!!ifcBusy} onClick={importIfcFile}>
        {ifcBusy === 'import' ? 'IFC 읽는 중…' : 'IFC 가져오기'}
        <span className="nav-meta">.ifc</span>
      </button>
    </div>
  );
}
