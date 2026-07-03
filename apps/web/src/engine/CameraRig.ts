import * as THREE from 'three';

export type ViewMode = '3d' | 'plan';
/** 뷰 기즈모 프리셋(항목8a) — top=평면(직교 탑다운), 나머지=3D 표준 방위. */
export type ViewPreset = 'top' | 'front' | 'back' | 'left' | 'right' | 'iso';

/** 카메라 궤도 포즈 — 뷰포인트(저장 단면) 캡처/복원용. 렌더 m·rad (뷰 메타데이터라 mm-정수 불요). */
export interface CameraPose {
  target: [number, number, number]; // 월드 m
  distance: number; // m
  theta: number; // 방위각 rad
  phi: number; // 극각 rad
}

const TWEEN_DURATION = 0.3; // seconds
const MIN_DISTANCE = 1;
const MAX_DISTANCE = 5000; // 대형 모델(경기장 ~100m·import 매스) 전체맞춤 허용 (구 200 = 95m 건물 못 담음)
const MIN_PHI = 0.05;
const MAX_PHI = Math.PI / 2 - 0.02;
const DEFAULT_FOV = 55; // 수직 fov° — 걷기(렌즈) 종료 시 복원 기준
const MAX_WALK_PITCH = 1.54; // ±88° — 걷기 자유 시선(오빗 phi 클램프 미적용)
const WALK_WPP_DIST = 10; // 걷기 중 worldPerPixel 기준 깊이(m) — 탭 도구 스냅 톨러런스용 실내 스케일
const WALK_EXIT_MAX_DIST = 50; // 걷기→오빗 역산 시 타깃 거리 상한(m) — 원거리 피벗 방지

/** 35mm 환산 초점거리(mm) → 수직 fov° (센서 높이 24mm: fov = 2·atan(12/f)). 55° ≡ 23.05mm. */
export function lensMmToFovDeg(mm: number): number {
  return (2 * Math.atan(12 / mm) * 180) / Math.PI;
}

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

  // 걷기(1인칭) 상태 — mode('3d'|'plan')와 직교하는 플래그. 3d에서만 켜지고 active는 계속 persp
  // 반환 → rig.active 소비자(Picker·HUD·presence) 무변경. apply()가 walk 분기라 걷기 중 오빗
  // 뮤테이터 오호출은 시각적 no-op(내장 안전성).
  private walking = false;
  private walkPos = new THREE.Vector3();
  private walkYaw = 0; // 방위(rad) — forward=(sinYaw, 0, cosYaw)
  private walkPitch = 0; // ±MAX_WALK_PITCH — 오빗 phi 클램프와 별개 자유 시선
  private _fwd = new THREE.Vector3(); // 프레임 루프 할당 0 — apply/북향 계산 스크래치
  private _look = new THREE.Vector3();

  constructor(aspect: number) {
    this.persp = new THREE.PerspectiveCamera(DEFAULT_FOV, aspect, 0.1, 50000);
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

  /**
   * 뷰 기즈모 프리셋으로 전환(항목8a). top = 평면(직교 탑다운, 기존 트윈 경로).
   * 나머지 = 3D 원근을 표준 방위로 스냅 — front=남쪽서 북(+Z) 봄, right=동쪽서 봄, iso=기본 등각.
   * (true 직교 elevation은 8b — 지금은 원근 프리셋으로 인식 가능한 뷰 제공, ortho 탑다운락 리팩터 회피.)
   * 호출측(main)이 uiStore.viewMode를 rig.mode에 동기화(setViewContext·flip 트리거).
   */
  setView(preset: ViewPreset): void {
    if (preset === 'top') {
      this.setMode('plan'); // 기존 평면 경로(직교 탑다운 + 북향 + 트윈)
      return;
    }
    // φ=π/2 = 수평 시선(elevation), θ = 방위. iso만 기본 등각. apply()가 pos = target + dist·(sinφsinθ, cosφ, sinφcosθ).
    const H = Math.PI / 2;
    const A: Record<Exclude<ViewPreset, 'top'>, { theta: number; phi: number }> = {
      front: { theta: Math.PI, phi: H }, // 남쪽서 북(+Z) 바라봄 = 북측 입면
      back: { theta: 0, phi: H }, // 북쪽서 남 바라봄
      right: { theta: Math.PI / 2, phi: H }, // 동쪽서 서 바라봄 = 동측 입면
      left: { theta: -Math.PI / 2, phi: H }, // 서쪽서 동 바라봄
      iso: { theta: Math.PI / 4, phi: Math.PI / 4.5 }, // 기본 등각
    };
    const a = A[preset];
    this.mode = '3d';
    this.tweenT = 1; // 스냅(트윈 없음 — 프리셋은 즉시 전환)
    this.theta = a.theta;
    this.phi = a.phi;
    this.savedPhi = a.phi;
    this.savedTheta = a.theta;
    this.updateFrustum(window.innerWidth / window.innerHeight);
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
    // 걷기 중엔 스테일 오빗 타깃이 카메라 뒤일 수 있음(방위 반전) → 시선 전방 5m 기준점 사용.
    const ref = this.walking
      ? this._look.copy(this.walkPos).add(this.walkForward(this._fwd).multiplyScalar(5))
      : this.target;
    const p0 = ref.clone().project(cam);
    const pN = ref.clone().add(new THREE.Vector3(0, 0, 1)).project(cam);
    const dx = (pN.x - p0.x) * W;
    const dy = -(pN.y - p0.y) * H; // NDC y(위로+) → 화면 y(아래로+)
    return Math.atan2(dy, dx);
  }

  /** 화면 1px당 월드 m (타깃 깊이 기준) — 스냅 톨러런스/팬 환산용. 걷기 중엔 고정 10m 기준(실내 스케일). */
  worldPerPixel(): number {
    if (this.mode === 'plan' && this.tweenT >= 1) {
      return this.distance / window.innerHeight; // ortho: 화면 높이 = distance
    }
    const depth = this.walking ? WALK_WPP_DIST : this.distance;
    return (2 * Math.tan(((this.persp.fov / 2) * Math.PI) / 180) * depth) / window.innerHeight;
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
   * 오빗 피벗 변경 — target을 world로 옮기되 **카메라 위치는 고정**(화면 점프 없음).
   * 현재 카메라 위치에서 새 target까지의 오프셋으로 distance/theta/phi를 역산해 apply가
   * 같은 위치를 재구성. (focusOn은 각도·거리 유지·target 점프 = 반대 용도.) 3D(원근)에서만 의미.
   * apply()의 pos = target + distance*(sinPhi·sinθ, cosPhi, sinPhi·cosθ) 역함수.
   */
  setPivot(x: number, y: number, z: number): void {
    if (this.mode !== '3d') return;
    const ox = this.persp.position.x - x;
    const oy = this.persp.position.y - y;
    const oz = this.persp.position.z - z;
    const dist = Math.hypot(ox, oy, oz);
    if (dist < MIN_DISTANCE || dist > MAX_DISTANCE) return; // 역산 불안정/범위 밖 — 피벗 유지
    const phiRaw = Math.acos(THREE.MathUtils.clamp(oy / dist, -1, 1));
    // 역산 포즈가 클램프를 요구하면(피벗이 카메라 눈높이보다 위 = phi>MAX_PHI 등) 위치 보존이
    // 불가능 — 클램프 강행 = apply()가 카메라를 다른 위치로 재구성 = RMB 순간 화면 튐(사용자 보고).
    // 이 경우 피벗 변경을 포기하고 이전 피벗으로 오빗(점프 없음이 우선).
    if (phiRaw < MIN_PHI || phiRaw > MAX_PHI) return;
    this.target.set(x, y, z);
    this.distance = dist;
    this.phi = phiRaw;
    this.theta = Math.atan2(ox, oz);
    this.apply();
  }

  // ---- 걷기(1인칭) — 리뷰 walk mode ----

  get isWalking(): boolean {
    return this.walking;
  }

  /** 수직 fov° 설정 (렌즈) — 걷기 진입/렌즈 슬라이더용. 종료 시 DEFAULT_FOV 복원은 호출측. */
  setFov(deg: number): void {
    this.persp.fov = THREE.MathUtils.clamp(deg, 10, 120);
    this.persp.updateProjectionMatrix();
  }

  resetFov(): void {
    this.setFov(DEFAULT_FOV);
  }

  /** 걷기 시선 방향 (단위벡터, out에 기록) */
  private walkForward(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.walkPitch);
    return out.set(Math.sin(this.walkYaw) * cp, Math.sin(this.walkPitch), Math.cos(this.walkYaw) * cp);
  }

  /**
   * 걷기 진입 — 오빗 타깃 지점에 착지(카메라 위치 기준이면 fit 후 수백 m 표류),
   * eyeY = 레벨고도 + 눈높이(호출측 계산). 시선은 오빗의 수평 방위 유지(theta+π = 카메라→타깃 방향), 수평 피치.
   */
  enterWalk(eyeY: number): void {
    this.walkPos.set(this.target.x, eyeY, this.target.z);
    this.walkYaw = this.theta + Math.PI;
    this.walkPitch = 0;
    this.walking = true;
    this.tweenT = 1; // 진행 중 모드 트윈 킬
    this.apply();
  }

  /**
   * 걷기 종료 — setPivot 역산 패턴: 현재 눈 위치·시선에서 오빗 포즈 재구성(카메라 점프 없음).
   * 위쪽 시선은 phi 클램프로 근사 스냅 허용. 원거리 피벗(D=50 상한)은 다음 RMB resolvePivot이 자가 치유.
   */
  exitWalk(): void {
    const p = this.walkToOrbit();
    this.walking = false;
    this.target.set(p.target[0], p.target[1], p.target[2]);
    this.distance = p.distance;
    this.theta = p.theta;
    this.phi = p.phi;
    this.savedPhi = this.phi;
    this.savedTheta = this.theta;
    this.updateFrustum(window.innerWidth / window.innerHeight);
    this.apply();
  }

  /** 걷기 시선 회전 — 오빗 rotate와 동일 감도, pitch는 ±88° 자유(phi 클램프 미적용) */
  walkLook(dxPx: number, dyPx: number): void {
    this.walkYaw -= dxPx * 0.005;
    this.walkPitch = THREE.MathUtils.clamp(this.walkPitch - dyPx * 0.005, -MAX_WALK_PITCH, MAX_WALK_PITCH);
    this.apply();
  }

  /** 걷기 이동 — yaw 수평 기저(Enscape 보행 의미론: 시선 pitch 무관 수평 전후) + 수직(dUp) */
  walkMove(dForward: number, dRight: number, dUp: number): void {
    const sin = Math.sin(this.walkYaw);
    const cos = Math.cos(this.walkYaw);
    this.walkPos.x += dForward * sin - dRight * cos;
    this.walkPos.z += dForward * cos + dRight * sin;
    this.walkPos.y += dUp;
    this.apply();
  }

  /** 걷기 눈 위치 (지면 스냅 레이 원점용, out에 기록) */
  getWalkEye(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.walkPos);
  }

  /** 지면 스냅 — 눈높이 y만 직접 설정 */
  setWalkY(y: number): void {
    this.walkPos.y = y;
    this.apply();
  }

  /**
   * 걷기 포즈 → 오빗 포즈 합성 (exitWalk·걷기 중 getPose 공유).
   * phi를 먼저 클램프하고 그 클램프된 각도의 역방향으로 target을 역산 — apply()가 카메라 위치를
   * **정확히** walkPos로 재구성(수평 시선 phi=π/2 > MAX_PHI 클램프 시에도 위치 점프 0, 시선만 ≤1.15° 하향).
   */
  private walkToOrbit(): CameraPose {
    const dir = this.walkForward(this._fwd);
    const D = THREE.MathUtils.clamp(this.distance, MIN_DISTANCE, WALK_EXIT_MAX_DIST);
    const phi = THREE.MathUtils.clamp(Math.acos(THREE.MathUtils.clamp(-dir.y, -1, 1)), MIN_PHI, MAX_PHI);
    const theta = Math.atan2(-dir.x, -dir.z);
    // apply(): pos = target + D·u, u = (sinφsinθ, cosφ, sinφcosθ) → target = walkPos − D·u
    const sinPhi = Math.sin(phi);
    return {
      target: [
        this.walkPos.x - D * sinPhi * Math.sin(theta),
        this.walkPos.y - D * Math.cos(phi),
        this.walkPos.z - D * sinPhi * Math.cos(theta),
      ],
      distance: D,
      phi,
      theta,
    };
  }

  /** 현재 궤도 포즈 캡처 (뷰포인트 저장용). mode는 uiStore.viewMode가 별도 소유. 걷기 중엔 오빗 포즈 합성. */
  getPose(): CameraPose {
    if (this.walking) return this.walkToOrbit();
    return { target: [this.target.x, this.target.y, this.target.z], distance: this.distance, theta: this.theta, phi: this.phi };
  }

  /**
   * 궤도 포즈 복원 (뷰포인트 점프 — 스냅, 트윈 없음). mode 전환은 호출측이 uiStore.setViewMode로 별도 처리.
   * updateFrustum까지 = ortho도 즉시 정합.
   */
  setPose(p: CameraPose): void {
    this.target.set(p.target[0], p.target[1], p.target[2]);
    this.distance = THREE.MathUtils.clamp(p.distance, MIN_DISTANCE, MAX_DISTANCE);
    this.theta = p.theta;
    this.phi = THREE.MathUtils.clamp(p.phi, MIN_PHI, MAX_PHI);
    this.tweenT = 1; // 트윈 중단 = 즉시 스냅
    this.savedPhi = this.phi;
    this.savedTheta = this.theta;
    this.updateFrustum(window.innerWidth / window.innerHeight);
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
    if (this.walking) {
      // 걷기: 위치 = walkPos, 시선 = yaw/pitch (오빗 phi 클램프 미적용). ortho 무접촉(walk는 3d 전용).
      this.persp.position.copy(this.walkPos);
      this.persp.lookAt(this._look.copy(this.walkPos).add(this.walkForward(this._fwd)));
      return;
    }
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
