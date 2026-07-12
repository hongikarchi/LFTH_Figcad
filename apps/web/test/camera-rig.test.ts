import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraRig, lensMmToFovDeg } from '../src/engine/CameraRig';

// CameraRig 동작 고정 — S1(입면 true ortho + projection 축)·S4(full-sphere 오빗) 반영본.
// 남은 개편(S3 포즈 트윈)이 바꾸는 동작은 해당 슬라이스에서 테스트도 함께 갱신한다.

const MIN_PHI = 0.05;
const MAX_PHI = Math.PI - 0.05; // A-S4 full-sphere (극점 특이점만 회피)

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

/** 프리셋은 S3부터 포즈 트윈 — 도착 상태 단언은 finishTween 후 */
function setViewDone(rig: CameraRig, preset: Parameters<CameraRig['setView']>[0]): void {
  rig.setView(preset);
  finishTween(rig);
}

describe('setView 프리셋 (S1: 입면/저면 = true ortho, iso = 원근 · S3: 최단호 트윈 + Auto Perspective)', () => {
  it('front = 남쪽에서 북(+Z) 바라봄, 수평 시선, active=직교(입면)', () => {
    const rig = makeRig();
    setViewDone(rig, 'front');
    const pose = rig.getPose();
    expect(pose.theta).toBeCloseTo(Math.PI, 9);
    expect(pose.phi).toBeCloseTo(Math.PI / 2, 9); // full-sphere라 π/2가 클램프 내 (오빗 튐 해소)
    const cam = rig.active as THREE.OrthographicCamera;
    expect(cam.isOrthographicCamera).toBe(true); // 8b — 원근 왜곡 없는 입면
    expect(cam.position.z).toBeLessThan(pose.target[2]); // 카메라가 타깃 남쪽(-Z)
    expect(Math.abs(cam.position.y - pose.target[1])).toBeLessThan(1e-6); // 수평
    // 입면 ortho도 X반사(plan과 동일 이유 — 문서→월드 매핑 반사 교정)
    expect(cam.left).toBeGreaterThan(0);
    expect(cam.right).toBeLessThan(0);
  });

  it('chirality — 남측 입면에서 동쪽(+X)이 화면 오른쪽 (실세계·Rhino Front·plan과 일치)', () => {
    const rig = makeRig();
    setViewDone(rig, 'front');
    rig.active.updateMatrixWorld();
    const eastFront = new THREE.Vector3(5, 0, 0).project(rig.active).x;
    expect(eastFront).toBeGreaterThan(0); // 반사 교정 전엔 −0.24(왼쪽 거울상)
    // 자체 plan 뷰와도 일관 — 같은 동쪽 점이 양쪽 모두 화면 오른쪽
    rig.setMode('plan');
    finishTween(rig);
    rig.active.updateMatrixWorld();
    expect(new THREE.Vector3(5, 0, 0).project(rig.active).x).toBeGreaterThan(0);
  });

  it('입면 ortho 프러스텀 반높이 = distance·tan(fov/2) — persp↔ortho 스왑 무봉합', () => {
    const rig = makeRig();
    setViewDone(rig, 'front');
    const cam = rig.active as THREE.OrthographicCamera;
    const pose = rig.getPose();
    const expected = pose.distance * Math.tan((55 / 2) * (Math.PI / 180));
    expect(cam.top - cam.bottom).toBeCloseTo(2 * expected, 9);
    // worldPerPixel 3d 공식이 ortho 프러스텀 매핑과 정확히 일치
    expect(rig.worldPerPixel()).toBeCloseTo((cam.top - cam.bottom) / 800, 9);
  });

  it('right = 동쪽서 서쪽 바라봄 (+X측)', () => {
    const rig = makeRig();
    setViewDone(rig, 'right');
    const cam = rig.active as THREE.OrthographicCamera;
    expect(cam.position.x).toBeGreaterThan(rig.getPose().target[0]);
  });

  it('bottom = 아래서 올려다봄 (φ=MAX_PHI, 직교)', () => {
    const rig = makeRig();
    setViewDone(rig, 'bottom');
    const cam = rig.active as THREE.OrthographicCamera;
    expect(cam.isOrthographicCamera).toBe(true);
    expect(rig.getPose().phi).toBeCloseTo(MAX_PHI, 9);
    expect(cam.position.y).toBeLessThan(rig.getPose().target[1]); // 카메라가 타깃 아래
  });

  it('입면 ortho에서 orbit = 팬 (Rhino 평행 뷰 의미론, X반사 방향 고정)', () => {
    const rig = makeRig();
    setViewDone(rig, 'front');
    const before = rig.getPose();
    rig.orbit(100, 0); // 오른쪽 드래그 → 콘텐츠가 커서 따라옴 → target은 -X (plan과 동일 부호 반전)
    const after = rig.getPose();
    expect(after.theta).toBeCloseTo(before.theta, 9); // 회전 안 함
    expect(after.target[0]).toBeLessThan(before.target[0]);
    expect(rig.isOrtho).toBe(true); // ortho 유지
  });

  it('입면 ortho에서 setPivot 무시 — RMB 피벗이 축정렬 입면을 기울이지 않음', () => {
    const rig = makeRig();
    setViewDone(rig, 'front');
    const before = rig.getPose();
    rig.setPivot(5, 2, 3); // 리뷰 실증: 가드 없으면 시선축 12° 기울어 사선 액소노로 변형
    expect(rig.getPose()).toEqual(before);
    expect(rig.isOrtho).toBe(true);
  });

  it('입면 ortho fitBounds = tan(fov/2) 공식 (sin 공식이면 실여유율 1.30 과줌아웃)', () => {
    const rig = makeRig();
    setViewDone(rig, 'front');
    rig.fitBounds(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50));
    const expected = (50 / Math.tan((55 / 2) * (Math.PI / 180))) * 1.15;
    expect(rig.getPose().distance).toBeCloseTo(expected, 6);
  });

  it('front 입면 = 북축 퇴화 — northScreenAngle 마지막 유효각 유지(float 노이즈 각도 금지)', () => {
    const rig = makeRig();
    const isoAngle = rig.northScreenAngle(); // 등각에서 유한 유효각
    setViewDone(rig, 'front'); // 북(0,0,1)이 시선과 평행 → 화면 Δ≈1e-15px
    expect(rig.northScreenAngle()).toBeCloseTo(isoAngle, 9);
  });

  it('top = plan 모드 경로 재사용 (입면 ortho 상태서도 plan 경로로 정상 진입)', () => {
    const rig = makeRig();
    setViewDone(rig, 'front');
    setViewDone(rig, 'top');
    expect(rig.mode).toBe('plan');
    finishTween(rig);
    const cam = rig.active as THREE.OrthographicCamera;
    expect(cam.left).toBeGreaterThan(0); // plan X반사 프러스텀 (입면 표준 방향 잔존 없음)
    expect(cam.right).toBeLessThan(0);
  });

  it('iso = 기본 등각 + 원근 복귀', () => {
    const rig = makeRig();
    setViewDone(rig, 'front');
    setViewDone(rig, 'iso');
    const pose = rig.getPose();
    expect(pose.theta).toBeCloseTo(Math.PI / 4, 9);
    expect(pose.phi).toBeCloseTo(Math.PI / 4.5, 9);
    expect(rig.isOrtho).toBe(false);
  });

  it('setMode·setPose·enterWalk는 입면 ortho를 원근으로 리셋', () => {
    const a = makeRig();
    setViewDone(a, 'front');
    a.setMode('plan');
    finishTween(a);
    a.setMode('3d');
    finishTween(a);
    expect(a.isOrtho).toBe(false);

    const b = makeRig();
    setViewDone(b, 'front');
    b.setPose({ target: [0, 0, 0], distance: 30, theta: 1, phi: 1 }); // 뷰포인트 점프 = 원근 의미론
    expect(b.isOrtho).toBe(false);

    const c = makeRig();
    setViewDone(c, 'front');
    c.enterWalk(1.6); // 걷기 = 항상 원근
    expect((c.active as THREE.PerspectiveCamera).isPerspectiveCamera).toBe(true);
  });
});

describe('A-S3 — 포즈 트윈·Auto Perspective', () => {
  it('축뷰 트윈 중엔 persp, 도착 순간 ortho 스왑 (Auto Perspective)', () => {
    const rig = makeRig();
    rig.setView('front');
    expect(rig.isOrtho).toBe(false); // 비행 중 = 원근
    rig.tick(0.1); // 중간 프레임
    expect(rig.isOrtho).toBe(false);
    const midPhi = rig.getPose().phi;
    expect(midPhi).toBeGreaterThan(Math.PI / 4.5); // iso→front로 진행 중
    expect(midPhi).toBeLessThan(Math.PI / 2);
    finishTween(rig);
    expect(rig.isOrtho).toBe(true); // 도착 = 직교 스왑
  });

  it('θ 최단호 래핑 — θ≈−3.0에서 front(π)로 짧은 호(Δ≈−0.14)로 이동', () => {
    const rig = makeRig();
    rig.rotate((Math.PI / 4 + 3.0) / 0.005, 0); // theta: π/4 → −3.0 (rotate는 θ-=dx·0.005)
    expect(rig.getPose().theta).toBeCloseTo(-3.0, 6);
    setViewDone(rig, 'front');
    // 래핑 없으면 −3.0→+π(Δ=+6.14, 한 바퀴) — 최단호는 −3.0→−π(Δ=−0.14)
    expect(rig.getPose().theta).toBeCloseTo(-Math.PI, 6);
  });

  it('autoOrtho에서 rotate = 원근 복귀 (Blender Auto Perspective)', () => {
    const rig = makeRig();
    setViewDone(rig, 'front');
    expect(rig.isOrtho).toBe(true);
    rig.rotate(30, 10);
    expect(rig.isOrtho).toBe(false); // 축뷰가 켠 ortho는 회전 시 원근 복귀
  });

  it('수동 setProjection ortho는 rotate에도 유지 (autoOrtho 아님)', () => {
    const rig = makeRig();
    rig.setProjection('ortho');
    expect(rig.isOrtho).toBe(true);
    rig.rotate(30, 10);
    expect(rig.isOrtho).toBe(true); // 수동 토글 = 유지
    rig.setProjection('persp');
    expect(rig.isOrtho).toBe(false);
  });

  it('프리셋 비행 중 입력 개입 = 현 지점 동결 + ortho 스왑 취소', () => {
    const rig = makeRig();
    rig.setView('front');
    rig.tick(0.1);
    const midPhi = rig.getPose().phi;
    rig.zoom(1.5); // 조종간 잡음 — 트윈 동결
    expect(rig.getPose().phi).toBeCloseTo(midPhi, 9); // phi 그대로(끝값으로 점프 안 함)
    finishTween(rig); // 트윈 이미 소멸 — no-op
    expect(rig.isOrtho).toBe(false); // 스왑 취소
  });

  it('plan 진입 비행 중 입력 개입 = 끝값(탑다운) 스냅 후 적용 (forceComplete)', () => {
    const rig = makeRig();
    rig.setMode('plan');
    rig.tick(0.05); // 진입 비행 중
    rig.orbit(100, 0); // plan 팬 시도
    expect(rig.getPose().phi).toBeCloseTo(MIN_PHI, 9); // 미완 φ 방치 금지 — 탑다운 강제 도달
    expect(rig.getPose().theta).toBeCloseTo(Math.PI, 9);
  });

  it('setPose auto — 가까우면 트윈 비행, 멀면 스냅 (§C 결정5)', () => {
    const near = makeRig();
    near.setPose({ target: [3, 0, 3], distance: 30, theta: 1.0, phi: 1.0 }, 'auto');
    expect(near.getPose().theta).not.toBeCloseTo(1.0, 3); // 아직 비행 중
    finishTween(near);
    expect(near.getPose().theta).toBeCloseTo(1.0, 9);
    expect(near.getPose().target[0]).toBeCloseTo(3, 9);

    const far = makeRig();
    far.setPose({ target: [5000, 0, 5000], distance: 30, theta: 1.0, phi: 1.0 }, 'auto');
    expect(far.getPose().theta).toBeCloseTo(1.0, 9); // 즉시 스냅(장거리 트윈은 어지러움)
    expect(far.getPose().target[0]).toBeCloseTo(5000, 9);
  });

  it('같은 축뷰 재클릭 = no-op — persp 강등·미러 왕복 플래시 없음 (리뷰 iter2)', () => {
    const rig = makeRig();
    setViewDone(rig, 'front');
    expect(rig.isOrtho).toBe(true);
    rig.setView('front'); // 재클릭
    expect(rig.isOrtho).toBe(true); // 즉시 persp 강등 없음
    expect(rig.tick(0.1)).toBe(false); // 공회전 트윈 미생성
  });

  it('평면→걷기 진입 시 3D 복원 트윈 끝값 채택 — 걷기 시선이 북향으로 굳지 않음 (리뷰 iter2)', () => {
    const rig = makeRig();
    rig.rotate(200, 0); // theta: π/4 − 1.0 — 사용자 방위
    const customTheta = rig.getPose().theta;
    rig.setMode('plan');
    finishTween(rig);
    rig.setMode('3d'); // 복원 트윈 시작(t=0)
    rig.enterWalk(1.6); // 트윈 미완 상태로 걷기 진입
    expect(rig.getPose().theta).toBeCloseTo(customTheta, 6); // savedTheta 채택 (π 아님)
  });

  it('트윈은 distance·target도 보간 (뷰포인트 비행)', () => {
    const rig = makeRig();
    rig.setPose({ target: [10, 0, 0], distance: 60, theta: Math.PI / 4, phi: Math.PI / 4.5 }, 'auto');
    rig.tick(0.1);
    const mid = rig.getPose();
    expect(mid.target[0]).toBeGreaterThan(0);
    expect(mid.target[0]).toBeLessThan(10);
    expect(mid.distance).toBeGreaterThan(25);
    expect(mid.distance).toBeLessThan(60);
    finishTween(rig);
    expect(rig.getPose().distance).toBeCloseTo(60, 9);
  });
});

describe('오빗·줌·팬', () => {
  it('rotate는 phi를 [MIN_PHI, MAX_PHI=π−0.05]로 클램프 — full-sphere(S4)', () => {
    const rig = makeRig();
    rig.rotate(0, -10000); // phi 증가 방향(수평 지나 아래서 올려다보기까지)
    expect(rig.getPose().phi).toBeCloseTo(MAX_PHI, 9);
    rig.rotate(0, 10000); // phi 감소 방향(탑다운 쪽)
    expect(rig.getPose().phi).toBeCloseTo(MIN_PHI, 9);
  });

  it('full-sphere: rotate로 수평(π/2)을 지나 아래서 올려다보기 도달', () => {
    const rig = makeRig();
    rig.rotate(0, -400); // phi: π/4.5 + 2.0 ≈ 2.698 — 수평 넘어 하방 시점
    const phi = rig.getPose().phi;
    expect(phi).toBeGreaterThan(Math.PI / 2);
    expect(phi).toBeLessThan(MAX_PHI);
    // 아래서 본 상태에서 카메라가 실제로 타깃보다 낮은가
    const cam = rig.active as THREE.PerspectiveCamera;
    expect(cam.position.y).toBeLessThan(rig.getPose().target[1]);
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

  it('setPose는 phi/distance 클램프 — full-sphere 상한(π−0.05), 하방 포즈 보존', () => {
    const rig = makeRig();
    rig.setPose({ target: [0, 0, 0], distance: 99999, theta: 0, phi: 3 });
    expect(rig.getPose().distance).toBe(5000);
    expect(rig.getPose().phi).toBeCloseTo(3, 9); // 구 상한(π/2−0.02)이면 잘렸을 포즈 — 입면 뷰포인트 복원 정확
    rig.setPose({ target: [0, 0, 0], distance: 30, theta: 0, phi: 3.2 });
    expect(rig.getPose().phi).toBeCloseTo(MAX_PHI, 9); // 극점 밖만 클램프
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

  it('exitWalk 수평 시선 = 정확 복원 (S4: π/2가 클램프 내 — 시선 하향 근사 소멸)', () => {
    const rig = makeRig();
    rig.enterWalk(1.6); // pitch=0 → phi=π/2 그대로 유효
    const cam = rig.active as THREE.PerspectiveCamera;
    const eye = cam.position.clone();
    rig.exitWalk();
    expect(cam.position.distanceTo(eye)).toBeLessThan(1e-6);
    expect(rig.getPose().phi).toBeCloseTo(Math.PI / 2, 9);
  });

  it('exitWalk 극단 상방 시선(phi 클램프 발동)에서도 위치 점프 0 — walkToOrbit 역산 불변식', () => {
    const rig = makeRig();
    rig.enterWalk(1.6);
    rig.walkLook(0, -5000); // pitch=+1.54 → phi_raw≈π−0.031 > MAX_PHI → 클램프 분기 실행
    const cam = rig.active as THREE.PerspectiveCamera;
    const eye = cam.position.clone();
    rig.exitWalk();
    expect(cam.position.distanceTo(eye)).toBeLessThan(1e-6); // 클램프된 phi 역방향 target 역산 = 위치 보존
    expect(rig.getPose().phi).toBeCloseTo(MAX_PHI, 9); // 클램프 실제 발동 고정
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
