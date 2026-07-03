import * as THREE from 'three';
import type { CameraRig } from '../engine/CameraRig';

const EYE_HEIGHT = 1.6; // m
const BASE_SPEED = 2.0; // m/s (Enscape 보행급)
const RUN_MULT = 3; // Shift 달리기
const VERT_SPEED = 1.5; // Q/E m/s
const ACCEL = 12; // 지수 스무딩 계수 (1-e^(-ACCEL·dt))
const SNAP_INTERVAL_MS = 150; // 지면 레이 주기
const SNAP_LERP = 8; // 높이 추종 속도 (1/s)
const SNAP_MAX_DROP = 10; // 이 이상 아래 바닥은 무시(m) — 낭떠러지/보이드
const PROBE_BUDGET_MS = 10; // enter 시 프로브 초과 → 세션 스냅 비활성(BVH 없는 three, 1M-tri federation)
const SPEED_MIN = 0.25;
const SPEED_MAX = 4;

export interface WalkDeps {
  /** 지면 스냅 레이 대상 (요소 메시 + federation 오버레이) */
  groundRoots: () => THREE.Object3D[];
  /** 활성 레벨 고도 (렌더 m) — 진입 착지·스냅 폴백 */
  levelElevationM: () => number;
  requestRender: () => void;
  onToast?: (msg: string) => void;
}

/**
 * 걷기 이동 컨트롤러 — Engine ticker(update)로 매 프레임 적분. 비활성/정지 시 false 반환 =
 * render-on-demand rAF 휴면 유지. 키보드(WASD·Q/E·Shift)는 활성 중에만 window 리스너 부착.
 * 지면 추적: 이동 중 주기 하방 레이 → 바닥 + 눈높이 lerp (계단·슬래브 승강, 벽 충돌 없음 v1).
 */
export class WalkController {
  private rig: CameraRig;
  private deps: WalkDeps;
  private isActive = false;
  private keys = new Set<string>();
  private joyX = 0; // -1..1 스트레이프(우+)
  private joyY = 0; // -1..1 전진(+)
  private run = false;
  private speedMult = 1;
  private vel = new THREE.Vector3(); // x=스트레이프, y=수직, z=전진 (카메라 로컬)
  // 지면 스냅
  private snapEnabled = true;
  private snapTimer = 0;
  private targetY: number | null = null;
  private raycaster = new THREE.Raycaster();
  private rayOrigin = new THREE.Vector3();
  private eye = new THREE.Vector3();
  private lastToast = 0;
  private static DOWN = new THREE.Vector3(0, -1, 0);

  constructor(rig: CameraRig, deps: WalkDeps) {
    this.rig = rig;
    this.deps = deps;
  }

  get active(): boolean {
    return this.isActive;
  }

  enter(): void {
    if (this.isActive) return;
    this.isActive = true;
    this.keys.clear();
    this.joyX = this.joyY = 0;
    this.run = false;
    this.speedMult = 1;
    this.vel.set(0, 0, 0);
    this.targetY = null;
    this.snapTimer = 0;
    this.rig.enterWalk(this.deps.levelElevationM() + EYE_HEIGHT);
    // 스냅 켠 채 시작 — 킬스위치는 런타임 계측(timedGroundHit): 진입 지점 1회 프로브는 대표성이 없다
    // (빈 영역 진입 후 1M-tri federation 위를 걸으면 그때 잭). 예산 초과 레이가 관측되는 즉시 세션 비활성.
    this.snapEnabled = true;
    this.timedGroundHit();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clearKeys);
    document.addEventListener('visibilitychange', this.clearKeys);
    this.deps.requestRender();
  }

  exit(): void {
    if (!this.isActive) return;
    this.isActive = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clearKeys);
    document.removeEventListener('visibilitychange', this.clearKeys);
    this.keys.clear();
    this.joyX = this.joyY = 0;
    this.rig.exitWalk();
    this.deps.requestRender();
  }

  /** 시선 드래그 (InputManager/TouchGestures 걷기 분기 → 여기) */
  look(dxPx: number, dyPx: number): void {
    if (!this.isActive) return;
    this.rig.walkLook(dxPx, dyPx);
    this.deps.requestRender();
  }

  /** 조이스틱 벡터 (-1..1, y+=전진) — 데드존·반응곡선은 위젯이 처리 */
  setJoystick(x: number, y: number): void {
    this.joyX = x;
    this.joyY = y;
    if (this.isActive) this.deps.requestRender(); // ticker 킥
  }

  /** 휠 = 이동 속도 배수 (Enscape 관례) */
  adjustSpeed(wheelDeltaY: number): void {
    this.speedMult = THREE.MathUtils.clamp(this.speedMult * Math.exp(-wheelDeltaY * 0.0008), SPEED_MIN, SPEED_MAX);
    const now = performance.now();
    if (now - this.lastToast > 250) {
      this.lastToast = now;
      this.deps.onToast?.(`이동 속도 ×${this.speedMult.toFixed(this.speedMult < 1 ? 2 : 1)}`);
    }
  }

  /** Engine ticker — true 반환 = rAF 유지. 입력·잔여속도·높이 lerp 없으면 false(휴면). */
  readonly update = (dt: number): boolean => {
    if (!this.isActive) return false;
    // 목표 속도 (카메라 로컬): 키 + 조이스틱 합산, 클램프
    const kx = (this.keys.has('d') ? 1 : 0) - (this.keys.has('a') ? 1 : 0);
    const ky = (this.keys.has('w') ? 1 : 0) - (this.keys.has('s') ? 1 : 0);
    const kv = (this.keys.has('e') ? 1 : 0) - (this.keys.has('q') ? 1 : 0);
    const ix = THREE.MathUtils.clamp(kx + this.joyX, -1, 1);
    const iy = THREE.MathUtils.clamp(ky + this.joyY, -1, 1);
    const speed = BASE_SPEED * this.speedMult * (this.run ? RUN_MULT : 1);
    const k = 1 - Math.exp(-ACCEL * dt);
    this.vel.x += (ix * speed - this.vel.x) * k;
    this.vel.z += (iy * speed - this.vel.z) * k;
    this.vel.y += (kv * VERT_SPEED - this.vel.y) * k;

    const moving = Math.abs(this.vel.x) + Math.abs(this.vel.y) + Math.abs(this.vel.z) > 1e-3;
    if (moving) {
      this.rig.walkMove(this.vel.z * dt, this.vel.x * dt, this.vel.y * dt);
      if (kv !== 0) this.targetY = null; // 수동 높이 조절 = 진행 중 스냅 lerp 취소
    }

    // 지면 추적 — 이동 중 주기 레이. Raycaster는 clippingPlanes 무시 → 단면으로 잘린
    // 슬래브에도 스냅될 수 있음(허용, v1).
    if (this.snapEnabled && moving && kv === 0) {
      this.snapTimer -= dt * 1000;
      if (this.snapTimer <= 0) {
        this.snapTimer = SNAP_INTERVAL_MS;
        const hitY = this.timedGroundHit();
        if (hitY !== null) this.targetY = hitY + EYE_HEIGHT;
      }
    }
    let lerping = false;
    if (this.targetY !== null) {
      this.rig.getWalkEye(this.eye);
      const dy = this.targetY - this.eye.y;
      if (Math.abs(dy) > 0.005) {
        this.rig.setWalkY(this.eye.y + dy * Math.min(1, SNAP_LERP * dt));
      } else {
        this.rig.setWalkY(this.targetY);
        this.targetY = null;
      }
      lerping = true; // 최종 스냅 프레임도 true — false면 마지막 setWalkY가 렌더 안 됨(rig.tick과 동일 계약)
    }
    return moving || lerping;
  };

  /** groundHit + 소요시간 계측 — 예산 초과 시 세션 스냅 비활성(런타임 킬스위치) */
  private timedGroundHit(): number | null {
    const t0 = performance.now();
    const y = this.groundHit();
    if (performance.now() - t0 > PROBE_BUDGET_MS) {
      this.snapEnabled = false;
      this.deps.onToast?.('대형 모델 — 자동 높이 고정 꺼짐 (Q/E로 조절)');
    }
    return y;
  }

  /** 하방 레이 → 바닥 y(월드 m) 또는 null. 가시 조상 체인만(Picker raycastHit 규칙). */
  private groundHit(): number | null {
    this.rig.getWalkEye(this.eye);
    this.rayOrigin.set(this.eye.x, this.eye.y + 0.3, this.eye.z);
    this.raycaster.set(this.rayOrigin, WalkController.DOWN);
    this.raycaster.far = SNAP_MAX_DROP + 0.3 + EYE_HEIGHT;
    const savedLine = this.raycaster.params.Line?.threshold;
    if (this.raycaster.params.Line) this.raycaster.params.Line.threshold = 0;
    const hits = this.raycaster.intersectObjects(this.deps.groundRoots(), true);
    if (this.raycaster.params.Line && savedLine !== undefined) this.raycaster.params.Line.threshold = savedLine;
    for (const h of hits) {
      if (!(h.object as THREE.Mesh).isMesh) continue;
      let visible = true;
      for (let n: THREE.Object3D | null = h.object; n; n = n.parent) {
        if (!n.visible) {
          visible = false;
          break;
        }
      }
      if (visible) return h.point.y;
    }
    return null;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Shift') {
      this.run = true;
      this.deps.requestRender();
      return;
    }
    const k = this.mapKey(e.key);
    if (!k) return;
    e.preventDefault(); // 화살표 = 페이지 스크롤 방지
    if (!this.keys.has(k)) {
      this.keys.add(k);
      this.deps.requestRender(); // ticker 킥
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') {
      this.run = false;
      return;
    }
    const k = this.mapKey(e.key);
    if (k) this.keys.delete(k);
  };

  private clearKeys = (): void => {
    this.keys.clear();
    this.run = false;
  };

  private mapKey(key: string): string | null {
    switch (key) {
      case 'w': case 'W': case 'ArrowUp': return 'w';
      case 's': case 'S': case 'ArrowDown': return 's';
      case 'a': case 'A': case 'ArrowLeft': return 'a';
      case 'd': case 'D': case 'ArrowRight': return 'd';
      case 'q': case 'Q': return 'q';
      case 'e': case 'E': return 'e';
      default: return null;
    }
  }
}
