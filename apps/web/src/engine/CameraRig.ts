import * as THREE from 'three';

export type ViewMode = '3d' | 'plan';
/** 뷰 기즈모 프리셋 — top=평면(직교 탑다운), 입면 4방향+bottom=true ortho(8b), iso=원근. */
export type ViewPreset = 'top' | 'front' | 'back' | 'left' | 'right' | 'iso' | 'bottom';

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
// full-sphere 오빗(A-S4) — 극점 특이점만 회피. (구 π/2−0.02 = 아래서 올려다보기 불가 +
// 입면 φ=π/2가 클램프 밖이라 오빗 시 시선 튐 + 입면 뷰포인트 복원 미세 틀어짐)
const MAX_PHI = Math.PI - 0.05;
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
  /**
   * mode·walking과 직교하는 세 번째 축(A-S1) — 3d에서 ortho면 입면/저면 true 직교.
   * plan의 직교는 이 축과 무관한 기존 경로(탑다운+X반사). 모드 전환·걷기 진입·setPose는
   * persp로 리셋(뷰포인트 페이로드에 projection 미저장 — 구빌드 롤아웃 안전).
   */
  private projection: 'persp' | 'ortho' = 'persp';

  private persp: THREE.PerspectiveCamera;
  private ortho: THREE.OrthographicCamera;

  private target = new THREE.Vector3(0, 0, 0);
  private distance = 25;
  private theta = Math.PI / 4; // 방위각
  private phi = Math.PI / 4.5; // 극각 (0 = 바로 위)

  // 포즈 트윈(A-S3) — 모드 전환(φ·θ)과 프리셋/뷰포인트 점프({θ 최단호, φ, distance, target})를
  // 단일 구조로. forceComplete = 입력 개입 시에도 끝값 스냅(plan 탑다운 필수 — 미완 φ로 멈추면
  // 평면 의미론 파손), swapToOrtho = 완료 시 projection='ortho'(Auto Perspective — 트윈은 persp로
  // 날아가고 도착 순간 직교 스왑, plan 진입 :79 패턴과 동일).
  private tween: {
    t: number;
    fromTheta: number; fromPhi: number; fromDist: number; fromTarget: THREE.Vector3;
    toTheta: number; toPhi: number; toDist: number; toTarget: THREE.Vector3;
    forceComplete: boolean;
    swapToOrtho: boolean;
  } | null = null;
  private autoOrtho = false; // Auto Perspective 추적 — 축뷰 프리셋이 켠 ortho(수동 토글과 구분)
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
  private _lastNorthAngle = -Math.PI / 2; // 방위표 퇴화 가드용(초기=북이 화면 위)

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
    if (this.mode === 'plan' && this.tween === null) return this.ortho;
    // 입면/저면 true ortho(A-S1) — 걷기는 항상 원근
    if (this.mode === '3d' && this.projection === 'ortho' && !this.walking) return this.ortho;
    return this.persp;
  }

  /** 현재 활성 카메라가 직교인가 (기즈모 persp/ortho 토글·스모크 단언용) */
  get isOrtho(): boolean {
    return (this.active as THREE.Camera & { isOrthographicCamera?: boolean }).isOrthographicCamera === true;
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
   * 뷰 기즈모 프리셋으로 전환. top = 평면(직교 탑다운, 기존 트윈 경로).
   * 입면 4방향 + bottom = **true ortho**(8b) — 원근 왜곡 없는 입면/저면. iso = 원근 등각.
   * front=남쪽서 북(+Z) 봄 → 보이는 면 = 남측 입면 (라벨 관례 = 보이는 면 기준, §C 결정1).
   * 호출측(main)이 uiStore.viewMode를 rig.mode에 동기화(setViewContext·flip 트리거).
   */
  setView(preset: ViewPreset): void {
    if (preset === 'top') {
      this.projection = 'persp'; // plan의 직교는 별도 경로 — 입면 ortho 상태 잔존 방지
      this.setMode('plan'); // 기존 평면 경로(직교 탑다운 + 북향 + 트윈)
      return;
    }
    // φ=π/2 = 수평 시선(elevation), θ = 방위. apply()가 pos = target + dist·(sinφsinθ, cosφ, sinφcosθ).
    const H = Math.PI / 2;
    const A: Record<Exclude<ViewPreset, 'top'>, { theta: number; phi: number }> = {
      front: { theta: Math.PI, phi: H }, // 남쪽서 북(+Z) 바라봄 = 남측 입면
      back: { theta: 0, phi: H }, // 북쪽서 남 바라봄 = 북측 입면
      right: { theta: Math.PI / 2, phi: H }, // 동쪽서 서 바라봄 = 동측 입면
      left: { theta: -Math.PI / 2, phi: H }, // 서쪽서 동 바라봄 = 서측 입면
      bottom: { theta: Math.PI, phi: MAX_PHI }, // 아래서 올려다봄(천장·보 하부) — A-S4 full-sphere 의존
      iso: { theta: Math.PI / 4, phi: Math.PI / 4.5 }, // 기본 등각
    };
    const a = A[preset];
    // no-op 가드(리뷰) — 이미 그 축뷰에 정착해 있으면 재클릭이 persp 강등 + X미러 왕복
    // 플래시(0.3s 공회전 트윈)를 만들지 않게 그대로 유지.
    const dT = THREE.MathUtils.euclideanModulo(a.theta - this.theta + Math.PI, Math.PI * 2) - Math.PI;
    const wantOrtho = preset !== 'iso';
    if (
      this.mode === '3d' && !this.tween && !this.walking &&
      Math.abs(dT) < 1e-6 && Math.abs(this.phi - a.phi) < 1e-6 &&
      this.projection === (wantOrtho ? 'ortho' : 'persp')
    ) {
      this.savedPhi = a.phi;
      this.savedTheta = a.theta;
      return;
    }
    const fromPlan = this.mode === 'plan';
    this.mode = '3d';
    this.savedPhi = a.phi;
    this.savedTheta = a.theta;
    if (preset === 'iso') {
      // iso = 원근 즉시 복귀 + 포즈 트윈 (ortho에서 오는 경우 스왑을 트윈 시작에 — 반사 해제가 함께)
      this.projection = 'persp';
      this.autoOrtho = false;
      this.updateFrustum(window.innerWidth / window.innerHeight);
      this.startTween({ target: [this.target.x, this.target.y, this.target.z], distance: this.distance, theta: a.theta, phi: a.phi }, {});
    } else {
      // 축뷰 = Auto Perspective: persp로 최단호 트윈 → 도착 시 ortho 스왑(A3.3).
      // plan에서 오면 X반사 정합이 유지되도록 즉시 3d 프러스텀 재계산 후 트윈.
      this.projection = 'persp';
      this.updateFrustum(window.innerWidth / window.innerHeight);
      this.startTween(
        { target: [this.target.x, this.target.y, this.target.z], distance: this.distance, theta: a.theta, phi: a.phi },
        { swapToOrtho: true },
      );
    }
    if (fromPlan) this.apply(); // plan ortho 잔상 방지 — persp 초기 프레임 정렬
  }

  setMode(mode: ViewMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.projection = 'persp'; // 입면 ortho는 setView 축뷰 전용 — 모드 전환은 원근 복귀
    this.autoOrtho = false;
    if (mode === 'plan') {
      this.savedPhi = this.phi;
      this.savedTheta = this.theta;
      // 평면 진입 = 북향(θ=π) + 탑다운(φ=MIN_PHI)으로 트윈 — 끝값 도달 필수(forceComplete):
      // 미완 φ로 멈추면 plan ortho 스냅(active)이 어긋난 각도로 발생.
      this.startTween(
        { target: [this.target.x, this.target.y, this.target.z], distance: this.distance, theta: Math.PI, phi: MIN_PHI },
        { forceComplete: true },
      );
    } else {
      this.startTween(
        { target: [this.target.x, this.target.y, this.target.z], distance: this.distance, theta: this.savedTheta, phi: this.savedPhi },
        {},
      );
    }
    this.updateFrustum(window.innerWidth / window.innerHeight); // plan X반사 ↔ 표준 방향 즉시 정합
  }

  /** 포즈 트윈 시작 — θ는 최단호(±π 래핑: Left→Right가 한 바퀴 돌지 않게). */
  private startTween(
    to: CameraPose,
    opts: { forceComplete?: boolean; swapToOrtho?: boolean },
  ): void {
    const dTheta = THREE.MathUtils.euclideanModulo(to.theta - this.theta + Math.PI, Math.PI * 2) - Math.PI;
    this.tween = {
      t: 0,
      fromTheta: this.theta,
      fromPhi: this.phi,
      fromDist: this.distance,
      fromTarget: this.target.clone(),
      toTheta: this.theta + dTheta,
      toPhi: to.phi,
      toDist: to.distance,
      toTarget: new THREE.Vector3(to.target[0], to.target[1], to.target[2]),
      forceComplete: opts.forceComplete ?? false,
      swapToOrtho: opts.swapToOrtho ?? false,
    };
  }

  /**
   * 사용자 입력(오빗·팬·줌·피벗)의 트윈 개입 — forceComplete(plan 진입)는 끝값 스냅 후 입력 적용,
   * 그 외(프리셋·뷰포인트 비행)는 현 보간 지점에서 동결(사용자가 조종간을 잡음 = ortho 스왑 취소).
   */
  private interruptTween(): void {
    if (!this.tween) return;
    const tw = this.tween;
    this.tween = null;
    if (tw.forceComplete) {
      this.theta = tw.toTheta;
      this.phi = tw.toPhi;
      this.distance = tw.toDist;
      this.target.copy(tw.toTarget);
      if (tw.swapToOrtho) {
        this.projection = 'ortho';
        this.autoOrtho = true;
      }
    }
    this.updateFrustum(window.innerWidth / window.innerHeight);
  }

  /** Engine ticker — 완료 프레임도 true 반환 (마지막 프레임 + 카메라 스왑이 렌더되도록) */
  tick(dt: number): boolean {
    if (!this.tween) return false;
    const tw = this.tween;
    tw.t = Math.min(tw.t + dt / TWEEN_DURATION, 1);
    const e = 1 - Math.pow(1 - tw.t, 3); // ease-out cubic
    this.theta = tw.fromTheta + (tw.toTheta - tw.fromTheta) * e;
    this.phi = tw.fromPhi + (tw.toPhi - tw.fromPhi) * e;
    this.distance = tw.fromDist + (tw.toDist - tw.fromDist) * e;
    this.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
    if (tw.t >= 1) {
      this.tween = null;
      if (tw.swapToOrtho) {
        this.projection = 'ortho'; // Auto Perspective — 도착 순간 직교 스왑
        this.autoOrtho = true;
      }
      this.updateFrustum(window.innerWidth / window.innerHeight); // 최종 distance·모드 프러스텀 정합
    }
    this.apply();
    return true;
  }

  /**
   * 북(문서 +y = 월드 +Z)이 화면에서 향하는 각도(rad, 화면좌표 atan2(dy,dx), y는 아래로 +).
   * 방위표(읽기전용)용 — 타깃과 타깃+북 한 점을 투영해 화면 방향 산출(plan X-반사·3D 회전 모두 일반).
   */
  northScreenAngle(): number {
    const cam = this.active;
    // project()는 matrixWorldInverse를 갱신 없이 사용 — 렌더러 밖(테스트·apply 직후 렌더 전)
    // 호출 시 1콜 스테일 방지. 렌더러가 프레임마다 하는 일의 멱등 재현(저비용).
    cam.updateMatrixWorld();
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
    // 퇴화 가드 — front/back 입면(ortho)은 북축이 시선과 평행 = Δ가 float 잔차(1e-15px)뿐.
    // atan2(잔차,잔차)는 무의미한 방향이므로 마지막 유효각 유지(방위표가 노이즈로 홱 돌지 않게).
    if (Math.hypot(dx, dy) < 0.5) return this._lastNorthAngle;
    this._lastNorthAngle = Math.atan2(dy, dx);
    return this._lastNorthAngle;
  }

  /** 화면 1px당 월드 m (타깃 깊이 기준) — 스냅 톨러런스/팬 환산용. 걷기 중엔 고정 10m 기준(실내 스케일). */
  worldPerPixel(): number {
    if (this.mode === 'plan' && this.tween === null) {
      return this.distance / window.innerHeight; // ortho: 화면 높이 = distance
    }
    const depth = this.walking ? WALK_WPP_DIST : this.distance;
    return (2 * Math.tan(((this.persp.fov / 2) * Math.PI) / 180) * depth) / window.innerHeight;
  }

  /**
   * Rhino RMB 의미론: 원근 뷰 = 타깃 중심 회전, 평행(평면·입면 ortho) 뷰 = 팬.
   * (docs.mcneel.com rotateview / navigatingviewports)
   */
  orbit(dx: number, dy: number): void {
    this.interruptTween();
    if (this.mode === 'plan' || (this.mode === '3d' && this.projection === 'ortho')) {
      this.pan(dx, dy);
      return;
    }
    this.rotate(dx, dy);
  }

  /**
   * 강제 회전 — Rhino Ctrl+Shift+RMB (평행 뷰 회전) + S2 기즈모 드래그.
   * 평면 모드에선 수직축(theta)만 — 뷰가 탑뷰에서 벗어나지 않게.
   * Auto Perspective(A3.3): 축뷰 프리셋이 켠 ortho(autoOrtho)에서 회전이 들어오면 원근 복귀 —
   * 사용자가 수동 토글로 켠 ortho는 유지(Blender 동일).
   */
  rotate(dx: number, dy: number): void {
    this.interruptTween();
    if (this.mode === '3d' && this.projection === 'ortho' && this.autoOrtho) {
      this.projection = 'persp';
      this.autoOrtho = false;
      this.updateFrustum(window.innerWidth / window.innerHeight);
    }
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
    this.interruptTween();
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
      // 입면 ortho는 X반사 프러스텀(위 updateFrustum) — 화면 가로 드래그가 월드와 좌우 반대 → dx 부호 반전(plan과 동일 이유).
      const ex = this.mode === '3d' && this.projection === 'ortho' ? -dx : dx;
      const cosPhi = Math.cos(this.phi);
      const sinPhi = Math.sin(this.phi);
      this.target.x -= (ex * cos + dy * sin * cosPhi) * scale;
      this.target.z += (ex * sin - dy * cos * cosPhi) * scale;
      this.target.y += dy * sinPhi * scale;
    }
    this.apply();
  }

  zoom(factor: number): void {
    this.interruptTween();
    this.distance = THREE.MathUtils.clamp(this.distance * factor, MIN_DISTANCE, MAX_DISTANCE);
    this.updateFrustum(window.innerWidth / window.innerHeight);
    this.apply();
  }

  /**
   * 수동 persp/ortho 토글 (S2 기즈모 버튼) — autoOrtho 해제 = 이후 회전에도 유지(Blender 수동 토글).
   * plan·걷기 중 무시(각자 고유 투영 소유).
   */
  setProjection(p: 'persp' | 'ortho'): void {
    if (this.mode !== '3d' || this.walking || p === this.projection) return;
    this.interruptTween();
    this.projection = p;
    this.autoOrtho = false;
    this.updateFrustum(window.innerWidth / window.innerHeight);
    this.apply();
  }

  /** 타깃을 월드 좌표(m)로 이동 — 요소 점프용. 각도·거리는 유지 */
  focusOn(x: number, y: number, z: number): void {
    this.interruptTween(); // 점프 명령이 비행 중 트윈에 되돌려지지 않게
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
    // 입면 ortho에선 피벗 회전 자체가 없음(orbit=팬, Rhino 평행 뷰) — theta/phi 재역산이
    // ortho.lookAt 축을 기울여 축정렬 입면을 사선 액소노로 파괴하므로 무조건 무시.
    if (this.mode !== '3d' || this.projection === 'ortho') return;
    this.interruptTween(); // RMB-down = 사용자가 조종간 잡음 — 비행 중이면 현 지점 동결 후 피벗
    const ox = this.persp.position.x - x;
    const oy = this.persp.position.y - y;
    const oz = this.persp.position.z - z;
    const dist = Math.hypot(ox, oy, oz);
    if (dist < MIN_DISTANCE || dist > MAX_DISTANCE) return; // 역산 불안정/범위 밖 — 피벗 유지
    const phiRaw = Math.acos(THREE.MathUtils.clamp(oy / dist, -1, 1));
    // 역산 포즈가 클램프를 요구하면(피벗이 거의 극점 방향 = full-sphere 밖) 위치 보존이
    // 불가능 — 클램프 강행 = apply()가 카메라를 다른 위치로 재구성 = RMB 순간 화면 튐(사용자 보고).
    // 이 경우 피벗 변경을 포기하고 이전 피벗으로 오빗(점프 없음이 우선).
    if (phiRaw < MIN_PHI || phiRaw > MAX_PHI) return;
    this.target.set(x, y, z);
    this.distance = dist;
    this.phi = phiRaw;
    this.theta = Math.atan2(ox, oz);
    this.updateFrustum(window.innerWidth / window.innerHeight); // distance 변화 → ortho 반높이 동기(방어)
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
    this.projection = 'persp'; // 걷기 = 항상 원근 (입면 ortho에서 진입해도)
    this.autoOrtho = false;
    if (this.tween) {
      // 진행 중 트윈은 끝값 채택 후 종료 — 평면→걷기 진입 시 setMode('3d') 복원 트윈이
      // t=0에서 죽으면 3D 방위(savedTheta)가 유실돼 걷기 시선이 북향(plan θ=π)으로 굳는다(리뷰).
      // 단 walkYaw/walkPos는 이 위(θ 기준)에서 이미 계산됐으므로 순서 유의 — 아래서 재계산.
      const tw = this.tween;
      this.theta = tw.toTheta;
      this.phi = tw.toPhi;
      this.distance = tw.toDist;
      this.target.copy(tw.toTarget);
      this.tween = null;
      this.walkPos.set(this.target.x, this.walkPos.y, this.target.z); // eyeY 유지
      this.walkYaw = this.theta + Math.PI;
    }
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
   * **정확히** walkPos로 재구성. full-sphere(S4) 후 수평 시선 π/2는 클램프 내 = 정확 복원,
   * 극단 상방 시선(φ_raw>π−0.05)만 클램프되며 그때도 위치 점프 0.
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
   * 궤도 포즈 복원 (뷰포인트 점프). mode 전환은 호출측이 uiStore.setViewMode로 별도 처리.
   * mode='auto'(§C 결정5 거리 기반 절충): 가까우면(카메라 변위 < 3×뷰 깊이) 부드럽게 비행,
   * 멀면 스냅(장거리 트윈은 어지러움). 기본 'snap' = 기존 호출자 의미 불변.
   */
  setPose(p: CameraPose, mode: 'snap' | 'auto' = 'snap'): void {
    this.projection = 'persp'; // 뷰포인트 페이로드에 projection 없음 — 저장 시점 의미론(원근) 재현
    this.autoOrtho = false;
    const to: CameraPose = {
      target: p.target,
      distance: THREE.MathUtils.clamp(p.distance, MIN_DISTANCE, MAX_DISTANCE),
      theta: p.theta,
      phi: THREE.MathUtils.clamp(p.phi, MIN_PHI, MAX_PHI),
    };
    this.savedPhi = to.phi;
    this.savedTheta = to.theta;
    if (mode === 'auto' && this.mode === '3d' && !this.walking) {
      const camDelta = Math.hypot(
        this.persp.position.x - (to.target[0] + to.distance * Math.sin(to.phi) * Math.sin(to.theta)),
        this.persp.position.y - (to.target[1] + to.distance * Math.cos(to.phi)),
        this.persp.position.z - (to.target[2] + to.distance * Math.sin(to.phi) * Math.cos(to.theta)),
      );
      if (camDelta < Math.max(this.distance, to.distance) * 3) {
        this.updateFrustum(window.innerWidth / window.innerHeight);
        this.startTween(to, {});
        return;
      }
    }
    this.tween = null; // 스냅 = 진행 중 트윈 중단
    this.target.set(to.target[0], to.target[1], to.target[2]);
    this.distance = to.distance;
    this.theta = to.theta;
    this.phi = to.phi;
    this.updateFrustum(window.innerWidth / window.innerHeight);
    this.apply();
  }

  /**
   * 바운딩 박스(월드 m) 전체가 화면에 들어오게 타깃·거리 맞춤 (줌 익스텐트).
   * import/federation 모델은 원점서 멀거나 크다 — 이게 없으면 빈 화면. fov 기반 거리 산출.
   */
  fitBounds(min: THREE.Vector3, max: THREE.Vector3): void {
    if (!isFinite(min.x) || !isFinite(max.x) || max.x < min.x) return;
    this.interruptTween(); // F-fit은 명시 명령 — 비행 중 트윈이 target/distance를 되돌리면 안 됨
    this.target.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    const radius = Math.max(max.x - min.x, max.y - min.y, max.z - min.z) * 0.5 || 1;
    const fov = (this.persp.fov * Math.PI) / 180;
    // 원근 = radius/sin(fov/2) (시야 원뿔), 입면 ortho = radius/tan(fov/2) (가시 반높이 = d·tan(fov/2)).
    // sin 공식을 ortho에 쓰면 실여유율이 1.15/cos(fov/2)≈1.30으로 과줌아웃.
    const elevationOrtho = this.mode === '3d' && this.projection === 'ortho';
    const dist = (radius / (elevationOrtho ? Math.tan(fov / 2) : Math.sin(fov / 2))) * 1.15; // 여유 15%
    this.distance = THREE.MathUtils.clamp(dist, MIN_DISTANCE, MAX_DISTANCE);
    this.updateFrustum(window.innerWidth / window.innerHeight);
    this.apply();
  }

  private updateFrustum(aspect: number): void {
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();
    if (this.mode === 'plan') {
      // 평면(plan) 직교뷰 X 반사 — 동(+X)=화면 오른쪽·북(+Z)=위 = CAD/지도 표준 방위.
      // (북=+Z·Y-up·위에서 -Y로 내려봄 = 수평면이 left-handed → 반사 없이는 동右+북上 불가.)
      // left/right 부호 스왑 = 프로젝션 X 음수 스케일. 지오·픽킹은 동일 카메라라 일관. 단 스프라이트
      // 라벨은 셰이더상 quad가 같이 뒤집힘 → SceneManager.setMirrorComp가 텍스처 U 반전으로 상쇄.
      // 반높이 = distance·0.5는 plan 줌 의미론(화면 높이=distance, worldPerPixel 매핑)과 결착 — 유지.
      const half = this.distance * 0.5;
      this.ortho.left = half * aspect;
      this.ortho.right = -half * aspect;
      this.ortho.top = half;
      this.ortho.bottom = -half;
    } else {
      // 입면/저면 ortho(A-S1) — 반높이 = distance·tan(fov/2)로 원근과 같은 화면 배율
      // (worldPerPixel 3d 공식 그대로 성립). **X반사 적용**: 문서(x동·y북)→월드[x,elev,y] 매핑이
      // 행렬식 −1 반사라, 반사 없인 입면 4방향 전부 동서 거울상(남측 입면서 동쪽이 화면 왼쪽 —
      // 실세계·Rhino Front·자체 plan과 반대). plan과 같은 기법으로 교정 — 스프라이트 상쇄는
      // SceneManager.setMirrorComp, 팬 부호는 pan()의 입면 분기. 저면(bottom)도 일괄 반사 =
      // 반사 천장 평면도(RCP) 관례와 부합. 원근(persp)과 스왑 시 좌우가 뒤집혀 보이는 건
      // 반사 교정의 필연 — S3 트윈 도착 프레임의 1회 미러 팝은 의식적 수용(리뷰 iter2 확인:
      // 상태 손상 없음·연쇄 없음. 마스킹(스왑 크로스페이드/트윈 내 X스케일 보간)은 S2 기즈모와
      // 함께 재평가 — MORNING_SUMMARY 큐).
      const half = this.distance * Math.tan(((this.persp.fov / 2) * Math.PI) / 180);
      this.ortho.left = half * aspect;
      this.ortho.right = -half * aspect;
      this.ortho.top = half;
      this.ortho.bottom = -half;
    }
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

    if (this.mode === 'plan') {
      // plan 탑다운 — 기존 경로 (X반사 프러스텀과 페어)
      this.ortho.position.set(this.target.x, this.target.y + this.distance, this.target.z);
      // 직교 카메라의 화면 위쪽 = 평면도 북쪽: theta 유지해 회전 일관성 확보
      this.ortho.up.set(Math.sin(this.theta), 0, Math.cos(this.theta)).negate();
      this.ortho.lookAt(this.target);
    } else {
      // 입면/저면 ortho(A-S1) — persp와 동일 구면 배치 = 각도·팬·줌 상태 공유, 스왑 무봉합
      this.ortho.position.copy(this.persp.position);
      this.ortho.up.set(0, 1, 0); // plan이 남긴 up 오염 제거 (phi ∈ [0.05, π−0.05]라 특이점 없음)
      this.ortho.lookAt(this.target);
      // 스왑 프레임에 HUD reproject가 1콜 스테일 matrixWorldInverse로 투영하지 않게(리뷰) —
      // lookAt은 회전 반영 전 행렬을 굳히므로 여기서 확정(멱등·저비용, northScreenAngle 수정과 동일 근거).
      this.ortho.updateMatrixWorld();
    }
  }
}
