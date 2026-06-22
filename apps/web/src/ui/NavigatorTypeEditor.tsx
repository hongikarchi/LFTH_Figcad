import type { DocStore, ElemType } from '@figcad/core';
import { NumField, TextField } from './fields';

/** 타입 라벨 메타 (목록 우측 요약) — kind별 핵심 치수 */
export function typeMeta(t: ElemType): string {
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
export function TypeEditor({ store, type }: { store: DocStore; type: ElemType }) {
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
