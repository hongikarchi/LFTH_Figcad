import type { DocStore } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion, type ViewActions } from './App';
import { Icon } from './icons/Icon';
import { ClipControl } from './ClipControl';
import { WalkControl } from './WalkControl';

/**
 * 뷰포트 컨트롤 클러스터 (UI/UX 재구성 P1 Slice7) — 캔버스 우하단 코너, 항상-on.
 * 뷰/스토리의 단일 권위(스펙 §7): 3D/평면 토글 + 활성 스토리 스테퍼 +
 * 온스크린 undo/redo + 전체 맞춤. iPad는 버튼, 데스크톱은 단축키 병행.
 * QuickOptions(하단 바)를 대체 — 뷰 상태 중복(Navigator/QuickOptions/DrawingPanel) 종결.
 */
export function ViewportCluster({ store, actions }: { store: DocStore; actions: ViewActions }) {
  useDocVersion(store);
  const viewMode = useUiStore((s) => s.viewMode);
  const activeLevelId = useUiStore((s) => s.activeLevelId);
  const clip = useUiStore((s) => s.clip);
  const activeMode = useUiStore((s) => s.activeMode);
  const walkActive = useUiStore((s) => s.walkActive);
  const { setViewMode, setActiveLevel, setClipState, setWalkActive } = useUiStore.getState();
  const toggleClip = () => {
    const next = clip ? null : ({ axis: 'y', t: 0.5, flip: false } as const);
    setClipState(next);
    actions.setClip(next);
  };

  const levels = [...store.listLevels()].sort((a, b) => a.order - b.order);
  const idx = levels.findIndex((l) => l.id === activeLevelId);
  const cur = idx >= 0 ? levels[idx] : levels[0];
  const step = (d: number) => {
    if (!levels.length) return;
    const base = idx >= 0 ? idx : 0;
    const ni = Math.max(0, Math.min(levels.length - 1, base + d));
    setActiveLevel(levels[ni]!.id);
  };

  return (
    <>
      {clip && <ClipControl actions={actions} />}
      <WalkControl />
      <div className="viewport-cluster">
      <button title="실행 취소 (Ctrl+Z)" onClick={actions.undo}>
        <Icon name="undo" size={16} />
      </button>
      <button title="다시 실행 (Ctrl+Shift+Z)" onClick={actions.redo}>
        <Icon name="redo" size={16} />
      </button>
      <span className="vc-sep" />
      {/* fit·평면 전환 = 걷기 카메라 파괴 → 걷기 중 비활성 (viewActions exitWalk 가드와 이중 안전) */}
      <button title="전체 맞춤 (F)" onClick={actions.fit} disabled={walkActive}>
        <Icon name="fit" size={16} />
      </button>
      <button title="선택 맞춤 (Z)" onClick={actions.fitSelection} disabled={walkActive}>
        <Icon name="fit-selection" size={16} />
      </button>
      <button
        className={`vc-view ${viewMode === '3d' ? 'active' : ''}`}
        title="3D ↔ 평면 전환"
        disabled={walkActive}
        onClick={() => setViewMode(viewMode === '3d' ? 'plan' : '3d')}
      >
        {viewMode === '3d' ? '3D' : '평면'}
      </button>
      <button className={`vc-view ${clip ? 'active' : ''}`} title="단면 (클리핑 플레인)" onClick={toggleClip}>
        단면
      </button>
      {activeMode === 'review' && (
        <button
          className={`vc-view ${walkActive ? 'active' : ''}`}
          title="걷기 모드 — 1인칭 둘러보기 (Esc 종료)"
          onClick={() => setWalkActive(!walkActive)}
        >
          걷기
        </button>
      )}
      <span className="vc-sep" />
      <button title="아래 스토리" onClick={() => step(-1)} disabled={idx <= 0}>
        ▾
      </button>
      <span className="vc-story" title="활성 스토리">
        {cur?.name ?? '—'}
      </span>
      <button title="위 스토리" onClick={() => step(1)} disabled={levels.length === 0 || idx >= levels.length - 1}>
        ▴
      </button>
      </div>
    </>
  );
}
