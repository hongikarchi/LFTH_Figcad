import * as THREE from 'three';
import type { CameraRig } from '../engine/CameraRig';
import { collectBvhCandidates } from '../engine/bvh'; // side-effect: BVH 전역 배선(가속 레이캐스트)

const EYE_HEIGHT = 1.6; // m
const BASE_SPEED = 2.0; // m/s (Enscape 보행급)
const RUN_MULT = 3; // Shift 달리기
const VERT_SPEED = 1.5; // Q/E m/s
const ACCEL = 12; // 지수 스무딩 계수 (1-e^(-ACCEL·dt))
const SNAP_INTERVAL_MS = 150; // 지면 레이 주기
const SNAP_LERP = 8; // 높이 추종 속도 (1/s)
const SNAP_MAX_DROP = 10; // 이 이상 아래 바닥은 무시(m) — 낭떠러지/보이드는 현 높이 유지(추락 없음, 발코니 검토 우선)
const PROBE_BUDGET_MS = 10; // 레이 예산 초과 → 세션 스냅 비활성(BVH 빌드 전 첫 레이 등 안전망)
const SPEED_MIN = 0.25;
const SPEED_MAX = 4;
// 벽 충돌(v1.1) — 눈높이 + 허리(허리벽·난간·가구) 2레이, 반경 내 히트 시 접선 슬라이드
const COLLIDE_RADIUS = 0.35; // m
const COLLIDE_HEIGHT_OFFSETS = [0, -0.9]; // eye 기준
const WALKABLE_NORMAL_Y = 0.7; // 히트 법선 |y|가 이 이상 = 바닥/램프(걸을 수 있음) — 충돌 아님

export interface WalkDeps {
  /** 지면 스냅·벽 충돌 레이 대상 (요소 메시 + federation 오버레이) */
  groundRoots: () => THREE.Object3D[];
  /** 활성 레벨 고도 (렌더 m) — 진입 착지·스냅 폴백 */
  levelElevationM: () => number;
  requestRender: () => void;
  onToast?: (msg: string) => void;
  /** 활성 단면 클립 평면 — 잘려나간(비표시) 면에 스냅/충돌하지 않게 히트 필터 */
  clipPlanes?: () => readonly THREE.Plane[];
}

/**
 * 걷기 이동 컨트롤러 — Engine ticker(update)로 매 프레임 적분. 비활성/정지 시 false 반환 =
 * render-on-demand rAF 휴면 유지. 키보드(WASD·Q/E·Shift)는 활성 중에만 window 리스너 부착.
 * 지면 추적: 이동 중 주기 하방 레이 → 바닥 + 눈높이 lerp (계단·슬래브 승강, 클립 잘린 면 제외).
 * 벽 충돌(v1.1): 수평 이동을 눈높이+허리 2레이로 검사, 반경 내 벽이면 접선 슬라이드 — 관통 없음.
 * 대형 모델: 큰 메시는 BVH 점진 빌드(engine/bvh)로 레이 가속 — 예산 킬스위치는 안전망으로 유지.
 * 낭떠러지/보이드: 착지면이 없으면 현 높이 유지(추락 없음 — 발코니·보이드 위 검토 우선, 의도).
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
  // 벽 충돌·BVH (v1.1) — 프레임 루프 할당 0 스크래치
  private bvhQueue: THREE.Mesh[] = [];
  private _delta = new THREE.Vector3();
  private _dir = new THREE.Vector3();
  private _applied = new THREE.Vector3();
  private _normal = new THREE.Vector3(); // 최근접 벽의 수평화 법선 (nearestWallHit 결과)
  private _candN = new THREE.Vector3(); // 후보 법선 스크래치 — _normal 오염 방지

  constructor(rig: CameraRig, deps: WalkDeps) {
    this.rig = rig;
    this.deps = deps;
    // (리뷰) ① Sprite.raycast는 raycaster.camera를 요구 — groundRoots에 라벨/언더레이 스프라이트가
    // 있으면(ReferenceLayer underlayLabel 등) 미설정 시 TypeError. 활성 카메라를 상시 지정.
    // ② Line threshold는 이 raycaster 전용이므로 한 번만 0으로 — 언더레이 수천 라인 세그먼트가
    // 걷기 레이(스냅+충돌)에 잡히지 않게 (기존 groundHit의 save/restore 댄스 대체).
    if (this.raycaster.params.Line) this.raycaster.params.Line.threshold = 0;
    if (this.raycaster.params.Points) this.raycaster.params.Points.threshold = 0;
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
    // 큰 메시 BVH 점진 빌드(프레임당 1개, update에서) — 빌드된 메시는 지오메트리에 캐시돼
    // 재진입 즉시 재사용. 완료 후엔 1M-tri에서도 레이가 예산 안 → 킬스위치가 거의 안 걸림.
    this.bvhQueue = collectBvhCandidates(this.deps.groundRoots());
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
    // BVH 점진 빌드 — 프레임당 1메시(빌드 중 프레임은 rAF 유지). 지오메트리에 캐시.
    if (this.bvhQueue.length > 0) {
      const m = this.bvhQueue.pop()!;
      if (!m.geometry.boundsTree) m.geometry.computeBoundsTree();
      this.deps.requestRender();
    }
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
      // 수평은 벽 충돌 해소 후 적용(v1.1 — 관통 방지·접선 슬라이드), 수직은 그대로
      this.moveWithCollision(this.vel.z * dt, this.vel.x * dt);
      if (Math.abs(this.vel.y) > 1e-6) this.rig.walkMove(0, 0, this.vel.y * dt);
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

  /**
   * 벽 충돌 해소 이동(v1.1) — 의도 수평 변위를 눈높이+허리 2레이로 검사, 반경 내 벽이면
   * 허용 거리까지 직진 후 잔여를 벽 접선으로 투영(슬라이드). 최대 2회 반복(코너).
   * 바닥/램프(법선 |y|≥0.7)는 충돌 아님 — 지면 스냅이 처리. 클립으로 잘린 면은 필터.
   */
  private moveWithCollision(dForward: number, dRight: number): void {
    const remaining = this.rig.walkDeltaWorld(dForward, dRight, this._delta);
    const applied = this._applied.set(0, 0, 0);
    for (let iter = 0; iter < 2; iter++) {
      const len = remaining.length();
      if (len < 1e-7) break;
      this._dir.copy(remaining).multiplyScalar(1 / len);
      const hit = this.nearestWallHit(this._dir, len + COLLIDE_RADIUS, applied);
      if (!hit) {
        applied.add(remaining);
        break;
      }
      // 깊은 매몰 탈출구(리뷰) — DoubleSide/뒤집힌 노멀 메시 **안**에서 시작하면 negate 법선이
      // 전방위 이동을 막아 데드락. 벽 표면에 정상 접촉한 경우(distance≈R)와 달리 매몰은
      // distance가 극소 → 이 프레임은 충돌 무시하고 걸어나가게 허용.
      if (hit.distance < 0.08) {
        applied.add(remaining);
        break;
      }
      const allowed = Math.max(0, hit.distance - COLLIDE_RADIUS);
      if (allowed >= len) {
        applied.add(remaining);
        break;
      }
      applied.addScaledVector(this._dir, allowed);
      // 잔여를 벽 접선으로 투영 — 법선(수평화) 방향 성분 제거
      remaining.addScaledVector(this._dir, -allowed);
      const n = this._normal;
      const into = remaining.dot(n);
      if (into < 0) remaining.addScaledVector(n, -into);
    }
    if (applied.lengthSq() > 0) this.rig.walkMoveWorld(applied.x, applied.z);
  }

  /** 수평 방향 최근접 벽 히트 — 2 높이 레이, 가시·클립 필터, 걷기 가능 경사 제외. _normal에 수평화 법선 기록 */
  private nearestWallHit(dir: THREE.Vector3, far: number, offset: THREE.Vector3): THREE.Intersection | null {
    let nearest: THREE.Intersection | null = null;
    const clips = this.deps.clipPlanes?.() ?? [];
    for (const hOff of COLLIDE_HEIGHT_OFFSETS) {
      this.rig.getWalkEye(this.eye);
      this.rayOrigin.set(this.eye.x + offset.x, this.eye.y + hOff, this.eye.z + offset.z);
      this.raycaster.set(this.rayOrigin, dir);
      this.raycaster.far = far;
      this.raycaster.camera = this.rig.active; // Sprite.raycast 크래시 방지
      const hits = this.raycaster.intersectObjects(this.deps.groundRoots(), true);
      for (const h of hits) {
        if (!(h.object as THREE.Mesh).isMesh || !h.face) continue;
        if (!this.isVisible(h.object)) continue;
        if (clips.some((p) => p.distanceToPoint(h.point) < -1e-6)) continue; // 클립으로 잘린 면
        this._candN.copy(h.face.normal).transformDirection(h.object.matrixWorld);
        if (Math.abs(this._candN.y) >= WALKABLE_NORMAL_Y) continue; // 바닥/램프 — 통과
        if (!nearest || h.distance < nearest.distance) {
          nearest = h;
          this._normal.copy(this._candN);
          this._normal.y = 0;
          this._normal.normalize();
          if (this._normal.dot(dir) > 0) this._normal.negate(); // 항상 이동 반대쪽 법선
        }
        break; // 이 레이의 최근접 벽만
      }
    }
    return nearest;
  }

  /**
   * groundHit + 소요시간 계측 — 예산 초과 시 세션 스냅 비활성(런타임 킬스위치).
   * 단 BVH 빌드가 진행 중이면 판정 유예(리뷰) — 빌드 전 첫 프로브가 느린 건 당연하고,
   * 빌드 완료 후엔 예산 안으로 들어온다(킬스위치가 BVH 도입 목적을 스스로 무효화하지 않게).
   */
  private timedGroundHit(): number | null {
    const t0 = performance.now();
    const y = this.groundHit();
    if (performance.now() - t0 > PROBE_BUDGET_MS && this.bvhQueue.length === 0) {
      this.snapEnabled = false;
      this.deps.onToast?.('대형 모델 — 자동 높이 고정 꺼짐 (Q/E로 조절)');
    }
    return y;
  }

  /** 하방 레이 → 바닥 y(월드 m) 또는 null. 가시 조상 체인 + 클립 필터(단면으로 잘린 슬래브 착지 방지). */
  private groundHit(): number | null {
    this.rig.getWalkEye(this.eye);
    this.rayOrigin.set(this.eye.x, this.eye.y + 0.3, this.eye.z);
    this.raycaster.set(this.rayOrigin, WalkController.DOWN);
    this.raycaster.far = SNAP_MAX_DROP + 0.3 + EYE_HEIGHT;
    this.raycaster.camera = this.rig.active; // Sprite.raycast가 요구 — 라벨 스프라이트 크래시 방지(리뷰)
    const hits = this.raycaster.intersectObjects(this.deps.groundRoots(), true);
    const clips = this.deps.clipPlanes?.() ?? [];
    for (const h of hits) {
      if (!(h.object as THREE.Mesh).isMesh) continue;
      if (!this.isVisible(h.object)) continue;
      if (clips.some((p) => p.distanceToPoint(h.point) < -1e-6)) continue; // 잘린 면 = 화면에 없음
      return h.point.y;
    }
    return null;
  }

  /** 가시 조상 체인 검사 (Picker raycastHit 규칙 공유) */
  private isVisible(obj: THREE.Object3D): boolean {
    for (let n: THREE.Object3D | null = obj; n; n = n.parent) {
      if (!n.visible) return false;
    }
    return true;
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
