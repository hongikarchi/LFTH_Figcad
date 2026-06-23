import { useState } from 'react';
import { KIND_LABEL, type DocStore } from '@figcad/core';
import { useDocVersion } from './App';
import { Icon } from './icons/Icon';
import { typeMeta, TypeEditor } from './NavigatorTypeEditor';

/** 타입 보유 kind 순서 (피드백 — 카테고리별 그룹). opening = 단일 그룹(door/window 중첩). */
const KIND_SEQUENCE = [
  'wall', 'opening', 'slab', 'column', 'beam', 'stair', 'railing', 'roof', 'curtainwall',
] as const;

/**
 * 타입(패밀리) 섹션 (UI/UX 재구성 P1) — 우 Inspector의 영구 섹션(모델 mode).
 * 선택과 무관하게 항상 표시(advisor: Types는 project-scoped, selection-scoped 아님).
 * 카테고리(kind)별 그룹 + KIND_LABEL 헤더(피드백 — flat 나열이라 구분 안 됨). nav-* 스타일 재사용.
 */
export function TypesSection({ store }: { store: DocStore }) {
  useDocVersion(store);
  const [editingType, setEditingType] = useState<string | null>(null);
  const types = store.listTypes();

  const byName = [...types].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const groups = KIND_SEQUENCE.map((k) => ({ k, list: byName.filter((t) => t.kind === k) })).filter(
    (g) => g.list.length > 0,
  );

  const addWallType = () => {
    const id = store.addType({
      kind: 'wall',
      name: `새 벽 타입 ${types.filter((t) => t.kind === 'wall').length + 1}`,
      thickness: 150,
      color: '#e8e6e1',
    });
    setEditingType(id);
  };

  return (
    <div className="navigator embedded">
      <div className="nav-section">타입</div>
      {groups.map((g) => (
        <div key={g.k}>
          <div className="nav-subsection">{KIND_LABEL[g.k]}</div>
          {g.list.map((t) => (
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
        </div>
      ))}
      <button className="nav-item indent add" onClick={addWallType}>
        + 벽 타입 추가
      </button>
    </div>
  );
}
