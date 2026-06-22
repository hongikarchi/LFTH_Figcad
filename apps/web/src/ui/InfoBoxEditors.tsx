import { labelText, polygonArea, resolveDimAnchor, type DocStore, type Id, type OpeningType } from '@figcad/core';
import { NumField, TextField } from './fields';
import { TypeSelect } from './InfoBoxTypeSelect';

type Element = NonNullable<ReturnType<DocStore['getElement']>>;

/**
 * 단일 선택 요소의 컨텍스트 편집기 — kind별 분기.
 * 일치하는 kind 없으면 null (호출부가 도구 컨텍스트로 fallthrough).
 */
export function renderElementEditor(store: DocStore, el: Element, setSelection: (ids: Id[]) => void) {
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

  if (el?.kind === 'column') {
    const level = store.getLevel(el.levelId);
    const type = store.getType(el.typeId);
    const sectionLabel =
      type?.kind === 'column'
        ? type.section.shape === 'circle'
          ? `Ø${type.section.diameter}`
          : `${type.section.width}×${type.section.depth}`
        : '—';
    return (
      <div className="infobox">
        <span className="infobox-title">기둥</span>
        <span className="infobox-field">
          <label>단면</label>
          <span className="ro">{sectionLabel}</span>
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
          filter={(t) => t.kind === 'column'}
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

  if (el?.kind === 'beam') {
    const level = store.getLevel(el.levelId);
    const type = store.getType(el.typeId);
    const sectionLabel =
      type?.kind === 'beam'
        ? type.section.shape === 'circle'
          ? `Ø${type.section.diameter}`
          : `${type.section.width}×${type.section.depth}`
        : '—';
    const lengthMm = Math.round(Math.hypot(el.b[0] - el.a[0], el.b[1] - el.a[1]));
    return (
      <div className="infobox">
        <span className="infobox-title">보</span>
        <span className="infobox-field">
          <label>길이</label>
          <span className="ro">{lengthMm.toLocaleString('ko-KR')}</span>
        </span>
        <span className="infobox-field">
          <label>단면</label>
          <span className="ro">{sectionLabel}</span>
        </span>
        <TypeSelect
          store={store}
          value={el.typeId}
          filter={(t) => t.kind === 'beam'}
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

  if (el?.kind === 'stair') {
    const level = store.getLevel(el.levelId);
    const type = store.getType(el.typeId);
    const run = Math.round(Math.hypot(el.b[0] - el.a[0], el.b[1] - el.a[1]));
    const riser = type?.kind === 'stair' ? type.riser : 0;
    const totalRise = level?.height ?? 0;
    const steps = Math.max(1, Math.round(totalRise / Math.max(riser, 1)));
    const going = Math.round(run / steps); // 디딤판 깊이 = 주행/단수
    return (
      <div className="infobox">
        <span className="infobox-title">계단</span>
        <span className="infobox-field">
          <label>주행</label>
          <span className="ro">{run.toLocaleString('ko-KR')}</span>
        </span>
        <span className="infobox-field">
          <label>단수</label>
          <span className="ro">{steps}</span>
        </span>
        <span className="infobox-field">
          <label>디딤판</label>
          <span className="ro">{going.toLocaleString('ko-KR')}</span>
        </span>
        <TypeSelect
          store={store}
          value={el.typeId}
          filter={(t) => t.kind === 'stair'}
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

  if (el?.kind === 'railing') {
    const level = store.getLevel(el.levelId);
    const type = store.getType(el.typeId);
    const heightMm = type?.kind === 'railing' ? type.height : 0;
    const lengthMm = Math.round(Math.hypot(el.b[0] - el.a[0], el.b[1] - el.a[1]));
    return (
      <div className="infobox">
        <span className="infobox-title">난간</span>
        <span className="infobox-field">
          <label>길이</label>
          <span className="ro">{lengthMm.toLocaleString('ko-KR')}</span>
        </span>
        <span className="infobox-field">
          <label>높이</label>
          <span className="ro">{heightMm.toLocaleString('ko-KR')}</span>
        </span>
        <TypeSelect
          store={store}
          value={el.typeId}
          filter={(t) => t.kind === 'railing'}
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

  if (el?.kind === 'curtainwall') {
    const level = store.getLevel(el.levelId);
    return (
      <div className="infobox">
        <span className="infobox-title">커튼월</span>
        <NumField label="수직 간격" value={el.uSpacing} min={100} onCommit={(v) => store.updateElement(el.id, { uSpacing: v })} />
        <NumField label="수평 간격" value={el.vSpacing} min={100} onCommit={(v) => store.updateElement(el.id, { vSpacing: v })} />
        <NumField
          label="높이"
          value={el.height ?? level?.height ?? 3000}
          min={100}
          onCommit={(v) => store.updateElement(el.id, { height: v })}
        />
        <TypeSelect
          store={store}
          value={el.typeId}
          filter={(t) => t.kind === 'curtainwall'}
          onChange={(id) => store.updateElement(el.id, { typeId: id })}
        />
        {deleteBtn(el.id)}
      </div>
    );
  }

  if (el?.kind === 'roof') {
    const level = store.getLevel(el.levelId);
    const type = store.getType(el.typeId);
    const thickness =
      el.thicknessOverride ?? (type && 'thickness' in type ? type.thickness : 0) ?? 0;
    const area =
      Math.abs(
        el.boundary.reduce((acc, [x, y], i) => {
          const [nx, ny] = el.boundary[(i + 1) % el.boundary.length]!;
          return acc + x * ny - nx * y;
        }, 0),
      ) / 2e6;
    // 경사 방향 = 가장 긴 경계 변 (단경사 기본값) — 0이면 평지붕
    const longestEdge = (): [number, number] => {
      let best: [number, number] = [1, 0];
      let bestLen = 0;
      for (let i = 0; i < el.boundary.length; i++) {
        const a = el.boundary[i]!;
        const b = el.boundary[(i + 1) % el.boundary.length]!;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l = Math.hypot(dx, dy);
        if (l > bestLen) {
          bestLen = l;
          best = [dx, dy];
        }
      }
      return best;
    };
    return (
      <div className="infobox">
        <span className="infobox-title">지붕</span>
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
        <NumField
          label="경사(1m당)"
          value={el.slope?.pitch ?? 0}
          min={0}
          onCommit={(v) =>
            store.updateElement(el.id, {
              slope: v > 0 ? { dir: longestEdge(), pitch: v } : undefined,
            })
          }
        />
        <TypeSelect
          store={store}
          value={el.typeId}
          filter={(t) => t.kind === 'roof'}
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

  if (el?.kind === 'dimension') {
    // 바인딩 해석 (요소 끝점 추종) — 렌더/픽/복사와 같은 공유 헬퍼
    const ra = resolveDimAnchor(store, el.bindA, el.a);
    const rb = resolveDimAnchor(store, el.bindB, el.b);
    const measured = Math.round(Math.hypot(rb[0] - ra[0], rb[1] - ra[1]));
    const bound = !!(el.bindA || el.bindB);
    return (
      <div className="infobox">
        <span className="infobox-title">치수</span>
        <span className="infobox-field">
          <label>측정</label>
          <span className="ro">{measured.toLocaleString('ko-KR')}</span>
        </span>
        <NumField
          label="치수선 거리"
          value={el.offset ?? 500}
          min={-100000}
          onCommit={(v) => store.updateElement(el.id, { offset: v })}
        />
        <span className="infobox-field">
          <label>바인딩</label>
          <span className="ro">{bound ? '요소 추종' : '자유'}</span>
        </span>
        {deleteBtn(el.id)}
      </div>
    );
  }

  if (el?.kind === 'zone') {
    const area = (polygonArea(el.boundary) / 1e6).toFixed(1);
    return (
      <div className="infobox">
        <span className="infobox-title">존</span>
        <TextField
          label="이름"
          value={el.name}
          maxLength={40}
          width={120}
          onCommit={(v) => store.updateElement(el.id, { name: v })}
        />
        <TextField
          label="번호"
          value={el.number ?? ''}
          maxLength={12}
          width={56}
          onCommit={(v) => store.updateElement(el.id, { number: v })}
        />
        <span className="infobox-field">
          <label>면적</label>
          <span className="ro">{area}㎡</span>
        </span>
        <NumField
          label="높이"
          value={el.height ?? store.getLevel(el.levelId)?.height ?? 3000}
          min={100}
          onCommit={(v) => store.updateElement(el.id, { height: v })}
        />
        {deleteBtn(el.id)}
      </div>
    );
  }

  if (el?.kind === 'text') {
    return (
      <div className="infobox">
        <span className="infobox-title">텍스트</span>
        <TextField
          label="내용"
          value={el.text}
          maxLength={120}
          width={160}
          onCommit={(v) => store.updateElement(el.id, { text: v })}
        />
        {deleteBtn(el.id)}
      </div>
    );
  }

  if (el?.kind === 'label') {
    const target = el.targetId ? store.getElement(el.targetId) : null;
    const shown = labelText(el, target ?? null, store);
    return (
      <div className="infobox">
        <span className="infobox-title">레이블</span>
        <span className="infobox-field">
          <label>템플릿</label>
          <select
            value={el.template}
            onChange={(e) => store.updateElement(el.id, { template: e.target.value })}
          >
            <option value="name">이름/타입</option>
            <option value="area">면적</option>
            <option value="custom">직접 입력</option>
          </select>
        </span>
        {el.template === 'custom' ? (
          <TextField
            label="내용"
            value={el.customText ?? ''}
            maxLength={120}
            width={140}
            onCommit={(v) => store.updateElement(el.id, { customText: v })}
          />
        ) : (
          <span className="infobox-field">
            <label>표시</label>
            <span className="ro">{shown}</span>
          </span>
        )}
        <span className="infobox-field">
          <label>지시선</label>
          <input
            type="checkbox"
            checked={!!el.leader}
            onChange={(e) => store.updateElement(el.id, { leader: e.target.checked })}
          />
        </span>
        <span className="infobox-field">
          <label>타깃</label>
          <span className="ro">{el.targetId ? (target ? '연결됨' : '삭제됨(고아)') : '없음'}</span>
        </span>
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

  // undefined = "어떤 kind에도 매칭 안 됨" → 셸이 도구 컨텍스트로 fallthrough.
  // (opening 분기의 return null = "매칭됐으나 렌더 없음" → 셸이 빈 InfoBox 유지)
  return undefined;
}
