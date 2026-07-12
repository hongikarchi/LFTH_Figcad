import { describe, expect, it } from 'vitest';
import { DocStore, seedDocument, SEED_IDS } from '../src/store';
import { executeOp, isMutatingOp } from '../src/ai';
import { isViewCapability, listCapabilities } from '../src/capabilities';

// ui-action(B-P1) — category 'view': 문서 무변경, run=이름→id 해소·검증·정규화만.
// 실행(카메라)은 클라 uiActionExecutor — 여기선 서버 드라이런 계약(payload·throw)만 고정.

function seeded(): DocStore {
  const s = new DocStore();
  seedDocument(s);
  return s;
}

describe('view capabilities — 등록·분류', () => {
  it('6종 전부 aiExposed·비mutating·view 카테고리', () => {
    const views = listCapabilities({ category: 'view' });
    expect(views.map((c) => c.id).sort()).toEqual([
      'ui_focus', 'ui_jump_viewpoint', 'ui_set_clip', 'ui_set_story', 'ui_set_view', 'ui_set_view_mode',
    ]);
    for (const c of views) {
      expect(c.aiExposed).toBe(true);
      expect(c.mutating).toBe(false);
      expect(isMutatingOp(c.id)).toBe(false);
      expect(isViewCapability(c.id)).toBe(true);
    }
    expect(isViewCapability('create_wall')).toBe(false);
  });

  it('run은 문서를 변경하지 않는다 (스냅샷 불변 — store를 실제로 읽는 2종 포함)', () => {
    const s = seeded();
    const lv = s.listLevels()[0]!;
    s.addViewpoint({
      camera: { target: [0, 0, 0], distance: 20, theta: 1, phi: 1 },
      viewMode: '3d', clip: null, author: 'x',
    });
    const before = JSON.stringify(s.snapshot());
    executeOp(s, 'ui_set_view', { preset: 'front' });
    executeOp(s, 'ui_set_view_mode', { mode: 'plan' });
    executeOp(s, 'ui_set_clip', { axis: 'y', t: 0.4 });
    executeOp(s, 'ui_focus', {});
    executeOp(s, 'ui_set_story', { level: lv.name }); // store 조회 경로
    executeOp(s, 'ui_jump_viewpoint', { viewpoint: '1' }); // store 조회 경로
    expect(JSON.stringify(s.snapshot())).toBe(before);
  });
});

describe('ui_set_view / ui_set_view_mode / ui_set_clip — 정규화', () => {
  it('preset·mode 검증 + 통과 payload', () => {
    const s = seeded();
    expect(executeOp(s, 'ui_set_view', { preset: 'right' })).toEqual({ preset: 'right' });
    expect(() => executeOp(s, 'ui_set_view', { preset: 'diagonal' })).toThrow();
    expect(executeOp(s, 'ui_set_view_mode', { mode: '3d' })).toEqual({ mode: '3d' });
    expect(() => executeOp(s, 'ui_set_view_mode', { mode: '2d' })).toThrow();
  });

  it('clip — 기본값(y, 0.5, flip=false)·t 클램프·off', () => {
    const s = seeded();
    expect(executeOp(s, 'ui_set_clip', {})).toEqual({ clip: { axis: 'y', t: 0.5, flip: false } });
    expect(executeOp(s, 'ui_set_clip', { axis: 'x', t: 1.7, flip: true })).toEqual({
      clip: { axis: 'x', t: 1, flip: true },
    });
    expect(executeOp(s, 'ui_set_clip', { off: true })).toEqual({ clip: null });
    expect(() => executeOp(s, 'ui_set_clip', { axis: 'w' })).toThrow();
  });
});

describe('ui_set_story — 레벨 해소', () => {
  it('id·정확명·부분명 순서로 해소, 미해소는 목록 포함 throw', () => {
    const s = seeded();
    const lv = s.listLevels()[0]!;
    expect(executeOp(s, 'ui_set_story', { level: lv.id })).toEqual({ levelId: lv.id, levelName: lv.name });
    expect(executeOp(s, 'ui_set_story', { level: lv.name })).toEqual({ levelId: lv.id, levelName: lv.name });
    expect(() => executeOp(s, 'ui_set_story', { level: '지하 7층' })).toThrow(/레벨 목록/);
  });

  it('부분 일치 — "2층 평면"의 "2층"이 "2층 (L2)" 같은 이름에 닿음', () => {
    const s = seeded();
    const id = s.addLevel({ name: '2층 (L2)', elevation: 3000, height: 3000, order: 1 });
    expect(executeOp(s, 'ui_set_story', { level: '2층' })).toEqual({ levelId: id, levelName: '2층 (L2)' });
  });
});

describe('ui_jump_viewpoint — id·번호·이름 해소', () => {
  it('번호("3"·"3번")=index, 이름 정확·부분, 미해소 throw', () => {
    const s = seeded();
    const id1 = s.addViewpoint({
      camera: { target: [0, 0, 0], distance: 20, theta: 1, phi: 1 },
      viewMode: '3d', clip: null, author: 'a',
    });
    const id2 = s.addViewpoint({
      camera: { target: [5, 0, 0], distance: 10, theta: 2, phi: 0.8 },
      viewMode: '3d', clip: { axis: 'y', t: 0.5, flip: false }, author: 'b', name: '로비 단면',
    });
    const vp2 = s.listViewpoints().find((v) => v.id === id2)!;
    expect(executeOp(s, 'ui_jump_viewpoint', { viewpoint: id1 })).toMatchObject({ viewpointId: id1 });
    expect(executeOp(s, 'ui_jump_viewpoint', { viewpoint: String(vp2.index) })).toMatchObject({ viewpointId: id2 });
    expect(executeOp(s, 'ui_jump_viewpoint', { viewpoint: `${vp2.index}번` })).toMatchObject({ viewpointId: id2 });
    expect(executeOp(s, 'ui_jump_viewpoint', { viewpoint: '로비 단면' })).toMatchObject({ viewpointId: id2 });
    expect(executeOp(s, 'ui_jump_viewpoint', { viewpoint: '로비' })).toMatchObject({ viewpointId: id2 });
    expect(() => executeOp(s, 'ui_jump_viewpoint', { viewpoint: '없는뷰' })).toThrow(/목록/);
  });
});

describe('ui_focus — id 검증', () => {
  it('존재 요소 통과·미존재 throw·생략=전체', () => {
    const s = seeded();
    const w = s.createWall({ levelId: SEED_IDS.level, typeId: SEED_IDS.wall200, a: [0, 0], b: [3000, 0] });
    expect(executeOp(s, 'ui_focus', { ids: [w] })).toEqual({ ids: [w] });
    expect(executeOp(s, 'ui_focus', {})).toEqual({ ids: null });
    expect(() => executeOp(s, 'ui_focus', { ids: [w, 'ghost-id'] })).toThrow(/ghost-id/);
  });
});
