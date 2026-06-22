import type { DocStore, Id } from '@figcad/core';

/** 타입 선택 드롭다운 — InfoBox 요소편집기·도구컨텍스트 공유. */
export function TypeSelect({
  store,
  value,
  filter,
  onChange,
}: {
  store: DocStore;
  value: Id;
  filter: (t: { kind: string; opening?: { kind: string } }) => boolean;
  onChange: (id: Id) => void;
}) {
  const types = store.listTypes().filter(filter);
  return (
    <span className="infobox-field">
      <label>타입</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </span>
  );
}
