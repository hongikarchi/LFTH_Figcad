import type { DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';

export function PropertiesPanel({ store }: { store: DocStore }) {
  useDocVersion(store);
  const selection = useUiStore((s) => s.selection);
  const setSelection = useUiStore((s) => s.setSelection);

  const el = selection ? store.getElement(selection) : undefined;
  if (!el || el.kind !== 'wall') return null;

  const level = store.getLevel(el.levelId);
  const lengthMm = Math.round(Math.hypot(el.b[0] - el.a[0], el.b[1] - el.a[1]));
  const effHeight = el.height ?? level?.height ?? 0;
  const wallTypes = store.listTypes('wall');

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
          value={effHeight}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v > 0) store.updateElement(el.id, { height: v });
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
