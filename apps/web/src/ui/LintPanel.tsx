import { useEffect, useReducer } from 'react';
import { lint, type DocStore, type Element, type LintFinding, type LintSeverity } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
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

// 디바운스 비동기 lint — 변경마다 동기 실행하면 대형 문서(2K 벽 기준 수백 ms)에서
// 드래그·일괄 생성이 O(n³)으로 죽는다 (스트레스 실측: 벽 2000개 생성 63s→디바운스 후 정상).
// 패널·배지가 같은 캐시를 공유: 즉시 stale 결과 반환 + 유휴 시 재계산 → 리스너 통지.
const LINT_DEBOUNCE_MS = 400;

interface LintCacheEntry {
  result: LintFinding[];
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<() => void>;
}

const lintCache = new WeakMap<DocStore, LintCacheEntry>();

function lintEntry(store: DocStore): LintCacheEntry {
  let entry = lintCache.get(store);
  if (!entry) {
    const created: LintCacheEntry = {
      result: lint(store),
      dirty: false,
      timer: null,
      listeners: new Set(),
    };
    lintCache.set(store, created);
    store.observe(() => {
      created.dirty = true;
      if (created.timer) return; // 연속 변경은 기존 타이머로 합침
      created.timer = setTimeout(() => {
        created.timer = null;
        if (!created.dirty) return;
        created.dirty = false;
        created.result = lint(store);
        for (const l of created.listeners) l();
      }, LINT_DEBOUNCE_MS);
    });
    entry = created;
  }
  return entry;
}

/** lint 결과 구독 — 문서 변경 후 ≤400ms 내 갱신 (계산 중에는 직전 결과 유지) */
export function useLint(store: DocStore): LintFinding[] {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const entry = lintEntry(store);
    entry.listeners.add(bump);
    return () => {
      entry.listeners.delete(bump);
    };
  }, [store]);
  return lintEntry(store).result;
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
    ui.setSelection([el.id]);
    const elev = levelId ? (store.getLevel(levelId)?.elevation ?? 0) : 0;
    actions.focusWorld(x / 1000, elev / 1000, y / 1000);
  };

  const applyFix = (f: LintFinding) => {
    if (!f.fix) return;
    store.deleteElements(f.fix.deleteIds);
    const ui = useUiStore.getState();
    const remaining = ui.selection.filter((id) => !f.fix!.deleteIds.includes(id));
    if (remaining.length !== ui.selection.length) ui.setSelection(remaining);
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
