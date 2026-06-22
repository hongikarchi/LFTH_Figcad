import { useUiStore, type WorkspaceMode } from '../state/uiStore';

/**
 * 작업 모드 탭 (UI/UX 재구성 P1) — 정체성 순. 좌레일+우인스펙터를 mode별 재구성.
 * 협업·리뷰(Slice5)·모델(P1.1) 활성, 허브(Slice6)·도면(Slice10)은 disabled '곧'.
 */
const TABS: { mode: WorkspaceMode; label: string; enabled: boolean }[] = [
  { mode: 'review', label: '협업·리뷰', enabled: true },
  { mode: 'model', label: '모델', enabled: true },
  { mode: 'hub', label: '허브', enabled: false },
  { mode: 'drawing', label: '도면', enabled: false },
];

export function ModeTabs() {
  const activeMode = useUiStore((s) => s.activeMode);
  const setMode = useUiStore((s) => s.setMode);
  return (
    <div className="mode-tabs">
      {TABS.map((t) => (
        <button
          key={t.mode}
          className={`mode-tab ${activeMode === t.mode ? 'active' : ''}`}
          disabled={!t.enabled}
          title={t.enabled ? `${t.label} 모드` : `${t.label} — 곧`}
          onClick={() => t.enabled && setMode(t.mode)}
        >
          {t.label}
          {!t.enabled && <span className="mode-soon">곧</span>}
        </button>
      ))}
    </div>
  );
}
