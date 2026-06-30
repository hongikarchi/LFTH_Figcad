import { useEffect, useState } from 'react';
import { KIND_LABEL, lint, type DocSnapshot, type DocStore, type FederationSource } from '@figcad/core';
import type { FederationReconciler } from '../engine/FederationReconciler';
import { acquireMergeSnapshot, MERGEABLE_SOURCES } from '../interop/federationExtract';
import { useDocVersion } from './App';
import { useNavigatorFederation, SOURCE_BADGE } from './useNavigatorFederation';

type Preview = ReturnType<DocStore['previewMergeSnapshot']>;
type Staging = { source: FederationSource; snap: DocSnapshot; preview: Preview };

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
  const [busy, setBusy] = useState<string | null>(null);
  const [staging, setStaging] = useState<Staging | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const sources = store.listFederationSources();
  const room = new URL(location.href).searchParams.get('p') ?? '—';
  const cp = store.getConnectorPush(); // 커넥터(Rhino) 푸시 누계 — 라이브 쓰기 시 서버가 기록

  // 머지 게이트(Slice9): figcad-room만 — pull 스냅샷 캡처 → 미리보기 → 승인 시 additive ops 머지.
  const startMerge = async (source: FederationSource) => {
    setBusy(source.id);
    setResult(null);
    try {
      const snap = await acquireMergeSnapshot(source);
      if (!snap) {
        window.alert('이 소스 타입은 머지 미지원 (메시 전용 — 파라메트릭 요소 없음)');
        return;
      }
      setStaging({ source, snap, preview: store.previewMergeSnapshot(snap) });
    } catch (e) {
      window.alert(`머지 준비 실패: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  };
  const confirmMerge = () => {
    if (!staging) return;
    const { created } = store.mergeSnapshot(staging.snap); // DocStore ops = undo 1스텝·협업 전파
    const ids = new Set(created);
    const findings = lint(store).filter((f) => f.elementIds.some((id) => ids.has(id)));
    setStaging(null);
    setResult(
      `✓ ${created.length}개 요소 머지됨 (Ctrl+Z 되돌리기)` +
        (findings.length ? ` · ⚠ 검사 ${findings.length}건` : ''),
    );
  };

  return (
    <div className="navigator embedded hub-manage">
      <div className="nav-section">멀티모델 허브</div>
      <div className="hub-manage-hint">
        다른 툴 모델을 read-only 오버레이로 — 비파괴. ⤵ = 편집가능 요소로 문서에 머지.
      </div>
      {result && <div className="hub-merge-result">{result}</div>}
      {staging && (
        <div className="hub-staging">
          <div className="hub-staging-title">문서에 머지 — {staging.source.name}</div>
          <div className="hub-staging-body">
            추가:{' '}
            {Object.entries(staging.preview.byKind)
              .map(([k, n]) => `${KIND_LABEL[k as keyof typeof KIND_LABEL] ?? k} ${n}`)
              .join(' · ') || '없음'}{' '}
            (총 {staging.preview.total})
            <br />
            타입: 신규 {staging.preview.newTypes} · 재사용 {staging.preview.reusedTypes}
            {staging.preview.newLevels > 0 && ` · 레벨 신규 ${staging.preview.newLevels}`}
            {staging.preview.originShift && (
              <div className="hub-staging-warn">⚠ 좌표계 차이 — 소스 원점 기준으로 정렬됩니다</div>
            )}
          </div>
          <div className="hub-staging-actions">
            <button className="hub-staging-go" onClick={confirmMerge}>
              승인 — 문서에 추가
            </button>
            <button className="hub-staging-cancel" onClick={() => setStaging(null)}>
              취소
            </button>
          </div>
        </div>
      )}

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
        파일 업로드 (glTF / IFC / .3dm / DWG / DXF / 이미지 / PDF)
      </button>

      <div className="nav-subsection">연동 소스 ({sources.length})</div>
      <div className="hub-manage-hint">
        read-only 오버레이(다른 Figcad 룸·파일) — <b>내 문서와 별개</b>로 겹쳐만 봅니다(비파괴).
        Rhino 커넥터로 보낸 요소는 여기 아닌 <b>내 문서의 편집가능 요소</b>로 들어갑니다(아래 커넥터).
      </div>
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
                className="nav-edit"
                title="최신 다시 가져오기 (소스가 갱신됐을 때)"
                disabled={status === 'loading'}
                onClick={() => federation.reload(s.id)}
              >
                ↻
              </button>
              {MERGEABLE_SOURCES.has(s.sourceType) && (
                <button
                  className="nav-edit"
                  title="이 모델을 편집가능 요소로 문서에 머지"
                  disabled={busy === s.id || status !== 'ready'}
                  onClick={() => void startMerge(s)}
                >
                  {busy === s.id ? '…' : '⤵'}
                </button>
              )}
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
      {cp ? (
        <div className="hub-connector-status">
          <span className="hub-connector-dot">🟢</span> 푸시됨 — <b>{cp.count}</b>개 요소(편집가능)
          {cp.deduped > 0 && ` · 중복스킵 ${cp.deduped}`}
          <div className="hub-manage-hint">최근 {new Date(cp.ts).toLocaleString('ko-KR')}</div>
        </div>
      ) : (
        <div className="hub-manage-hint">아직 푸시 없음 — Rhino에서 <b>FigcadPushBreps</b>로 보내세요.</div>
      )}
      <div className="hub-manage-hint">
        Rhino <b>FigcadPull / FigcadPush / FigcadPushBreps</b> = 이 룸과 라이브 왕복(룸 = <b>{room}</b>).
        푸시 = <b>네이티브 편집가능 요소</b> 생성(오버레이와 다름). 재푸시는 멱등 — 같은 모델은 중첩 안 됩니다.
      </div>
    </div>
  );
}
