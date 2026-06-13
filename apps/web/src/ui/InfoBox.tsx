import type { DocStore, Id, OpeningType } from '@figcad/core';
import { useUiStore, type TypeKind } from '../state/uiStore';
import { useDocVersion } from './App';
import { NumField, TextField } from './fields';

/**
 * ArchiCAD Info Box의 웹 경량판 — 상단 가로 도킹, 컨텍스트 민감:
 * "활성 도구 또는 선택 요소의 현재 설정을 표시" (help.graphisoft.com).
 */

function TypeSelect({
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

export function InfoBox({ store }: { store: DocStore }) {
  useDocVersion(store);
  const activeTool = useUiStore((s) => s.activeTool);
  const selection = useUiStore((s) => s.selection);
  const setSelection = useUiStore((s) => s.setSelection);
  const activeTypes = useUiStore((s) => s.activeTypes);
  const setActiveType = useUiStore((s) => s.setActiveType);

  // 단일 선택일 때만 요소 편집기 표시. 다중 선택은 요약 + 일괄 삭제.
  const el = selection.length === 1 ? store.getElement(selection[0]!) : undefined;

  const deleteBtn = (id: Id) => (
    <button
      className="danger"
      onClick={() => {
        store.deleteElements([id]);
        setSelection([]);
      }}
    >
      삭제
    </button>
  );

  // ---- 다중 선택 ----
  if (selection.length > 1) {
    return (
      <div className="infobox">
        <span className="infobox-title">{selection.length}개 선택됨</span>
        <span className="infobox-hint">이동/복사/배열/대칭/회전 가능 · Delete로 삭제</span>
        <button
          className="danger"
          onClick={() => {
            store.deleteElements(selection);
            setSelection([]);
          }}
        >
          전체 삭제
        </button>
      </div>
    );
  }

  // ---- 선택 요소 컨텍스트 ----
  if (el?.kind === 'wall') {
    const level = store.getLevel(el.levelId);
    const lengthMm = Math.round(Math.hypot(el.b[0] - el.a[0], el.b[1] - el.a[1]));
    return (
      <div className="infobox">
        <span className="infobox-title">벽</span>
        <span className="infobox-field">
          <label>길이</label>
          <span className="ro">{lengthMm.toLocaleString('ko-KR')}</span>
        </span>
        <NumField
          label="높이"
          value={el.height ?? level?.height ?? 0}
          min={100}
          onCommit={(v) => store.updateElement(el.id, { height: v })}
        />
        <TypeSelect
          store={store}
          value={el.typeId}
          filter={(t) => t.kind === 'wall'}
          onChange={(id) => store.updateElement(el.id, { typeId: id })}
        />
        <span className="infobox-field">
          <label>홈 스토리</label>
          <span className="ro">{level?.name ?? '—'}</span>
        </span>
        {deleteBtn(el.id)}
      </div>
    );
  }

  if (el?.kind === 'opening') {
    const type = store.getType(el.typeId) as OpeningType | undefined;
    if (!type || type.kind !== 'opening') return null;
    const isDoor = type.opening.kind === 'door';
    return (
      <div className="infobox">
        <span className="infobox-title">{isDoor ? '문' : '창'}</span>
        <NumField
          label="위치"
          value={el.offset}
          onCommit={(v) => store.updateElement(el.id, { offset: v })}
        />
        <NumField
          label="폭"
          value={el.widthOverride ?? type.opening.width}
          min={100}
          onCommit={(v) => store.updateElement(el.id, { widthOverride: v })}
        />
        <NumField
          label="높이"
          value={el.heightOverride ?? type.opening.height}
          min={100}
          onCommit={(v) => store.updateElement(el.id, { heightOverride: v })}
        />
        {!isDoor && (
          <NumField
            label="씰 높이"
            value={el.sillOverride ?? type.opening.sillHeight}
            onCommit={(v) => store.updateElement(el.id, { sillOverride: v })}
          />
        )}
        <TypeSelect
          store={store}
          value={el.typeId}
          filter={(t) => t.kind === 'opening' && t.opening?.kind === type.opening.kind}
          onChange={(id) => store.updateElement(el.id, { typeId: id })}
        />
        {deleteBtn(el.id)}
      </div>
    );
  }

  if (el?.kind === 'slab') {
    const type = store.getType(el.typeId);
    const thickness =
      el.thicknessOverride ?? (type && 'thickness' in type ? type.thickness : 0) ?? 0;
    // 면적 (슈레이스 공식)
    const area =
      Math.abs(
        el.boundary.reduce((acc, [x, y], i) => {
          const [nx, ny] = el.boundary[(i + 1) % el.boundary.length]!;
          return acc + x * ny - nx * y;
        }, 0),
      ) / 2e6; // mm² → m²
    return (
      <div className="infobox">
        <span className="infobox-title">슬라브</span>
        <span className="infobox-field">
          <label>면적</label>
          <span className="ro">{area.toFixed(2)} m²</span>
        </span>
        <NumField
          label="두께"
          value={thickness}
          min={50}
          onCommit={(v) => store.updateElement(el.id, { thicknessOverride: v })}
        />
        <TypeSelect
          store={store}
          value={el.typeId}
          filter={(t) => t.kind === 'slab'}
          onChange={(id) => store.updateElement(el.id, { typeId: id })}
        />
        {deleteBtn(el.id)}
      </div>
    );
  }

  if (el?.kind === 'grid') {
    return (
      <div className="infobox">
        <span className="infobox-title">그리드</span>
        <TextField
          label="라벨"
          value={el.label}
          maxLength={4}
          width={48}
          onCommit={(v) => store.updateElement(el.id, { label: v })}
        />
        {deleteBtn(el.id)}
      </div>
    );
  }

  // ---- 활성 도구 컨텍스트 ----
  const toolTypeKind: Partial<Record<string, TypeKind>> = {
    wall: 'wall',
    door: 'door',
    window: 'window',
    slab: 'slab',
  };
  const kind = toolTypeKind[activeTool];
  if (kind) {
    const title = { wall: '벽 도구', door: '문 도구', window: '창 도구', slab: '슬라브 도구' }[kind];
    const filter =
      kind === 'wall'
        ? (t: { kind: string }) => t.kind === 'wall'
        : kind === 'slab'
          ? (t: { kind: string }) => t.kind === 'slab'
          : (t: { kind: string; opening?: { kind: string } }) =>
              t.kind === 'opening' && t.opening?.kind === (kind === 'door' ? 'door' : 'window');
    const current = activeTypes[kind] ?? store.listTypes().find(filter)?.id ?? '';
    return (
      <div className="infobox">
        <span className="infobox-title">{title}</span>
        <TypeSelect store={store} value={current} filter={filter} onChange={(id) => setActiveType(kind, id)} />
        {kind === 'wall' && (
          <>
            <span className="infobox-field">
              <label>지오메트리</label>
              <span className="ro">체인</span>
            </span>
            <span className="infobox-field">
              <label>참조선</label>
              <span className="ro">중심선</span>
            </span>
          </>
        )}
        {(kind === 'door' || kind === 'window') && (
          <span className="infobox-hint">벽을 클릭해 배치 · 드래그로 위치 이동</span>
        )}
        {kind === 'slab' && (
          <span className="infobox-hint">꼭짓점 클릭 · 첫 점 클릭 또는 우클릭으로 닫기</span>
        )}
      </div>
    );
  }

  if (activeTool === 'grid') {
    return (
      <div className="infobox">
        <span className="infobox-title">그리드 도구</span>
        <span className="infobox-hint">두 점 클릭 — 세로축은 숫자, 가로축은 알파벳 자동 라벨</span>
      </div>
    );
  }

  return (
    <div className="infobox">
      <span className="infobox-title">선택</span>
      <span className="infobox-hint">요소를 클릭해 선택 · 우클릭 = 확정/회전 · 휠 = 줌</span>
    </div>
  );
}
