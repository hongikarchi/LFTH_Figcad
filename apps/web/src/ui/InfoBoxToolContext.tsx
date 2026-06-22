import type { DocStore, Id } from '@figcad/core';
import type { TypeKind } from '../state/uiStore';
import { TypeSelect } from './InfoBoxTypeSelect';

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

  if (activeTool === 'text') {
    return (
      <div className="infobox">
        <span className="infobox-title">텍스트 도구</span>
        <span className="infobox-hint">점 클릭 → 입력창에 문자 입력 (Enter 확정 · Esc 취소)</span>
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
        <span className="infobox-title">AI 스케치 도구</span>
        <span className="infobox-hint">펜으로 평면을 그린 뒤 AI 패널에서 보내면 손그림대로 생성</span>
      </div>
    );
  }

  return null;
}
