import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DocStore } from '@figcad/core';
import type { FederationReconciler } from '../engine/FederationReconciler';
import { useDocVersion } from './App';
import { useNavigatorFederation, SOURCE_BADGE } from './useNavigatorFederation';

/**
 * 멀티모델 hub (UI/UX 재구성 P0-1) — moat-frame 중앙. 정체성 헤드라인 = 중립 조율.
 * 모든 ingest는 read-only OVERLAY로 먼저 착지(비파괴) — "+모델"이 프라임 안전 경로.
 * (파괴적 문서교체는 인접 금지 — Navigator JSON '⚠ 문서 교체'로 분리. additive merge = Slice9.)
 * 칩 = 소스 풀 표면(배지·상태점·가시성 토글·제거). 상태는 reconciler(onChange), 동기화 아님.
 */
export function HubStrip({
  store,
  federation,
}: {
  store: DocStore;
  federation: FederationReconciler;
}) {
  useDocVersion(store); // add/remove/setVisible(ops)
  const [, bumpFed] = useState(0);
  useEffect(() => federation.onChange(() => bumpFed((x) => x + 1)), [federation]); // 비동기 로드 상태
  const { fedInput, setFedInput, addFederationRoom, uploadFederationFile } =
    useNavigatorFederation(store);
  const [menuOpen, setMenuOpen] = useState(false);
  // 메뉴는 body로 portal + position:fixed로 렌더 — `.hub-strip{overflow:hidden}`(칩 가로스크롤용)이
  // absolute 메뉴를 잘라내던 버그 회피(항목9). 열 때 버튼 rect에서 좌표 산출, 뷰포트 우측 클램프.
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const MENU_W = 260;
  const toggleMenu = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ left: Math.min(r.left, window.innerWidth - MENU_W - 8), top: r.bottom + 8 });
    setMenuOpen(true);
  };

  const sources = store.listFederationSources();
  const hidden = sources.filter((s) => !s.visible).length;
  const showAll = () => {
    for (const s of sources) if (!s.visible) store.setSourceVisible(s.id, true);
  };

  return (
    <div className="hub-strip">
      {sources.map((s) => {
        const status = federation.statusOf(s.id) ?? 'loading';
        const err = federation.errorOf(s.id);
        const dot = status === 'ready' ? '#34c759' : status === 'error' ? '#ff375f' : '#ff9500';
        return (
          <span key={s.id} className={`hub-chip ${s.visible ? '' : 'off'}`}>
            <span className="hub-dot" style={{ background: dot }} title={err ?? status} />
            <button
              className="hub-chip-name"
              title={err ?? `${s.name} (${SOURCE_BADGE[s.sourceType]}) — 클릭: ${s.visible ? '숨기기' : '보이기'}`}
              onClick={() => store.setSourceVisible(s.id, !s.visible)}
            >
              <span className="hub-badge">{SOURCE_BADGE[s.sourceType]}</span>
              <span className="hub-chip-label">{s.name}</span>
            </button>
            <button
              className="hub-chip-x"
              title="연동 모델 제거"
              onClick={() => store.removeFederationSource(s.id)}
            >
              ✕
            </button>
          </span>
        );
      })}
      {hidden > 0 && (
        <button className="hub-showall" onClick={showAll} title="숨긴 모델 모두 보이기">
          전체 보기
        </button>
      )}
      <div className="hub-add-wrap">
        <button
          ref={btnRef}
          className="hub-add"
          title="다른 툴의 모델(Rhino·CAD·IFC·다른 Figcad 룸)을 read-only 오버레이로 겹쳐 봅니다 (비파괴 — 내 문서 안 바뀜). 소스 관리는 허브 탭."
          onClick={toggleMenu}
        >
          + 연동 모델
        </button>
        {menuOpen && menuPos &&
          createPortal(
            <>
              <div className="hub-add-backdrop" onClick={() => setMenuOpen(false)} />
              <div
                className="hub-add-menu"
                style={{ position: 'fixed', left: menuPos.left, top: menuPos.top, transform: 'none' }}
              >
                <div className="hub-add-hint">오버레이로 겹쳐 보기 — 문서는 안 바뀝니다</div>
                <button
                  className="hub-add-item"
                  onClick={() => {
                    uploadFederationFile();
                    setMenuOpen(false);
                  }}
                >
                  파일 업로드 (glTF / IFC / .3dm / DWG / DXF / 이미지 / PDF)
                </button>
                <div className="hub-add-room">
                  <input
                    value={fedInput}
                    placeholder="Figcad 룸 id 또는 ?p=…"
                    onChange={(e) => setFedInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        addFederationRoom();
                        setMenuOpen(false);
                      }
                    }}
                  />
                  <button
                    disabled={!fedInput.trim()}
                    onClick={() => {
                      addFederationRoom();
                      setMenuOpen(false);
                    }}
                  >
                    룸 추가
                  </button>
                </div>
              </div>
            </>,
            document.body,
          )}
      </div>
    </div>
  );
}
