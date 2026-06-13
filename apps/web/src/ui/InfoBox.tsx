import { polygonArea, resolveDimAnchor, type DocStore, type Id, type OpeningType } from '@figcad/core';
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
    column: 'column',
    beam: 'beam',
    stair: 'stair',
    railing: 'railing',
    roof: 'roof',
    curtainwall: 'curtainwall',
  };
  const kind = toolTypeKind[activeTool];
  if (kind) {
    const title = {
      wall: '벽 도구',
      door: '문 도구',
      window: '창 도구',
      slab: '슬라브 도구',
      column: '기둥 도구',
      beam: '보 도구',
      stair: '계단 도구',
      railing: '난간 도구',
      roof: '지붕 도구',
      curtainwall: '커튼월 도구',
    }[kind];
    const filter =
      kind === 'door' || kind === 'window'
        ? (t: { kind: string; opening?: { kind: string } }) =>
            t.kind === 'opening' && t.opening?.kind === (kind === 'door' ? 'door' : 'window')
        : (t: { kind: string }) => t.kind === kind;
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
        {kind === 'column' && (
          <span className="infobox-hint">배치할 점 클릭 — 그리드 교차점에 스냅</span>
        )}
        {kind === 'beam' && (
          <span className="infobox-hint">두 점 클릭 — 기둥 머리를 잇거나 그리드 따라 배치</span>
        )}
        {kind === 'stair' && (
          <span className="infobox-hint">하단→상단 두 점 클릭 — 이 층 높이만큼 오름(단수 자동)</span>
        )}
        {kind === 'railing' && (
          <span className="infobox-hint">두 점 클릭 — 슬라브 가장자리·계단을 따라 (연속 체인)</span>
        )}
        {kind === 'roof' && (
          <span className="infobox-hint">꼭짓점 클릭 · 첫 점/우클릭으로 닫기 — 벽 위에 놓임</span>
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

  if (activeTool === 'dimension') {
    return (
      <div className="infobox">
        <span className="infobox-title">치수 도구</span>
        <span className="infobox-hint">두 점 클릭 — 끝점(벽·기둥)에 스냅하면 이동 추종 바인딩</span>
      </div>
    );
  }

  if (activeTool === 'text') {
    return (
      <div className="infobox">
        <span className="infobox-title">텍스트 도구</span>
        <span className="infobox-hint">점 클릭 → 입력창에 문자 입력 (Enter 확정 · Esc 취소)</span>
      </div>
    );
  }

  if (activeTool === 'sketch') {
    return (
      <div className="infobox">
        <span className="infobox-title">AI 스케치 도구</span>
        <span className="infobox-hint">펜으로 평면을 그린 뒤 AI 패널에서 보내면 손그림대로 생성</span>
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
