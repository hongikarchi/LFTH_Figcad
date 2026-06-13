import { useMemo } from 'react';
import { lint, type DocStore, type Element, type LintFinding, type LintSeverity } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import { useDocVersion } from './App';
import type { ViewActions } from './QuickOptions';

/**
 * M5 검사(lint) 패널 — 좌하단 도킹.
 * 심각도순 목록, 행 클릭 = 요소 점프(선택 + 카메라 + 레벨 전환),
 * 수정 버튼 = 삭제 기반 원클릭 수정만 (지오메트리 이동 자동수정은 v1.5).
 */

const SEVERITY_META: Record<LintSeverity, { icon: string; label: string }> = {
  error: { icon: '⛔', label: '오류' },
  warning: { icon: '⚠️', label: '경고' },
  info: { icon: 'ℹ️', label: '정보' },
};

// 패널(LintPanel)과 배지(QuickOptions)가 같은 문서 버전에서 lint()를 두 번 돌리지
// 않도록 스토어별 dirty 캐시 공유 — 변경당 전체 검사 1회
const lintCache = new WeakMap<DocStore, { dirty: boolean; result: LintFinding[] }>();

function cachedLint(store: DocStore): LintFinding[] {
  let entry = lintCache.get(store);
  if (!entry) {
    const created = { dirty: true, result: [] as LintFinding[] };
    lintCache.set(store, created);
    store.observe(() => {
      created.dirty = true;
    });
    entry = created;
  }
  if (entry.dirty) {
    entry.result = lint(store);
    entry.dirty = false;
  }
  return entry.result;
}

/** 문서 버전에 메모이즈된 lint 결과 — 패널·배지가 공유하는 단일 계산 경로 */
export function useLint(store: DocStore): LintFinding[] {
  const v = useDocVersion(store);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- v가 문서 변경 카운터
  return useMemo(() => cachedLint(store), [store, v]);
}

/** 점프 앵커 (mm) — 요소 종류별 대표점 + 레벨 */
function anchorOf(store: DocStore, el: Element): { x: number; y: number; levelId?: string } {
  if (el.kind === 'wall' || el.kind === 'grid') {
    return {
      x: (el.a[0] + el.b[0]) / 2,
      y: (el.a[1] + el.b[1]) / 2,
      ...(el.kind === 'wall' ? { levelId: el.levelId } : {}),
    };
  }
  if (el.kind === 'slab') {
    const c = el.boundary.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return { x: c[0] / el.boundary.length, y: c[1] / el.boundary.length, levelId: el.levelId };
  }
  // opening — 호스트 중심선 위 offset 지점
  const host = store.getElement(el.hostId);
  if (host?.kind === 'wall') {
    const len = Math.hypot(host.b[0] - host.a[0], host.b[1] - host.a[1]);
    const t = len > 0 ? Math.min(Math.max(el.offset / len, 0), 1) : 0;
    return {
      x: host.a[0] + (host.b[0] - host.a[0]) * t,
      y: host.a[1] + (host.b[1] - host.a[1]) * t,
      levelId: host.levelId,
    };
  }
  return { x: 0, y: 0 };
}

export function LintPanel({ store, actions }: { store: DocStore; actions: ViewActions }) {
  const lintOpen = useUiStore((s) => s.lintOpen);
  const findings = useLint(store);

  if (!lintOpen) return null;

  const jump = (f: LintFinding) => {
    const el = store.getElement(f.elementIds[0]!);
    if (!el) return;
    const { x, y, levelId } = anchorOf(store, el);
    const ui = useUiStore.getState();
    if (levelId && store.getLevel(levelId)) ui.setActiveLevel(levelId);
    ui.setSelection(el.id);
    const elev = levelId ? (store.getLevel(levelId)?.elevation ?? 0) : 0;
    actions.focusWorld(x / 1000, elev / 1000, y / 1000);
  };

  const applyFix = (f: LintFinding) => {
    if (!f.fix) return;
    store.deleteElements(f.fix.deleteIds);
    const ui = useUiStore.getState();
    if (ui.selection && f.fix.deleteIds.includes(ui.selection)) ui.setSelection(null);
  };

  return (
    <div className="lint-panel">
      <div className="ai-head">
        <span className="ai-title">검사</span>
        <span className="ai-sub">
          {findings.length === 0 ? '문제 없음' : `${findings.length}건 — 행을 누르면 요소로 이동`}
        </span>
        <button className="ai-close" onClick={() => useUiStore.getState().setLintOpen(false)}>
          ✕
        </button>
      </div>
      <div className="lint-list">
        {findings.length === 0 && <div className="lint-clean">✓ 데이터 위생 문제가 없습니다</div>}
        {findings.map((f) => (
          <div
            key={`${f.code}|${f.elementIds.join()}|${f.message}`}
            className={`lint-item ${f.severity}`}
            onClick={() => jump(f)}
          >
            <span className="lint-icon" title={SEVERITY_META[f.severity].label}>
              {SEVERITY_META[f.severity].icon}
            </span>
            <span className="lint-msg">{f.message}</span>
            {f.fix && (
              <button
                className="lint-fix"
                title="원클릭 수정 (실행 취소 가능)"
                onClick={(e) => {
                  e.stopPropagation();
                  applyFix(f);
                }}
              >
                {f.fix.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
