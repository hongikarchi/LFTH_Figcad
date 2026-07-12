import { useEffect, useRef, useState } from 'react';
import type { DocStore } from '@figcad/core';
import { useUiStore, type ToolName, type WorkspaceMode } from '../state/uiStore';
import type { ViewActions } from './App';

/**
 * Cmd/Ctrl-K 명령 팔레트 (UI/UX 재구성 P1 Slice11) — 데스크톱 어포던스.
 * 키보드 레이어는 InputManager(펜/터치 포인터 분기)와 직교 — 캔버스 엘리먼트 밖 바인딩이라 불변④ 무관.
 * 모드(1~3)·도구 단축키는 input/hotkeys.ts 단일 소유 — 여기는 Ctrl+K 팔레트만.
 */
type Cmd = { label: string; run: () => void };

export function CommandPalette({ store, actions }: { store: DocStore; actions: ViewActions }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQ('');
        setSel(0);
        return;
      }
      // 1/2/3 모드 전환은 input/hotkeys.ts 단일 소유(걷기·폰·IME 가드 포함) — 여기 중복 등록 제거(리뷰)
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  if (!open) return null;

  const ui = useUiStore.getState();
  const mode = (m: WorkspaceMode, t?: ToolName) => () => {
    ui.setMode(m);
    if (t) ui.setTool(t);
  };
  const cmds: Cmd[] = [
    { label: '모드: 협업·리뷰', run: () => ui.setMode('review') },
    { label: '모드: 모델', run: () => ui.setMode('model') },
    { label: '모드: 허브', run: () => ui.setMode('hub') },
    { label: 'AI dock 열기/닫기', run: () => { const s = useUiStore.getState(); s.setAiOpen(!s.aiOpen); } },
    { label: '도구: 선택', run: () => ui.setTool('select') },
    { label: '도구: 벽', run: mode('model', 'wall') },
    { label: '도구: 문', run: mode('model', 'door') },
    { label: '도구: 창', run: mode('model', 'window') },
    { label: '도구: 슬라브', run: mode('model', 'slab') },
    { label: '도구: 기둥', run: mode('model', 'column') },
    { label: '도구: 보', run: mode('model', 'beam') },
    { label: '도구: 그리드', run: mode('model', 'grid') },
    { label: '도구: 측정 (줄자)', run: () => ui.setTool('measure') },
    { label: '도구: 코멘트', run: mode('review', 'comment') },
    { label: '도구: 레이블', run: mode('model', 'label') },
    { label: '도구: 스케치 (AI)', run: () => { ui.setAiOpen(true); ui.setViewMode('plan'); ui.setTool('sketch'); } },
    { label: '도구: 단면', run: () => { ui.setViewMode('plan'); ui.setDrawingOpen(false); ui.setTool('section'); } },
    { label: '도구: 입면', run: () => { ui.setViewMode('plan'); ui.setDrawingOpen(false); ui.setTool('elevation'); } },
    { label: '전체 맞춤 (F)', run: actions.fit },
    { label: '실행 취소', run: actions.undo },
    { label: '다시 실행', run: actions.redo },
    { label: '3D / 평면 전환', run: () => ui.setViewMode(ui.viewMode === '3d' ? 'plan' : '3d') },
    { label: '룸 공유 — URL 복사', run: () => void navigator.clipboard.writeText(location.href).catch(() => {}) },
  ];
  void store;
  const filtered = q.trim()
    ? cmds.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()))
    : cmds;
  const clampedSel = Math.min(sel, Math.max(0, filtered.length - 1));
  const exec = (c?: Cmd) => {
    c?.run();
    setOpen(false);
  };

  return (
    <div className="cmdk-backdrop" onClick={() => setOpen(false)}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          value={q}
          placeholder="명령 검색 — 모드·도구·뷰…"
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              exec(filtered[clampedSel]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        <div className="cmdk-list">
          {filtered.length === 0 && <div className="cmdk-empty">결과 없음</div>}
          {filtered.map((c, i) => (
            <button
              key={c.label}
              className={`cmdk-item ${i === clampedSel ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => exec(c)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
