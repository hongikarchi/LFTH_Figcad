import type { DocStore, Id } from '@figcad/core';
import { useUiStore, type TypeKind } from '../state/uiStore';
import { TypeSelect } from './InfoBoxTypeSelect';

/** 펜 종류 선택 — 스케치(영속 저장) vs AI 스케치(손그림→모델 생성). iter-3 S5. (내부 키 'markup' 유지.) */
function PenTypeSelect({ current }: { current: 'markup' | 'ai' }) {
  return (
    <span className="infobox-field">
      <label>펜</label>
      <select
        value={current}
        onChange={(e) => {
          const ui = useUiStore.getState();
          if (e.target.value === 'ai') {
            ui.setViewMode('plan');
            ui.setTool('sketch');
            ui.setAiOpen(true);
          } else {
            ui.setTool('sketch-pen');
          }
        }}
      >
        <option value="markup">스케치 (저장·공유)</option>
        <option value="ai">AI 스케치 (모델 생성)</option>
      </select>
    </span>
  );
}

/** 스케치 펜 컨텍스트 — 펜종류 + 색·투명도·굵기·선종류·모드(uiStore). MarkupTool이 createSketch에 사용. */
function SketchPenContext() {
  const style = useUiStore((s) => s.sketchStyle);
  const mode = useUiStore((s) => s.sketchMode);
  const setStyle = useUiStore((s) => s.setSketchStyle);
  const setMode = useUiStore((s) => s.setSketchMode);
  return (
    <div className="infobox">
      <span className="infobox-title">스케치 펜</span>
      <PenTypeSelect current="markup" />
      <span className="infobox-field">
        <label>모드</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as 'line' | 'zone')}>
          <option value="line">선</option>
          <option value="zone">영역(채움)</option>
        </select>
      </span>
      <span className="infobox-field">
        <label>색</label>
        <input type="color" value={style.color} onChange={(e) => setStyle({ color: e.target.value })} />
      </span>
      <span className="infobox-field">
        <label>투명도</label>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.1}
          value={style.opacity}
          onChange={(e) => setStyle({ opacity: Number(e.target.value) })}
        />
      </span>
      <span className="infobox-field">
        <label>굵기</label>
        <select value={style.width} onChange={(e) => setStyle({ width: Number(e.target.value) })}>
          <option value={1}>가늘게</option>
          <option value={3}>보통</option>
          <option value={6}>굵게</option>
        </select>
      </span>
      <span className="infobox-field">
        <label>선종류</label>
        <select
          value={style.lineType}
          onChange={(e) => setStyle({ lineType: e.target.value as 'solid' | 'dashed' | 'dotted' })}
        >
          <option value="solid">실선</option>
          <option value="dashed">파선</option>
          <option value="dotted">점선</option>
        </select>
      </span>
      <span className="infobox-hint">드래그로 그리기 — 저장·공유됨 (3D서도 가능)</span>
    </div>
  );
}

/**
 * 페인트 컨텍스트 — 색+불투명도(v1)·모드(칠하기/지우기)·스포이드·전체 지우기. PaintTool이 소비.
 * 적용 단위: 네이티브 클릭=타입(패밀리) 전체, 임포트 클릭=.3dm 레이어/IFC 카테고리/그 외 소스 전체.
 */
function PaintContext({ store }: { store: DocStore }) {
  const style = useUiStore((s) => s.paintStyle);
  const mode = useUiStore((s) => s.paintMode);
  const eyedropper = useUiStore((s) => s.paintEyedropper);
  const setStyle = useUiStore((s) => s.setPaintStyle);
  const setMode = useUiStore((s) => s.setPaintMode);
  const setEyedropper = useUiStore((s) => s.setPaintEyedropper);
  return (
    <div className="infobox">
      <span className="infobox-title">페인트</span>
      <span className="infobox-field">
        <label>모드</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as 'paint' | 'erase')}>
          <option value="paint">칠하기</option>
          <option value="erase">지우기 (클레이 복원)</option>
        </select>
      </span>
      <span className="infobox-field">
        <label>색</label>
        <input type="color" value={style.color} onChange={(e) => setStyle({ color: e.target.value })} />
      </span>
      <span className="infobox-field">
        <label>투명도</label>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={style.opacity}
          onChange={(e) => setStyle({ opacity: Number(e.target.value) })}
        />
        <span className="ro">{Math.round(style.opacity * 100)}%</span>
      </span>
      <span className="infobox-field">
        <button
          className={eyedropper ? 'active' : ''}
          title="클릭한 대상의 색을 흡수 (Alt+클릭)"
          onClick={() => setEyedropper(!eyedropper)}
        >
          스포이드
        </button>
        <button
          title="연동 모델 도색 전부 제거 (타입 색은 실행취소로)"
          onClick={() => {
            if (window.confirm('연동 모델 도색을 전부 지울까요? (클레이 복원)'))
              store.clearMaterialOverrides();
          }}
        >
          전체 지우기
        </button>
      </span>
      <span className="infobox-hint">요소 클릭=타입 전체 · 연동 모델 클릭=레이어/카테고리 단위</span>
    </div>
  );
}

/** 오브젝트(엔투라지) 컨텍스트 — 종류 선택(나무·사람·차·관목). 배치는 클릭(AssetTool). 항목7. */
const ASSET_LABELS: { v: 'tree' | 'person' | 'car' | 'bush'; label: string }[] = [
  { v: 'tree', label: '나무' },
  { v: 'person', label: '사람' },
  { v: 'car', label: '자동차' },
  { v: 'bush', label: '관목' },
];
function AssetContext() {
  const assetKind = useUiStore((s) => s.assetKind);
  const setAssetKind = useUiStore((s) => s.setAssetKind);
  return (
    <div className="infobox">
      <span className="infobox-title">오브젝트</span>
      <span className="infobox-field">
        <label>종류</label>
        <select value={assetKind} onChange={(e) => setAssetKind(e.target.value as 'tree' | 'person' | 'car' | 'bush')}>
          {ASSET_LABELS.map((a) => (
            <option key={a.v} value={a.v}>
              {a.label}
            </option>
          ))}
        </select>
      </span>
      <span className="infobox-hint">배치할 점 클릭 — 스케일·맥락 참고물</span>
    </div>
  );
}

/**
 * 활성 도구의 컨텍스트(타입 선택 + 사용 힌트). 알려진 도구 없으면 null
 * (호출부가 기본 "선택" 힌트로 fallthrough).
 */
export function renderToolContext(
  store: DocStore,
  activeTool: string,
  activeTypes: Record<TypeKind, Id | null>,
  setActiveType: (kind: TypeKind, id: Id) => void,
) {
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

  if (activeTool === 'label') {
    return (
      <div className="infobox">
        <span className="infobox-title">레이블 도구</span>
        <span className="infobox-hint">요소 클릭 = 자동 라벨(존=면적·그 외=이름) · 빈 곳 클릭 = 직접 입력</span>
      </div>
    );
  }

  if (activeTool === 'sketch') {
    return (
      <div className="infobox">
        <span className="infobox-title">AI 스케치</span>
        <PenTypeSelect current="ai" />
        <span className="infobox-hint">펜으로 평면을 그린 뒤 AI 패널에서 보내면 손그림대로 생성</span>
      </div>
    );
  }

  if (activeTool === 'sketch-pen') {
    return <SketchPenContext />;
  }

  if (activeTool === 'asset') {
    return <AssetContext />;
  }

  if (activeTool === 'paint') {
    return <PaintContext store={store} />;
  }

  return null;
}
