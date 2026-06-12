import { useEffect, useState } from 'react';

/**
 * 드래프트-커밋 입력 필드 — 타이핑 중에는 로컬, blur/Enter에만 커밋.
 * 키 입력마다 문서 트랜잭션이 생기는 것(Yjs 브로드캐스트, undo 파편화,
 * 원격 편집 클로버)을 막는 표준 패턴. 값이 안 바뀌면 커밋 안 함.
 */
export function NumField({
  label,
  value,
  min,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  return (
    <span className="infobox-field">
      <label>{label}</label>
      <input
        type="number"
        step={100}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === null) return;
          const v = Math.round(Number(draft));
          if (Number.isFinite(v) && v >= (min ?? 0) && v !== value) onCommit(v);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </span>
  );
}

export function TextField({
  label,
  value,
  maxLength,
  width,
  onCommit,
}: {
  label: string;
  value: string;
  maxLength?: number;
  width?: number;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  return (
    <span className="infobox-field">
      <label>{label}</label>
      <input
        type="text"
        style={width ? { width } : undefined}
        maxLength={maxLength}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === null) return;
          const v = draft.trim();
          if (v && v !== value) onCommit(v); // 빈 값 거부
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </span>
  );
}
