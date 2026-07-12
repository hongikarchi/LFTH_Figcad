import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraRig, lensMmToFovDeg } from '../src/engine/CameraRig';

// CameraRig 현행동작 고정(characterization) — 뷰 시스템 개편(A-S1~S4) 전 안전망.
// 개편이 의도적으로 바꾸는 동작(입면=원근, phi 상한 등)은 해당 슬라이스에서 테스트도 함께 갱신한다.

const MIN_PHI = 0.05;
const MAX_PHI = Math.PI / 2 - 0.02;

function makeRig(): CameraRig {
  return new CameraRig(1280 / 800);
}

/** 모드 트윈 완료까지 진행 (TWEEN_DURATION=0.3s) */
function finishTween(rig: CameraRig): void {
  for (let i = 0; i < 10 && rig.tick(0.1); i++) {
    /* tick until settled */
  }
}

describe('lensMmToFovDeg', () => {
  it('55° 기본 fov ≡ 23.05mm 렌즈', () => {
    expect(lensMmToFovDeg(23.05)).toBeCloseTo(55, 1);
  });
  it('12mm = 90°(수직), 초점거리 증가 = fov 감소', () => {
    expect(lensMmToFovDeg(12)).toBeCloseTo(90, 6);
    expect(lensMmToFovDeg(50)).toBeLessThan(lensMmToFovDeg(24));
  });
});

describe('기본 상태·모드 전환', () => {
  it('초기: 3d 모드, active=원근, fov 55', () => {
    const rig = makeRig();
    expect(rig.mode).toBe('3d');
    const cam = rig.active as THREE.PerspectiveCamera;
    expect(cam.isPerspectiveCamera).toBe(true);
    expect(cam.fov).toBe(55);
  });

  it('plan 진입 = 북향 스냅(theta=π) + 트윈 완료 후 active=직교', () => {
    const rig = makeRig();
    rig.setMode('plan');
    expect(rig.active).toHaveProperty('isPerspectiveCamera', true); // 트윈 중엔 원근 유지
    finishTween(rig);
    const cam = rig.active as THREE.OrthographicCamera;
    expect(cam.isOrthographicCamera).toBe(true);
    expect(rig.getPose().theta).toBeCloseTo(Math.PI, 9);
    expect(rig.getPose().phi).toBeCloseTo(MIN_PHI, 9);
  });

  it('plan 직교 프러스텀 = X 반사 (left>0>right — 동=오른쪽 CAD 표준)', () => {
    const rig = makeRig();
    rig.setMode('plan');
    finishTween(rig);
    const cam = rig.active as THREE.OrthographicCamera;
    expect(cam.left).toBeGreaterThan(0);
    expect(cam.right).toBeLessThan(0);
  });

  it('3d 복귀 시 저장된 theta/phi 복원', () => {
    const rig = makeRig();
    const before = rig.getPose();
    rig.setMode('plan');
    finishTween(rig);
    rig.setMode('3d');
    finishTween(rig);
    const after = rig.getPose();
    expect(after.theta).toBeCloseTo(before.theta, 9);
    expect(after.phi).toBeCloseTo(before.phi, 9);
  });

  it('plan에서 northScreenAngle ≈ -π/2 (북=화면 위)', () => {
    const rig = makeRig();
    rig.setMode('plan');
    finishTween(rig);
    expect(rig.northScreenAngle()).toBeCloseTo(-Math.PI / 2, 3);
  });
});

describe('setView 프리셋 (현행: 입면=원근 스냅 — S1에서 ortho로 교체 예정)', () => {
  it('front = 남쪽에서 북(+Z) 바라봄, 수평 시선, active=원근', () => {
    const rig = makeRig();
    rig.setView('front');
    const pose = rig.getPose();
    expect(pose.theta).toBeCloseTo(Math.PI, 9);
    expect(pose.phi).toBeCloseTo(Math.PI / 2, 9); // setView는 phi 클램프 미적용(현행)
    const cam = rig.active as THREE.PerspectiveCamera;
    expect(cam.isPerspectiveCamera).toBe(true);
    expect(cam.position.z).toBeLessThan(pose.target[2]); // 카메라가 타깃 남쪽(-Z)
    expect(Math.abs(cam.position.y - pose.target[1])).toBeLessThan(1e-6); // 수평
  });

  it('right = 동쪽서 서쪽 바라봄 (+X측)', () => {
    const rig = makeRig();
    rig.setView('right');
    const cam = rig.active as THREE.PerspectiveCamera;
    expect(cam.position.x).toBeGreaterThan(rig.getPose().target[0]);
  });

  it('top = plan 모드 경로 재사용', () => {
    const rig = makeRig();
    rig.setView('top');
    expect(rig.mode).toBe('plan');
  });

  it('iso = 기본 등각 복귀', () => {
    const rig = makeRig();
    rig.setView('front');
    rig.setView('iso');
    const pose = rig.getPose();
    expect(pose.theta).toBeCloseTo(Math.PI / 4, 9);
    expect(pose.phi).toBeCloseTo(Math.PI / 4.5, 9);
  });
});

describe('오빗·줌·팬', () => {
  it('rotate는 phi를 [MIN_PHI, MAX_PHI]로 클램프 (현행: 아래서 올려다보기 불가 — S4 대상)', () => {
    const rig = makeRig();
    rig.rotate(0, -10000); // phi 증가 방향(수평 시선 쪽)
    expect(rig.getPose().phi).toBeCloseTo(MAX_PHI, 9);
    rig.rotate(0, 10000); // phi 감소 방향(탑다운 쪽)
    expect(rig.getPose().phi).toBeCloseTo(MIN_PHI, 9);
  });

  it('zoom은 distance를 [1, 5000]으로 클램프', () => {
    const rig = makeRig();
    rig.zoom(1e-9);
    expect(rig.getPose().distance).toBe(1);
    rig.zoom(1e12);
    expect(rig.getPose().distance).toBe(5000);
  });

  it('plan 모드 orbit = 팬 (theta 불변, X-반사 방향 고정)', () => {
    const rig = makeRig();
    rig.setMode('plan');
    finishTween(rig);
    const before = rig.getPose();
    // 오른쪽 드래그(dx>0) → 콘텐츠가 커서를 따라옴 → X반사 ortho에서 target은 -X(서쪽)로.
    // pan()의 plan 분기 `pdx = -dx` 부호를 고정 (뒤집히면 콘텐츠가 커서 반대로 감).
    rig.orbit(100, 0);
    const afterX = rig.getPose();
    expect(afterX.theta).toBeCloseTo(before.theta, 9);
    expect(afterX.target[0]).toBeLessThan(before.target[0]);
    // 아래 드래그(dy>0) → target은 +Z(북쪽)로 (theta=π 기준)
    rig.orbit(0, 50);
    expect(rig.getPose().target[2]).toBeGreaterThan(afterX.target[2]);
  });

  it('rotate 방향·감도 고정 — theta -= dx·0.005', () => {
    const rig = makeRig();
    const before = rig.getPose();
    rig.rotate(100, 0);
    expect(rig.getPose().theta).toBeCloseTo(before.theta - 100 * 0.005, 9);
  });
});

describe('setPivot — 카메라 위치 고정 피벗 변경', () => {
  it('피벗 변경 후 카메라 위치 무점프, target=새 피벗', () => {
    const rig = makeRig();
    const cam = rig.active as THREE.PerspectiveCamera;
    const posBefore = cam.position.clone();
    rig.setPivot(2, 1, 3);
    expect(cam.position.distanceTo(posBefore)).toBeLessThan(1e-9);
    expect(rig.getPose().target).toEqual([2, 1, 3]);
  });

  it('역산 phi가 클램프 밖(피벗이 카메라보다 위)이면 피벗 유지', () => {
    const rig = makeRig();
    const cam = rig.active as THREE.PerspectiveCamera;
    const targetBefore = rig.getPose().target;
    rig.setPivot(cam.position.x, cam.position.y + 10, cam.position.z + 0.001);
    expect(rig.getPose().target).toEqual(targetBefore);
  });

  it('plan 모드에선 no-op', () => {
    const rig = makeRig();
    rig.setMode('plan');
    finishTween(rig);
    const before = rig.getPose().target;
    rig.setPivot(9, 9, 9);
    expect(rig.getPose().target).toEqual(before);
  });
});

describe('getPose/setPose', () => {
  it('라운드트립 (3d)', () => {
    const rig = makeRig();
    rig.setPose({ target: [3, 1.5, -2], distance: 40, theta: 1.1, phi: 0.9 });
    const p = rig.getPose();
    expect(p.target).toEqual([3, 1.5, -2]);
    expect(p.distance).toBe(40);
    expect(p.theta).toBeCloseTo(1.1, 9);
    expect(p.phi).toBeCloseTo(0.9, 9);
  });

  it('setPose는 phi/distance 클램프 (현행 MAX_PHI 상한 — S4 대상)', () => {
    const rig = makeRig();
    rig.setPose({ target: [0, 0, 0], distance: 99999, theta: 0, phi: 3 });
    expect(rig.getPose().distance).toBe(5000);
    expect(rig.getPose().phi).toBeCloseTo(MAX_PHI, 9);
  });
});

describe('fitBounds', () => {
  it('타깃=박스 중심, 박스 전체가 들어오는 거리', () => {
    const rig = makeRig();
    rig.fitBounds(new THREE.Vector3(10, 0, 10), new THREE.Vector3(20, 10, 20));
    const p = rig.getPose();
    expect(p.target).toEqual([15, 5, 15]);
    expect(p.distance).toBeGreaterThan(5); // radius=5 이상
  });

  it('비유한/역전 박스는 무시', () => {
    const rig = makeRig();
    const before = rig.getPose();
    rig.fitBounds(new THREE.Vector3(NaN, 0, 0), new THREE.Vector3(1, 1, 1));
    rig.fitBounds(new THREE.Vector3(5, 0, 0), new THREE.Vector3(1, 1, 1));
    expect(rig.getPose()).toEqual(before);
  });
});

describe('걷기(1인칭)', () => {
  it('enterWalk = 오빗 타깃 지점 착지(eyeY), 시선 = 오빗 방위 유지', () => {
    const rig = makeRig();
    const before = rig.getPose();
    rig.enterWalk(1.6);
    expect(rig.isWalking).toBe(true);
    const cam = rig.active as THREE.PerspectiveCamera;
    expect(cam.position.x).toBeCloseTo(before.target[0], 9);
    expect(cam.position.y).toBeCloseTo(1.6, 9);
    expect(cam.position.z).toBeCloseTo(before.target[2], 9);
    // 방위 유지 고정 — walkYaw=θ+π 규약에서만 합성 오빗 theta가 원래 θ로 역산됨(+π 누락=180° 반전)
    expect(rig.getPose().theta).toBeCloseTo(before.theta, 9);
  });

  it('walkMove는 yaw 수평 기저 이동 (pitch 무관)', () => {
    const rig = makeRig();
    rig.enterWalk(1.6);
    rig.walkLook(0, 5000); // pitch를 극단으로
    const cam = rig.active as THREE.PerspectiveCamera;
    const y0 = cam.position.y;
    rig.walkMove(3, 0, 0);
    expect(cam.position.y).toBeCloseTo(y0, 9); // 전진해도 고도 불변(Enscape 보행 의미론)
  });

  it('exitWalk = 카메라 위치 연속(점프 0) + 걷기 해제 + 거리 상한 클램프', () => {
    const rig = makeRig();
    rig.zoom(10); // distance 25→250: WALK_EXIT_MAX_DIST 클램프 경로를 실제로 실행
    rig.enterWalk(1.6);
    rig.walkLook(120, 40);
    rig.walkMove(2, 1, 0.3);
    const cam = rig.active as THREE.PerspectiveCamera;
    const eye = cam.position.clone();
    rig.exitWalk();
    expect(rig.isWalking).toBe(false);
    expect(cam.position.distanceTo(eye)).toBeLessThan(1e-6); // D 클램프돼도 target 역산이 위치 보존
    expect(rig.getPose().distance).toBe(50); // WALK_EXIT_MAX_DIST 정확값
  });

  it('exitWalk 수평 시선(phi 클램프 발동)에서도 위치 점프 0 — walkToOrbit 역산 불변식', () => {
    const rig = makeRig();
    rig.enterWalk(1.6); // pitch=0 → phi_raw=π/2 > MAX_PHI → 클램프 분기 실행
    const cam = rig.active as THREE.PerspectiveCamera;
    const eye = cam.position.clone();
    rig.exitWalk();
    expect(cam.position.distanceTo(eye)).toBeLessThan(1e-6);
    // 클램프가 실제로 발동했는지 고정 — S4에서 MAX_PHI 변경 시 이 기대값도 의도 갱신 대상
    expect(rig.getPose().phi).toBeCloseTo(MAX_PHI, 9);
  });

  it('걷기 중 getPose = 합성 오빗 포즈 (phi 클램프 내)', () => {
    const rig = makeRig();
    rig.enterWalk(1.6);
    rig.walkLook(0, -3000); // 위 올려다봄
    const p = rig.getPose();
    expect(p.phi).toBeGreaterThanOrEqual(MIN_PHI);
    expect(p.phi).toBeLessThanOrEqual(MAX_PHI);
  });

  it('걷기 중 worldPerPixel = 고정 10m 기준(실내 스케일)', () => {
    const rig = makeRig();
    const wppOrbit = rig.worldPerPixel(); // distance=25 기준
    rig.enterWalk(1.6);
    const wppWalk = rig.worldPerPixel(); // 10m 기준
    expect(wppWalk).toBeCloseTo(wppOrbit * (10 / 25), 9);
  });
});
