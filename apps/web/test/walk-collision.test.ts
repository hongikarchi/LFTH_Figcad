import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraRig } from '../src/engine/CameraRig';
import { WalkController } from '../src/input/WalkController';

// 걷기 v1.1 벽 충돌 — 헤드리스 시뮬레이션: 실제 CameraRig + WalkController + three 레이캐스트.
// (브라우저 경로는 walk-smoke가 검증 — 여기선 충돌 수학·클립 필터·슬라이드를 결정론적으로 고정)

const EYE = 1.6;

function wallMesh(w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  m.position.set(x, y, z);
  m.updateMatrixWorld(true);
  return m;
}

function makeWalk(roots: THREE.Object3D[], clips: THREE.Plane[] = []) {
  const rig = new CameraRig(1280 / 800);
  // 북쪽(-Z가 아닌 +Z? walkYaw = theta+π): theta=0 → yaw=π → forward=(sin π, 0, cos π)=(0,0,-1) = -Z 방향
  rig.setPose({ target: [0, 0, 0], distance: 20, theta: 0, phi: 1.2 });
  const walk = new WalkController(rig, {
    groundRoots: () => roots,
    levelElevationM: () => 0,
    requestRender: () => {},
    clipPlanes: () => clips,
  });
  return { rig, walk };
}

function eyePos(rig: CameraRig): THREE.Vector3 {
  const v = new THREE.Vector3();
  rig.getWalkEye(v);
  return v;
}

function simulate(walk: WalkController, frames: number, dt = 1 / 60): void {
  for (let i = 0; i < frames; i++) walk.update(dt);
}

describe('걷기 벽 충돌 (v1.1)', () => {
  it('정면 벽에서 정지 — 관통 없음, 몸 반경 유지', () => {
    // 벽: -Z 방향 2m 앞, 두께 0.2m, 충분히 넓고 높음
    const wall = wallMesh(10, 4, 0.2, 0, 2, -2);
    const { rig, walk } = makeWalk([wall]);
    walk.enter(); // (0, 1.6, 0)에서 -Z를 바라보고 시작
    walk.setJoystick(0, 1); // 전진
    simulate(walk, 240); // 4초 — 충돌 없으면 8m 전진(벽 훨씬 지남)
    const eye = eyePos(rig);
    // 벽 앞면 z=-1.9, 몸 반경 0.35 → 정지선 ≈ -1.55
    expect(eye.z).toBeGreaterThan(-1.9); // 관통 안 함
    expect(eye.z).toBeLessThan(-1.2); // 벽 근처까지는 감
    walk.exit();
  });

  it('비스듬한 진행 = 벽 접선 슬라이드 (X로 미끄러짐)', () => {
    const wall = wallMesh(30, 4, 0.2, 0, 2, -2);
    const { rig, walk } = makeWalk([wall]);
    walk.enter();
    walk.setJoystick(0.7, 1); // 전진+우측 대각 (우 = -X 방향: yaw=π 기준 right=(-cos π,0,sin π)... 부호는 결과로 확인)
    simulate(walk, 240);
    const eye = eyePos(rig);
    expect(eye.z).toBeGreaterThan(-1.9); // 벽은 여전히 관통 안 함
    expect(Math.abs(eye.x)).toBeGreaterThan(2); // 접선(X)으로 계속 미끄러져 진행
    walk.exit();
  });

  it('바닥/램프(법선 위)는 충돌 아님 — 위를 걷는다', () => {
    // 발밑 큰 바닥판 (y=0 근처) — 전진을 막으면 안 됨
    const floor = wallMesh(40, 0.2, 40, 0, -0.1, 0);
    const { rig, walk } = makeWalk([floor]);
    walk.enter();
    walk.setJoystick(0, 1);
    simulate(walk, 120); // 2초
    expect(Math.abs(eyePos(rig).z)).toBeGreaterThan(2); // 자유 전진 (바닥이 벽으로 오인되지 않음)
    walk.exit();
  });

  it('클립으로 잘린 벽은 충돌 없음(화면에 없음 = 통과), 클립 밖 벽은 충돌', () => {
    const wall = wallMesh(10, 4, 0.2, 0, 2, -2);
    // 클립 평면: y<3 잘림(normal +y, 상수 -3 → distanceToPoint(p)=p.y-3, 벽 히트점 y≈1.6-2.5 → 음수=잘림)
    const clipAll = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -3)];
    const a = makeWalk([wall], clipAll);
    a.walk.enter();
    a.walk.setJoystick(0, 1);
    simulate(a.walk, 240);
    expect(eyePos(a.rig).z).toBeLessThan(-3); // 잘린 벽 통과
    a.walk.exit();

    const keepAll = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 3)]; // 전부 보임
    const b = makeWalk([wall], keepAll);
    b.walk.enter();
    b.walk.setJoystick(0, 1);
    simulate(b.walk, 240);
    expect(eyePos(b.rig).z).toBeGreaterThan(-1.9); // 정상 충돌
    b.walk.exit();
  });

  it('지면 스냅 클립 필터 — 잘린 슬래브에 착지하지 않음', () => {
    // 슬래브 위 3m에서 시작해 이동 → 스냅이 슬래브(y=3)로 붙는 게 기본
    const slab = wallMesh(40, 0.2, 40, 0, 3, 0);
    const clips = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -10)]; // 전부 잘림
    const { rig, walk } = makeWalk([slab], clips);
    walk.enter(); // levelElevationM=0 → eye 1.6에서 시작 (슬래브 아래)
    walk.setJoystick(0, 1);
    simulate(walk, 120);
    // 잘린 슬래브가 착지 대상이면 eye.y가 3+1.6으로 점프했을 것 — 클립 필터로 현 높이 유지
    expect(eyePos(rig).y).toBeLessThan(2.5);
    walk.exit();
  });

  it('글랜싱 각도(85°) 벽 비비기 — 수직 클리어런스 유지 + 관통 없음 (리뷰 실증 케이스)', () => {
    // 벽면 x=-0.2(두께 0.4 벽의 +x면이 x=0... 박스 중심 x=-0.4, 폭 0.4 → +x면 = -0.2)
    const wall = wallMesh(0.4, 4, 40, -0.4, 2, 0);
    const { rig, walk } = makeWalk([wall]);
    walk.enter(); // (0, 1.6, 0), -Z 바라봄. 벽면까지 수직거리 0.2
    walk.setJoystick(-0.97, 0.24); // 전진+강한 좌측(-x쪽) = 벽으로 글랜싱 압박
    simulate(walk, 300); // 5초 비비기
    const eye = eyePos(rig);
    // 구현이 레이 방향 차감이면 클리어런스가 R·cosθ≈3cm로 붕괴 + 0.08 탈출구 오발 → 관통(x<-0.2)
    expect(eye.x).toBeGreaterThan(-0.2); // 관통 없음
    expect(-0.2 - eye.x < 0 && eye.x - -0.2 >= 0.3).toBe(true); // 수직 클리어런스 ≈R 유지(≥0.3)
    walk.exit();
  });

  it('DoubleSide 메시 내부 시작 = 데드락 없이 걸어나옴 (내부 백페이스 비차단)', () => {
    // 0.5m 기둥(DoubleSide) 중심에서 시작 — 4면 모두 0.25m = 구현이 백페이스를 차단하면 전방위 고착
    const col = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 4, 0.5),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    col.position.set(0, 2, 0);
    col.updateMatrixWorld(true);
    const { rig, walk } = makeWalk([col]);
    walk.enter(); // 기둥 중심 (0,1.6,0)
    walk.setJoystick(0, 1); // 전진(-Z)
    simulate(walk, 240);
    expect(Math.abs(eyePos(rig).z)).toBeGreaterThan(1); // 탈출 성공 (데드락이면 ≈0)
    walk.exit();
  });

  it('낭떠러지/보이드 = 현 높이 유지 (추락 없음 — 의도된 v1.1 정책)', () => {
    const { rig, walk } = makeWalk([]); // 바닥 없음
    walk.enter();
    const y0 = eyePos(rig).y;
    walk.setJoystick(0, 1);
    simulate(walk, 120);
    expect(eyePos(rig).y).toBeCloseTo(y0, 6);
    walk.exit();
  });
});

describe('walkDeltaWorld — 충돌 검사용 월드 변위 기저', () => {
  it('walkMove와 동일 기저 (전진 1m = yaw 방향 1m)', () => {
    const rig = new CameraRig(1280 / 800);
    rig.setPose({ target: [0, 0, 0], distance: 20, theta: 0.7, phi: 1.2 });
    rig.enterWalk(EYE);
    const d = rig.walkDeltaWorld(1, 0, new THREE.Vector3());
    const before = new THREE.Vector3();
    rig.getWalkEye(before);
    rig.walkMove(1, 0, 0);
    const after = new THREE.Vector3();
    rig.getWalkEye(after);
    expect(after.x - before.x).toBeCloseTo(d.x, 9);
    expect(after.z - before.z).toBeCloseTo(d.z, 9);
    expect(d.y).toBe(0);
  });
});
