import * as THREE from 'three';

export type ViewMode = '3d' | 'plan';

const TWEEN_DURATION = 0.3; // seconds
const MIN_DISTANCE = 1;
const MAX_DISTANCE = 200;
const MIN_PHI = 0.05;
const MAX_PHI = Math.PI / 2 - 0.02;

/**
 * 하나의 타깃/거리 상태 위에 3D(원근 궤도)와 평면(상부 직교) 두 카메라를 올린 리그.
 * 평면 모드는 별도 씬이 아니라 카메라 상태일 뿐 — post-MVP 도면 생성이 꽂힐 자리.
 * 렌더 월드 단위: 미터 (문서는 mm, 변환은 렌더 경계에서).
 */
export class CameraRig {
  mode: ViewMode = '3d';

  private persp: THREE.PerspectiveCamera;
  private ortho: THREE.OrthographicCamera;

  private target = new THREE.Vector3(0, 0, 0);
  private distance = 25;
  private theta = Math.PI / 4; // 방위각
  private phi = Math.PI / 4.5; // 극각 (0 = 바로 위)

  // 모드 전환 트윈: phi를 0으로/원래대로 보간
  private tweenT = 1;
  private phiFrom = 0;
  private phiTo = 0;
  private savedPhi = Math.PI / 4.5; // 평면 진입 시 복원용

  constructor(aspect: number) {
    this.persp = new THREE.PerspectiveCamera(55, aspect, 0.1, 2000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    this.updateFrustum(aspect);
    this.apply();
    window.addEventListener('resize', () =>
      this.updateFrustum(window.innerWidth / window.innerHeight),
    );
  }

  /** 화면 스케일 환산용 (px → 월드) */
  get viewDistance(): number {
    return this.distance;
  }

  get active(): THREE.Camera {
    // 트윈 중에는 원근 카메라로 내려다보다가 완료 시 직교로 스냅
    if (this.mode === 'plan' && this.tweenT >= 1) return this.ortho;
    return this.persp;
  }

  toggleMode(): ViewMode {
    this.setMode(this.mode === '3d' ? 'plan' : '3d');
    return this.mode;
  }

  setMode(mode: ViewMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.tweenT = 0;
    this.phiFrom = this.phi;
    if (mode === 'plan') {
      this.savedPhi = this.phi;
      this.phiTo = MIN_PHI;
    } else {
      this.phiTo = this.savedPhi;
    }
  }

  /** Engine ticker — 트윈 진행 중이면 true */
  tick(dt: number): boolean {
    if (this.tweenT >= 1) return false;
    this.tweenT = Math.min(this.tweenT + dt / TWEEN_DURATION, 1);
    const e = 1 - Math.pow(1 - this.tweenT, 3); // ease-out cubic
    this.phi = this.phiFrom + (this.phiTo - this.phiFrom) * e;
    this.apply();
    return this.tweenT < 1;
  }

  orbit(dx: number, dy: number): void {
    if (this.mode === 'plan') {
      this.pan(dx, dy);
      return;
    }
    this.theta -= dx * 0.005;
    this.phi = THREE.MathUtils.clamp(this.phi - dy * 0.005, MIN_PHI, MAX_PHI);
    this.apply();
  }

  pan(dx: number, dy: number): void {
    // 화면 픽셀 → 월드 이동량 (현재 거리 기준)
    const scale = this.distance / window.innerHeight;
    const sin = Math.sin(this.theta);
    const cos = Math.cos(this.theta);
    if (this.mode === 'plan') {
      this.target.x -= (dx * cos - dy * sin) * scale * 2;
      this.target.z -= (dx * sin + dy * cos) * scale * 2;
    } else {
      // 카메라 우측/상향 벡터 기준 (지면 평면 위에서)
      this.target.x -= (dx * cos) * scale * 2;
      this.target.z -= (dx * sin) * scale * 2;
      this.target.x += dy * sin * Math.cos(this.phi) * scale * 2;
      this.target.z -= dy * cos * Math.cos(this.phi) * scale * -2;
      this.target.y += dy * Math.sin(this.phi) * scale * 2;
    }
    this.apply();
  }

  zoom(factor: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance * factor, MIN_DISTANCE, MAX_DISTANCE);
    this.updateFrustum(window.innerWidth / window.innerHeight);
    this.apply();
  }

  private updateFrustum(aspect: number): void {
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();
    const half = this.distance * 0.5;
    this.ortho.left = -half * aspect;
    this.ortho.right = half * aspect;
    this.ortho.top = half;
    this.ortho.bottom = -half;
    this.ortho.updateProjectionMatrix();
  }

  private apply(): void {
    const sinPhi = Math.sin(this.phi);
    this.persp.position.set(
      this.target.x + this.distance * sinPhi * Math.sin(this.theta),
      this.target.y + this.distance * Math.cos(this.phi),
      this.target.z + this.distance * sinPhi * Math.cos(this.theta),
    );
    this.persp.lookAt(this.target);

    this.ortho.position.set(this.target.x, this.target.y + this.distance, this.target.z);
    // 직교 카메라의 화면 위쪽 = 평면도 북쪽: theta 유지해 회전 일관성 확보
    this.ortho.up.set(Math.sin(this.theta), 0, Math.cos(this.theta)).negate();
    this.ortho.lookAt(this.target);
  }
}
