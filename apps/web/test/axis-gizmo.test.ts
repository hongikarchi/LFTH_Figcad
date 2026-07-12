import { describe, expect, it } from 'vitest';
import { gizmoPresetFor } from '../src/hud/AxisGizmo';
import type { CameraPose } from '../src/engine/CameraRig';

// 축-공 기즈모(A-S2) 순수 로직 — 공→프리셋 매핑(§C-1: 공 = "그 방위에서 본다")과
// 정착 상태 재클릭 = 반대축(Blender 토글). DOM/투영은 review-smoke가 라이브 검증.

const pose = (theta: number, phi: number): CameraPose => ({ target: [0, 0, 0], distance: 25, theta, phi });
const ISO = pose(Math.PI / 4, Math.PI / 4.5);

describe('gizmoPresetFor', () => {
  it('공 = 그 방위에서 보기 — N공(북에서 봄)=back(북측 입면), S공=front(남측 입면)', () => {
    expect(gizmoPresetFor('N', ISO, '3d')).toBe('back');
    expect(gizmoPresetFor('S', ISO, '3d')).toBe('front');
    expect(gizmoPresetFor('E', ISO, '3d')).toBe('right'); // 동에서 봄 = 동측 입면
    expect(gizmoPresetFor('W', ISO, '3d')).toBe('left');
    expect(gizmoPresetFor('T', ISO, '3d')).toBe('top');
    expect(gizmoPresetFor('B', ISO, '3d')).toBe('bottom');
  });

  it('정착 상태 재클릭 = 반대축 (Blender 토글)', () => {
    const atFront = pose(Math.PI, Math.PI / 2);
    expect(gizmoPresetFor('S', atFront, '3d')).toBe('back'); // front에 정착 → S 재클릭 = 반대편
    expect(gizmoPresetFor('N', atFront, '3d')).toBe('back'); // 다른 공은 그대로
    const atRight = pose(Math.PI / 2, Math.PI / 2);
    expect(gizmoPresetFor('E', atRight, '3d')).toBe('left');
    // θ 래핑 동치 — -π ≡ π (front)
    expect(gizmoPresetFor('S', pose(-Math.PI, Math.PI / 2), '3d')).toBe('back');
  });

  it('T공: plan 정착 상태서 재클릭 = bottom (각도 아닌 모드 기준)', () => {
    expect(gizmoPresetFor('T', pose(Math.PI, 0.05), 'plan')).toBe('bottom');
    expect(gizmoPresetFor('T', ISO, '3d')).toBe('top');
  });

  it('bottom 정착 → B 재클릭 = top', () => {
    const atBottom = pose(Math.PI, Math.PI - 0.05);
    expect(gizmoPresetFor('B', atBottom, '3d')).toBe('top');
  });
});
