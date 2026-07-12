import { MODE_TOOLS, useUiStore, type ToolName, type WorkspaceMode } from '../state/uiStore';

/**
 * 데스크톱 per-tool 핫키 레이어 (ui-ux-plan Slice 11) — InputManager와 직교.
 * 불변④(펜=도구/터치=카메라)는 POINTER 분기 규칙이라 키보드 레이어는 무관 —
 * 캔버스 밖 window 바인딩으로 도구/모드만 전환한다(포인터 의미론 무접촉).
 *
 * 게이팅: 현재 mode의 팔레트(MODE_TOOLS)에 있는 도구만 반응 — 핫키가 모드를 몰래
 * 바꾸지 않는다(모드 전환은 숫자키 1·2·3 명시). 리뷰 모드 C=코멘트(기둥은 모델 전용).
 */
const TOOL_KEYS: Record<string, ToolName> = {
  v: 'select', // Adobe/Figma 관례
  w: 'wall',
  d: 'door',
  n: 'window',
  s: 'slab',
  c: 'column',
  b: 'beam',
  g: 'grid',
  t: 'stair',
  r: 'railing',
  m: 'measure',
  p: 'paint',
  l: 'label',
  k: 'sketch-pen', // 마크업 펜
};
const MODE_OVERRIDES: Partial<Record<WorkspaceMode, Record<string, ToolName>>> = {
  review: { c: 'comment' },
};
/** ModeTabs 표시 순서와 일치 (협업·리뷰 / 모델 / 허브) */
const MODE_KEYS: Record<string, WorkspaceMode> = { 1: 'review', 2: 'model', 3: 'hub' };

export type HotkeyAction = { kind: 'tool'; tool: ToolName } | { kind: 'mode'; mode: WorkspaceMode };

/** 순수 해석 — 단위 테스트 대상. null = 이 키는 핫키 아님(다른 핸들러 몫). */
export function resolveHotkey(key: string, mode: WorkspaceMode): HotkeyAction | null {
  const m = MODE_KEYS[key];
  if (m) return { kind: 'mode', mode: m };
  const tool = MODE_OVERRIDES[mode]?.[key] ?? TOOL_KEYS[key];
  if (tool && MODE_TOOLS[mode].includes(tool)) return { kind: 'tool', tool };
  return null;
}

/** window keydown 등록 — main.ts 부팅 시 1회. 기존 F(fit)/Z(줌선택)/Esc/화살표 핸들러와 키 비중복. */
export function initHotkeys(onApplied?: () => void): void {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const t = e.target as HTMLElement | null;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    const ui = useUiStore.getState();
    if (ui.walkActive) return; // WASD·Shift는 걷기 이동 (WalkController 소유)
    if (ui.device === 'phone') return; // 폰 = 키보드 없음 + 시트 UX와 충돌 방지
    const act = resolveHotkey(e.key.toLowerCase(), ui.activeMode);
    if (!act) return;
    if (act.kind === 'mode') ui.setMode(act.mode);
    else ui.setTool(act.tool);
    onApplied?.();
  });
}
