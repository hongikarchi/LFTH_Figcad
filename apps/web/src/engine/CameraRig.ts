import * as THREE from 'three';

export type ViewMode = '3d' | 'plan';

const TWEEN_DURATION = 0.3; // seconds
const MIN_DISTANCE = 1;
const MAX_DISTANCE = 5000; // 대형 모델(경기장 ~100m·import 매스) 전체맞춤 허용 (구 200 = 95m 건물 못 담음)
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
  private savedTheta = Math.PI / 4; // 평면=북향 스냅, 3D 복귀 시 방위 복원

  constructor(aspect: number) {
    this.persp = new THREE.PerspectiveCamera(55, aspect, 0.1, 50000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50000);
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

  /** 방위를 북향으로 스냅 (theta=π → 화면 위=문서 +y 북) — AI 스케치는 북향 평면에서. */
  setNorthUp(): void {
    this.theta = Math.PI;
    this.apply();
  }

  setMode(mode: ViewMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.tweenT = 0;
    this.phiFrom = this.phi;
    if (mode === 'plan') {
      this.savedPhi = this.phi;
      this.phiTo = MIN_PHI;
      // 평면 진입 = 북향 스냅(화면 위=북, 동=오른쪽 = CAD 표준 평면도). 3D 각도(theta)는 저장해 복귀 시 복원.
      this.savedTheta = this.theta;
      this.theta = Math.PI;
    } else {
      this.phiTo = this.savedPhi;
      this.theta = this.savedTheta;
    }
  }

  /** Engine ticker — 완료 프레임도 true 반환 (마지막 프레임 + 카메라 스왑이 렌더되도록) */
  tick(dt: number): boolean {
    if (this.tweenT >= 1) return false;
    this.tweenT = Math.min(this.tweenT + dt / TWEEN_DURATION, 1);
    const e = 1 - Math.pow(1 - this.tweenT, 3); // ease-out cubic
    this.phi = this.phiFrom + (this.phiTo - this.phiFrom) * e;
    this.apply();
    return true;
  }

  /**
   * 북(문서 +y = 월드 +Z)이 화면에서 향하는 각도(rad, 화면좌표 atan2(dy,dx), y는 아래로 +).
   * 방위표(읽기전용)용 — 타깃과 타깃+북 한 점을 투영해 화면 방향 산출(plan X-반사·3D 회전 모두 일반).
   */
  northScreenAngle(): number {
    const cam = this.active;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const p0 = this.target.clone().project(cam);
    const pN = this.target.clone().add(new THREE.Vector3(0, 0, 1)).project(cam);
    const dx = (pN.x - p0.x) * W;
    const dy = -(pN.y - p0.y) * H; // NDC y(위로+) → 화면 y(아래로+)
    return Math.atan2(dy, dx);
  }

  /** 화면 1px당 월드 m (타깃 깊이 기준) — 스냅 톨러런스/팬 환산용 */
  worldPerPixel(): number {
    if (this.mode === 'plan' && this.tweenT >= 1) {
      return this.distance / window.innerHeight; // ortho: 화면 높이 = distance
    }
    return (2 * Math.tan(((55 / 2) * Math.PI) / 180) * this.distance) / window.innerHeight;
  }

  /**
   * Rhino RMB 의미론: 원근 뷰 = 타깃 중심 회전, 평행(평면) 뷰 = 팬.
   * (docs.mcneel.com rotateview / navigatingviewports)
   */
  orbit(dx: number, dy: number): void {
    if (this.mode === 'plan') {
      this.pan(dx, dy);
      return;
    }
    this.rotate(dx, dy);
  }

  /**
   * 강제 회전 — Rhino Ctrl+Shift+RMB (평행 뷰 회전).
   * 평면 모드에선 수직축(theta)만 — 뷰가 탑뷰에서 벗어나지 않게.
   */
  rotate(dx: number, dy: number): void {
    this.theta -= dx * 0.005;
    if (this.mode !== 'plan') {
      this.phi = THREE.MathUtils.clamp(this.phi - dy * 0.005, MIN_PHI, MAX_PHI);
    }
    this.apply();
  }

  /** Rhino Ctrl+RMB 줌 드래그 — 위로 = 줌인, 아래로 = 줌아웃 */
  zoomDrag(dy: number): void {
    this.zoom(Math.exp(dy * 0.004));
  }

  pan(dx: number, dy: number): void {
    // 카메라 기저에서 유도: right=(cos,0,-sin), 화면상향 u는 모드별 (리뷰 검증 공식).
    // 콘텐츠가 커서를 정확히 따라오도록 worldPerPixel 사용.
    const scale = this.worldPerPixel();
    const sin = Math.sin(this.theta);
    const cos = Math.cos(this.theta);
    if (this.mode === 'plan') {
      // plan ortho는 X 반사(동=오른쪽 CAD표준)라 화면 가로 드래그가 월드와 좌우 반대 → dx 부호 반전.
      const pdx = -dx;
      this.target.x -= (pdx * cos + dy * sin) * scale;
      this.target.z += (pdx * sin - dy * cos) * scale;
    } else {
      const cosPhi = Math.cos(this.phi);
      const sinPhi = Math.sin(this.phi);
      this.target.x -= (dx * cos + dy * sin * cosPhi) * scale;
      this.target.z += (dx * sin - dy * cos * cosPhi) * scale;
      this.target.y += dy * sinPhi * scale;
    }
    this.apply();
  }

  zoom(factor: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance * factor, MIN_DISTANCE, MAX_DISTANCE);
    this.updateFrustum(window.innerWidth / window.innerHeight);
    this.apply();
  }

  /** 타깃을 월드 좌표(m)로 이동 — 요소 점프용. 각도·거리는 유지 */
  focusOn(x: number, y: number, z: number): void {
    this.target.set(x, y, z);
    this.apply();
  }

  /**
   * 바운딩 박스(월드 m) 전체가 화면에 들어오게 타깃·거리 맞춤 (줌 익스텐트).
   * import/federation 모델은 원점서 멀거나 크다 — 이게 없으면 빈 화면. fov 기반 거리 산출.
   */
  fitBounds(min: THREE.Vector3, max: THREE.Vector3): void {
    if (!isFinite(min.x) || !isFinite(max.x) || max.x < min.x) return;
    this.target.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    const radius = Math.max(max.x - min.x, max.y - min.y, max.z - min.z) * 0.5 || 1;
    const fov = (this.persp.fov * Math.PI) / 180;
    const dist = (radius / Math.sin(fov / 2)) * 1.15; // 여유 15%
    this.distance = THREE.MathUtils.clamp(dist, MIN_DISTANCE, MAX_DISTANCE);
    this.updateFrustum(window.innerWidth / window.innerHeight);
    this.apply();
  }

  private updateFrustum(aspect: number): void {
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();
    const half = this.distance * 0.5;
    // 평면(plan) 직교뷰 X 반사 — 동(+X)=화면 오른쪽·북(+Z)=위 = CAD/지도 표준 방위.
    // (북=+Z·Y-up·위에서 -Y로 내려봄 = 수평면이 left-handed → 반사 없이는 동右+북上 불가.)
    // left/right 부호 스왑 = 프로젝션 X 음수 스케일. 지오·픽킹은 동일 카메라라 일관. 단 스프라이트
    // 라벨은 셰이더상 quad가 같이 뒤집힘 → SceneManager가 plan 모드서 scale.x 역-flip으로 상쇄.
    this.ortho.left = half * aspect;
    this.ortho.right = -half * aspect;
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
