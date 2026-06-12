import { useEffect, useState } from 'react';
import type { DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';

export function PropertiesPanel({ store }: { store: DocStore }) {
  useDocVersion(store);
  const selection = useUiStore((s) => s.selection);
  const setSelection = useUiStore((s) => s.setSelection);

  // 높이 입력은 로컬 드래프트 — blur/Enter에만 커밋 (키 입력마다 문서 변경 금지)
  const [heightDraft, setHeightDraft] = useState<string | null>(null);
  useEffect(() => setHeightDraft(null), [selection]);

  const el = selection ? store.getElement(selection) : undefined;
  if (!el || el.kind !== 'wall') return null;

  const level = store.getLevel(el.levelId);
  const lengthMm = Math.round(Math.hypot(el.b[0] - el.a[0], el.b[1] - el.a[1]));
  const effHeight = el.height ?? level?.height ?? 0;
  const wallTypes = store.listTypes('wall');

  const commitHeight = () => {
    if (heightDraft === null) return;
    const v = Math.round(Number(heightDraft));
    if (Number.isFinite(v) && v >= 100) store.updateElement(el.id, { height: v });
    setHeightDraft(null);
  };

  return (
    <div className="props-panel">
      <h3>벽</h3>
      <label>
        길이
        <span className="readonly">{lengthMm.toLocaleString('ko-KR')} mm</span>
      </label>
      <label>
        높이
        <input
          type="number"
          step={100}
          value={heightDraft ?? String(effHeight)}
          onChange={(e) => setHeightDraft(e.target.value)}
          onBlur={commitHeight}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </label>
      <label>
        타입
        <select
          value={el.typeId}
          onChange={(e) => store.updateElement(el.id, { typeId: e.target.value })}
        >
          {wallTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="danger"
        onClick={() => {
          store.deleteElements([el.id]);
          setSelection(null);
        }}
      >
        삭제
      </button>
    </div>
  );
}
