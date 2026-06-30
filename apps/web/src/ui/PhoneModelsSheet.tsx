import { useEffect, useState } from 'react';
import type { DocStore, DrawingView } from '@figcad/core';
import type { FederationReconciler } from '../engine/FederationReconciler';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';
import { useNavigatorFederation, SOURCE_BADGE } from './useNavigatorFederation';

const VIEW_ORDER = { plan: 0, section: 1, elevation: 2 } as const;
const VIEW_LABEL = { plan: '평면', section: '단면', elevation: '입면' } as const;

/**
 * 폰 리뷰/뷰어 — 컴팩트 모델·층·도면 시트. 데스크톱 HubManage/ProjectMap의 장황 안내·머지·편집폼은 제외(폰 미노출).
 * 핵심만: 연동 모델 가시성·상태 + 모델 추가 + 층 전환 + 도면 열기.
 */
export function PhoneModelsSheet({
  store,
  federation,
}: {
  store: DocStore;
  federation: FederationReconciler;
}) {
  useDocVersion(store);
  const [, bump] = useState(0);
  useEffect(() => federation.onChange(() => bump((x) => x + 1)), [federation]); // 소스 상태점 갱신
  const { uploadFederationFile } = useNavigatorFederation(store);
  const activeLevelId = useUiStore((s) => s.activeLevelId);
  const { setActiveLevel, setActiveViewId, setDrawingOpen, setViewMode, setPhoneSheet } = useUiStore.getState();

  const sources = store.listFederationSources();
  const levels = store.listLevels();
  const views = [...store.listViews()].sort(
    (a, b) => VIEW_ORDER[a.type] - VIEW_ORDER[b.type] || a.name.localeCompare(b.name, 'ko'),
  );

  const openView = (v: DrawingView): void => {
    setActiveViewId(v.id);
    if (v.type === 'plan' && v.levelId) setActiveLevel(v.levelId);
    setDrawingOpen(true);
    setPhoneSheet(null);
  };

  return (
    <div className="phone-sheet-content">
      <div className="nav-subsection">연동 모델</div>
      {sources.length === 0 ? (
        <div className="phone-hint">+ 모델로 Rhino·CAD·이미지·PDF를 read-only로 겹쳐 봅니다.</div>
      ) : (
        sources.map((s) => {
          const status = federation.statusOf(s.id) ?? 'loading';
          const dot = status === 'ready' ? '#34c759' : status === 'error' ? '#ff375f' : '#ff9500';
          return (
            <div key={s.id} className="phone-row">
              <button className={`phone-row-main ${s.visible ? '' : 'off'}`} onClick={() => store.setSourceVisible(s.id, !s.visible)}>
                <span className="phone-dot" style={{ background: dot }} title={federation.errorOf(s.id) ?? status} />
                <span className="phone-vis">{s.visible ? '👁' : '🚫'}</span>
                <span className="phone-name">{s.name}</span>
                <span className="phone-meta">{SOURCE_BADGE[s.sourceType]}</span>
              </button>
              <button className="phone-row-x" onClick={() => federation.reload(s.id)} title="최신 다시 가져오기" disabled={status === 'loading'}>
                ↻
              </button>
              <button className="phone-row-x" onClick={() => store.removeFederationSource(s.id)} title="제거">
                ✕
              </button>
            </div>
          );
        })
      )}
      <button className="phone-add" onClick={uploadFederationFile}>
        + 모델
      </button>

      <div className="nav-subsection">층</div>
      {levels.map((l) => (
        <button
          key={l.id}
          className={`phone-row-main ${activeLevelId === l.id ? 'active' : ''}`}
          onClick={() => {
            setActiveLevel(l.id);
            setViewMode('plan');
          }}
        >
          <span className="phone-name">{l.name}</span>
          <span className="phone-meta">{(l.elevation / 1000).toFixed(1)}m</span>
        </button>
      ))}

      <div className="nav-subsection">도면</div>
      {views.length === 0 ? (
        <div className="phone-hint">아직 도면 없음 — 데스크톱서 단면/입면 생성</div>
      ) : (
        views.map((v) => (
          <button key={v.id} className="phone-row-main" onClick={() => openView(v)}>
            <span className="phone-name">{v.name}</span>
            <span className="phone-meta">{VIEW_LABEL[v.type]}</span>
          </button>
        ))
      )}
    </div>
  );
}
