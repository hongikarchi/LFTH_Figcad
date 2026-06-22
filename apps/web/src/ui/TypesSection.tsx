import { useState } from 'react';
import type { DocStore } from '@figcad/core';
import { useDocVersion } from './App';
import { Icon } from './icons/Icon';
import { typeMeta, TypeEditor } from './NavigatorTypeEditor';

/**
 * 타입(패밀리) 섹션 (UI/UX 재구성 P1) — 우 Inspector의 영구 섹션(모델 mode).
 * 선택과 무관하게 항상 표시(advisor: Types는 project-scoped, selection-scoped 아님).
 * Navigator 타입 섹션에서 추출. `.navigator.embedded` = nav-* 스타일 재사용.
 */
export function TypesSection({ store }: { store: DocStore }) {
  useDocVersion(store);
  const [editingType, setEditingType] = useState<string | null>(null);
  const types = store.listTypes();

  const KIND_ORDER = {
    wall: 0, opening: 1, slab: 2, column: 3, beam: 4, stair: 5, railing: 6, roof: 7, curtainwall: 8,
  } as const;
  const sortedTypes = [...types].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, 'ko'),
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
    </div>
  );
}
