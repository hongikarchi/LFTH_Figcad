import { describe, expect, it } from 'vitest';
import { CameraRig } from '../src/engine/CameraRig';
import { screenToDoc } from '../src/engine/Picker';

// 그레이징 가드(리뷰 critical) — 입면 true ortho(φ=π/2)에서 cos(π/2) float 잔차로
// 지면 레이가 t≈1e17m에 "교차" → 문서에 1e20mm 요소 커밋되던 경로를 차단.

describe('screenToDoc 그레이징 가드', () => {
  it('입면 ortho 수평 레이 = 지면과 평행 → 전 픽셀 null (1e20mm 커밋 차단)', () => {
    const rig = new CameraRig(1280 / 800);
    rig.setView('front');
    for (let i = 0; i < 10 && rig.tick(0.1); i++) { /* S3 트윈 완료 — 입면 도착 후가 그레이징 지점 */ }
    rig.active.updateMatrixWorld();
    // 가드 전: 지면 위쪽 픽셀이 [~1e4, ~1e20]mm 히트를 반환했다
    expect(screenToDoc(640, 200, rig.active, 0)).toBeNull();
    expect(screenToDoc(640, 400, rig.active, 0)).toBeNull();
    expect(screenToDoc(640, 600, rig.active, 0)).toBeNull();
  });

  it('원근 3d 기본 뷰에선 정상 지면 히트 유지 (상한 내 mm)', () => {
    const rig = new CameraRig(1280 / 800);
    rig.active.updateMatrixWorld();
    const hit = screenToDoc(640, 400, rig.active, 0);
    expect(hit).not.toBeNull();
    expect(Math.abs(hit![0])).toBeLessThan(1e8);
    expect(Math.abs(hit![1])).toBeLessThan(1e8);
  });

  it('plan 탑다운 ortho에서도 정상 히트 (수직 레이 = 그레이징 아님)', () => {
    const rig = new CameraRig(1280 / 800);
    rig.setMode('plan');
    for (let i = 0; i < 10 && rig.tick(0.1); i++) { /* 트윈 완료 */ }
    rig.active.updateMatrixWorld();
    const hit = screenToDoc(640, 400, rig.active, 0);
    expect(hit).not.toBeNull();
  });
});
