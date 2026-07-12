import { describe, expect, it } from 'vitest';
import { hotkeyChar, resolveHotkey } from '../src/input/hotkeys';

// per-tool 핫키 해석(Slice 11) — 모드 팔레트 게이팅·오버라이드·비핫키 통과를 고정.

describe('resolveHotkey', () => {
  it('모델 모드: 그리기 도구 키 전부 매핑', () => {
    expect(resolveHotkey('w', 'model')).toEqual({ kind: 'tool', tool: 'wall' });
    expect(resolveHotkey('d', 'model')).toEqual({ kind: 'tool', tool: 'door' });
    expect(resolveHotkey('n', 'model')).toEqual({ kind: 'tool', tool: 'window' });
    expect(resolveHotkey('s', 'model')).toEqual({ kind: 'tool', tool: 'slab' });
    expect(resolveHotkey('c', 'model')).toEqual({ kind: 'tool', tool: 'column' });
    expect(resolveHotkey('b', 'model')).toEqual({ kind: 'tool', tool: 'beam' });
    expect(resolveHotkey('g', 'model')).toEqual({ kind: 'tool', tool: 'grid' });
    expect(resolveHotkey('t', 'model')).toEqual({ kind: 'tool', tool: 'stair' });
    expect(resolveHotkey('r', 'model')).toEqual({ kind: 'tool', tool: 'railing' });
    expect(resolveHotkey('v', 'model')).toEqual({ kind: 'tool', tool: 'select' });
  });

  it('모드 팔레트 게이팅 — 리뷰에서 벽(W)은 무반응, 허브는 select만', () => {
    expect(resolveHotkey('w', 'review')).toBeNull();
    expect(resolveHotkey('c', 'hub')).toBeNull();
    expect(resolveHotkey('m', 'hub')).toBeNull();
    expect(resolveHotkey('v', 'hub')).toEqual({ kind: 'tool', tool: 'select' });
  });

  it('리뷰 오버라이드 — C=코멘트 (모델에선 기둥)', () => {
    expect(resolveHotkey('c', 'review')).toEqual({ kind: 'tool', tool: 'comment' });
    expect(resolveHotkey('m', 'review')).toEqual({ kind: 'tool', tool: 'measure' });
    expect(resolveHotkey('k', 'review')).toEqual({ kind: 'tool', tool: 'sketch-pen' });
  });

  it('숫자키 = 모드 전환 (ModeTabs 순서)', () => {
    expect(resolveHotkey('1', 'model')).toEqual({ kind: 'mode', mode: 'review' });
    expect(resolveHotkey('2', 'review')).toEqual({ kind: 'mode', mode: 'model' });
    expect(resolveHotkey('3', 'review')).toEqual({ kind: 'mode', mode: 'hub' });
  });

  it('비핫키(F/Z/Esc/화살표 등 기존 핸들러 키)는 null 통과', () => {
    for (const k of ['f', 'z', 'escape', 'delete', 'arrowup', 'pageup', 'q', 'e', '4', '0']) {
      expect(resolveHotkey(k, 'model')).toBeNull();
    }
  });
});

describe('hotkeyChar — 한글 IME/비라틴 레이아웃 e.code 폴백 (리뷰 iter2)', () => {
  it('한글 자모(e.key=ㅈ)는 물리 키 KeyW로 해석', () => {
    expect(hotkeyChar('ㅈ', 'KeyW')).toBe('w');
    expect(hotkeyChar('ㅁ', 'KeyA')).toBe('a');
    expect(hotkeyChar('ㄴ', 'Digit1')).toBe('1');
  });
  it('라틴 키·숫자는 e.key 그대로, 특수키는 통과', () => {
    expect(hotkeyChar('W', 'KeyW')).toBe('w');
    expect(hotkeyChar('1', 'Digit1')).toBe('1');
    expect(hotkeyChar('Escape', 'Escape')).toBe('escape');
    expect(hotkeyChar('ArrowUp', 'ArrowUp')).toBe('arrowup');
  });
});
