import type { DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';
import { useLint } from './LintPanel';

export interface ViewActions {
  zoomIn: () => void;
  zoomOut: () => void;
  /** 카메라 타깃 이동 (월드 m) — lint 요소 점프용 */
  focusWorld: (x: number, y: number, z: number) => void;
}

/**
 * ArchiCAD Quick Options Bar의 웹 경량판 — 하단 도킹.
 * 활성 탭(뷰)의 현재 설정 표시 + 빠른 변경 (줌, 활성 스토리).
 */
const CONN_LABEL = {
  connected: '실시간 연결됨',
  connecting: '연결 중…',
  offline: '오프라인',
} as const;

export function QuickOptions({ store, actions }: { store: DocStore; actions: ViewActions }) {
  useDocVersion(store);
  const viewMode = useUiStore((s) => s.viewMode);
  const activeLevelId = useUiStore((s) => s.activeLevelId);
  const connection = useUiStore((s) => s.connection);
  const peerCount = useUiStore((s) => s.peerCount);
  const aiOpen = useUiStore((s) => s.aiOpen);
  const lintOpen = useUiStore((s) => s.lintOpen);
  const findings = useLint(store);
  const worst = findings[0]?.severity; // lint()는 심각도순 정렬

  const level = activeLevelId ? store.getLevel(activeLevelId) : undefined;
  const viewName = viewMode === '3d' ? '3D · 일반 원근' : `평면 · ${level?.name ?? '—'}`;

  return (
    <div className="quick-options">
      <span className={`qo-dot ${connection}`} title={CONN_LABEL[connection]} />
      <span className="qo-label">
        {CONN_LABEL[connection]}
        {connection === 'connected' && peerCount > 0 ? ` · ${peerCount}명 동시 작업` : ''}
      </span>
      <span className="qo-sep" />
      <span className="qo-view">{viewName}</span>
      <span className="qo-sep" />
      <span className="qo-label">활성 스토리: {level?.name ?? '—'}</span>
      <span className="qo-sep" />
      <button onClick={actions.zoomOut} title="줌아웃 (PageDown)">
        −
      </button>
      <button onClick={actions.zoomIn} title="줌인 (PageUp)">
        +
      </button>
      <span className="qo-sep" />
      <button
        className={`qo-lint ${lintOpen ? 'active' : ''} ${worst ?? ''}`}
        title="데이터 위생 검사 — 겹침·미접합·중복·고아 요소"
        onClick={() => useUiStore.getState().setLintOpen(!lintOpen)}
      >
        검사{findings.length > 0 ? ` ${findings.length}` : ''}
      </button>
      <button
        className={`qo-ai ${aiOpen ? 'active' : ''}`}
        title="AI 모드 — 자연어로 모델링 (계획 승인 방식)"
        onClick={() => useUiStore.getState().setAiOpen(!aiOpen)}
      >
        AI
      </button>
    </div>
  );
}
