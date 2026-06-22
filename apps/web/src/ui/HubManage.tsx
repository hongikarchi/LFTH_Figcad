import { useEffect, useState } from 'react';
import type { DocStore } from '@figcad/core';
import type { FederationReconciler } from '../engine/FederationReconciler';
import { useDocVersion } from './App';
import { useNavigatorFederation, SOURCE_BADGE } from './useNavigatorFederation';

/**
 * 허브 mode 좌 WorkRail (UI/UX 재구성 P1 Slice6) — 멀티모델 상세 관리.
 * 상단 HubStrip = 빠른 칩 + 추가. 여기 = 소스 풀 관리(상태·가시성·제거·addedBy) + 커넥터 안내.
 * (편집 머지 = additive staging 게이트 Slice9. 지금은 read-only 오버레이만.)
 */
export function HubManage({
  store,
  federation,
}: {
  store: DocStore;
  federation: FederationReconciler;
}) {
  useDocVersion(store);
  const [, bumpFed] = useState(0);
  useEffect(() => federation.onChange(() => bumpFed((x) => x + 1)), [federation]);
  const { fedInput, setFedInput, addFederationRoom, uploadFederationFile } =
    useNavigatorFederation(store);

  const sources = store.listFederationSources();
  const room = new URL(location.href).searchParams.get('p') ?? '—';

  return (
    <div className="navigator embedded hub-manage">
      <div className="nav-section">멀티모델 허브</div>
      <div className="hub-manage-hint">
        다른 툴 모델을 read-only 오버레이로 — 비파괴. (편집 머지는 추후 staging 게이트)
      </div>

      <div className="nav-subsection">모델 추가</div>
      <div className="hub-add-row">
        <input
          value={fedInput}
          placeholder="Figcad 룸 id 또는 ?p=…"
          onChange={(e) => setFedInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) addFederationRoom();
          }}
        />
        <button disabled={!fedInput.trim()} onClick={addFederationRoom}>
          룸
        </button>
      </div>
      <button className="nav-item indent" onClick={uploadFederationFile}>
        파일 업로드 (glTF / IFC / .3dm)
      </button>

      <div className="nav-subsection">연동 소스 ({sources.length})</div>
      {sources.length === 0 ? (
        <div className="hub-manage-hint">아직 없음 — 위에서 추가</div>
      ) : (
        sources.map((s) => {
          const status = federation.statusOf(s.id) ?? 'loading';
          const err = federation.errorOf(s.id);
          const dot = status === 'ready' ? '🟢' : status === 'error' ? '🔴' : '⏳';
          const statusLabel = status === 'ready' ? '준비됨' : status === 'error' ? '오류' : '로딩…';
          return (
            <div key={s.id} className="nav-row">
              <button
                className="nav-item indent"
                title={err ?? `${s.name} — ${statusLabel} · 추가: ${s.addedBy ?? '—'}`}
                onClick={() => store.setSourceVisible(s.id, !s.visible)}
              >
                <span style={{ opacity: status === 'error' ? 0.6 : 1 }}>
                  {s.visible ? '👁' : '🚫'} {s.name}
                </span>
                <span className="nav-meta">
                  <span title={err ?? statusLabel}>{dot}</span> {SOURCE_BADGE[s.sourceType]}
                </span>
              </button>
              <button
                className="nav-delete"
                title="연동 모델 제거"
                onClick={() => store.removeFederationSource(s.id)}
              >
                ✕
              </button>
            </div>
          );
        })
      )}

      <div className="nav-subsection">커넥터 (Rhino)</div>
      <div className="hub-manage-hint">
        Rhino에서 <b>FigcadPull / FigcadPush</b> = 이 룸과 라이브 왕복. 룸 = <b>{room}</b>
      </div>
    </div>
  );
}
