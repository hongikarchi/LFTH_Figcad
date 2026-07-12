import * as THREE from 'three';
import { VIEW_PRESET_ANGLES, type CameraPose, type ViewMode, type ViewPreset } from '../engine/CameraRig';

/**
 * 축-공 뷰 기즈모 (A-S2, Blender 스타일) — 명령형 DOM HUD(불변③: React 렌더루프 금지).
 * 공 6개(N/E/S/W/T/B — 건축 방위, §C 결정1) + 축 선 3개 + 하단 persp/ortho 토글·iso 홈.
 * 카메라 쿼터니언 역으로 3축을 화면 투영해 transform/깊이(z-index·스케일·불투명도) 갱신 —
 * main.ts 렌더 티커에서 update(cam) 호출(render-on-demand, rAF 상시 루프 없음).
 *
 * 상호작용: 공 클릭 = 그 방위에서 보기(정착 상태서 재클릭 = 반대축, Blender 토글) ·
 * 공 밖 드래그 = 오빗(터치 포함 — 캔버스 밖 위젯이라 불변④ 펜/터치 분기와 무관) ·
 * ⬒ = persp/ortho 수동 토글(rig.setProjection — autoOrtho 아님) · ⌂ = iso 홈.
 */

export interface AxisGizmoDeps {
  setView: (preset: ViewPreset) => void;
  rotate: (dxPx: number, dyPx: number) => void;
  toggleProjection: () => void;
  isOrtho: () => boolean;
  getPose: () => CameraPose;
  mode: () => ViewMode;
}

/** 방위 공 → 프리셋. 공 = "그 방위에서 본다": N(북, +Z)에서 보면 남향 = back(북측 입면). */
const AXIS_PRESET: Record<string, ViewPreset> = {
  N: 'back',
  S: 'front',
  E: 'right',
  W: 'left',
  T: 'top',
  B: 'bottom',
};
const OPPOSITE: Partial<Record<ViewPreset, ViewPreset>> = {
  front: 'back',
  back: 'front',
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
};
const wrapPi = (a: number): number => THREE.MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI;

/**
 * 공 클릭이 낼 프리셋 (순수 — 단위 테스트 대상). 이미 그 프리셋에 **정착**해 있으면 반대축.
 * top은 plan 도착(φ≈MIN) 기준 — 진입 트윈 중(mode는 이미 plan, φ 아직 큼) 더블탭이
 * bottom으로 튀지 않게(리뷰). 각도표는 CameraRig와 단일 소스 공유(드리프트 방지).
 */
export function gizmoPresetFor(axis: string, pose: CameraPose, mode: ViewMode): ViewPreset {
  const base = AXIS_PRESET[axis] ?? 'iso';
  if (base === 'top') return mode === 'plan' && pose.phi < 0.06 ? 'bottom' : 'top';
  const a = VIEW_PRESET_ANGLES[base];
  if (
    a &&
    mode === '3d' &&
    Math.abs(wrapPi(pose.theta - a.theta)) < 1e-3 &&
    Math.abs(pose.phi - a.phi) < 1e-3
  ) {
    return OPPOSITE[base] ?? base;
  }
  return base;
}

/** 월드 방위 → 단위 벡터 (문서: x=동, 월드 +Z=북, +Y=위) */
const AXIS_DIR: Record<string, THREE.Vector3> = {
  N: new THREE.Vector3(0, 0, 1),
  S: new THREE.Vector3(0, 0, -1),
  E: new THREE.Vector3(1, 0, 0),
  W: new THREE.Vector3(-1, 0, 0),
  T: new THREE.Vector3(0, 1, 0),
  B: new THREE.Vector3(0, -1, 0),
};
const R = 34; // 공 궤도 반경 px (위젯 반폭 - 공 반경)
const DRAG_THRESHOLD = 4; // px — 이하면 클릭으로 취급

export class AxisGizmo {
  private root: HTMLDivElement;
  private balls = new Map<string, HTMLDivElement>();
  private lines = new Map<string, HTMLDivElement>(); // E/N/T 3축 선 (+방향만)
  private projBtn: HTMLButtonElement;
  private deps: AxisGizmoDeps;
  private _q = new THREE.Quaternion();
  private _v = new THREE.Vector3();
  private lastCamKey = ''; // 카메라 무변화 프레임 갱신 스킵 (티커는 매 렌더 호출)

  constructor(deps: AxisGizmoDeps) {
    this.deps = deps;
    this.root = document.createElement('div');
    this.root.className = 'axis-gizmo';
    this.root.title = '뷰 방위 — 공 클릭 = 그 방향에서 보기 · 드래그 = 회전';

    const orb = document.createElement('div');
    orb.className = 'ag-orb';
    this.root.appendChild(orb);
    for (const axis of ['E', 'N', 'T'] as const) {
      const line = document.createElement('div');
      line.className = 'ag-line';
      orb.appendChild(line);
      this.lines.set(axis, line);
    }
    const BALL_TITLES: Record<string, string> = {
      N: '북에서 보기 (북측 입면 · 직교)',
      S: '남에서 보기 (남측 입면 · 직교)',
      E: '동에서 보기 (동측 입면 · 직교)',
      W: '서에서 보기 (서측 입면 · 직교)',
      T: '위에서 보기 (평면)',
      B: '아래에서 보기 (저면 · 직교)',
    };
    for (const axis of Object.keys(AXIS_DIR)) {
      const ball = document.createElement('div');
      ball.className = 'ag-ball';
      ball.dataset['axis'] = axis;
      ball.textContent = axis;
      ball.title = BALL_TITLES[axis] ?? axis;
      // 접근성(리뷰) — 구 ViewGizmo는 native button이었음: 키보드·SR 경로 유지
      ball.setAttribute('role', 'button');
      ball.tabIndex = 0;
      ball.setAttribute('aria-label', BALL_TITLES[axis] ?? axis);
      ball.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        this.deps.setView(gizmoPresetFor(axis, this.deps.getPose(), this.deps.mode()));
      });
      orb.appendChild(ball);
      this.balls.set(axis, ball);
    }

    const foot = document.createElement('div');
    foot.className = 'ag-foot';
    this.projBtn = document.createElement('button');
    this.projBtn.className = 'ag-proj';
    this.projBtn.title = '원근/직교 토글';
    this.projBtn.addEventListener('click', () => this.deps.toggleProjection());
    const homeBtn = document.createElement('button');
    homeBtn.className = 'ag-home';
    homeBtn.textContent = '⌂';
    homeBtn.title = '등각 홈 (iso · 원근)';
    homeBtn.addEventListener('click', () => this.deps.setView('iso'));
    foot.appendChild(this.projBtn);
    foot.appendChild(homeBtn);
    this.root.appendChild(foot);

    // 드래그 = 오빗, 짧은 탭 = 공 클릭. pointer capture로 위젯 밖까지 드래그 추적.
    // (리뷰 critical) 캡처가 성공하면 스펙상 pointerup.target이 orb로 재타깃되어 공 판별이
    // 죽는다(합성 이벤트 스모크는 캡처 파이프라인을 우회해 이를 가렸음) — 공은 **pointerdown
    // 시점의 target**으로 기록해 up에서 사용. 포인터는 id 추적(멀티터치 지터 방지) +
    // pointercancel 처리(시스템 제스처 인계 후 호버 유령 오빗 방지).
    let dragging = false;
    let activePointer = -1;
    let downAxis: string | undefined;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    orb.addEventListener('pointerdown', (e) => {
      if (dragging) return; // 두 번째 포인터 무시 (첫 포인터가 제스처 소유)
      dragging = true;
      activePointer = e.pointerId;
      downAxis = (e.target as HTMLElement).dataset?.['axis'];
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      try {
        orb.setPointerCapture(e.pointerId);
      } catch {
        // 합성 이벤트(스모크)·이미 소멸한 포인터 — 캡처 없이도 orb 내 드래그는 동작
      }
    });
    orb.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== activePointer) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      lastX = e.clientX;
      lastY = e.clientY;
      if (moved > DRAG_THRESHOLD) this.deps.rotate(dx, dy);
    });
    const endGesture = (e: PointerEvent) => {
      if (e.pointerId !== activePointer) return;
      dragging = false;
      activePointer = -1;
      try {
        orb.releasePointerCapture(e.pointerId);
      } catch {
        // 캡처 안 된 포인터 — 무시
      }
    };
    orb.addEventListener('pointerup', (e) => {
      if (!dragging || e.pointerId !== activePointer) return; // 밖에서 시작한 프레스 등 — 오발 방지
      const wasDrag = moved > DRAG_THRESHOLD;
      const axis = downAxis;
      endGesture(e);
      downAxis = undefined;
      if (wasDrag || !axis) return;
      this.deps.setView(gizmoPresetFor(axis, this.deps.getPose(), this.deps.mode()));
    });
    orb.addEventListener('pointercancel', (e) => {
      endGesture(e);
      downAxis = undefined;
    });

    document.body.appendChild(this.root);
  }

  /** 렌더 티커 훅 — 카메라 회전을 공 배치에 반영 (무변화 프레임은 스킵) */
  update(cam: THREE.Camera): void {
    const q = cam.quaternion;
    const ortho = this.deps.isOrtho();
    const mode = this.deps.mode();
    const projLabel = ortho ? '직교' : '원근';
    const key = `${q.x.toFixed(4)},${q.y.toFixed(4)},${q.z.toFixed(4)},${q.w.toFixed(4)},${projLabel},${mode}`;
    if (key === this.lastCamKey) return;
    this.lastCamKey = key;
    this._q.copy(q).invert();
    // (리뷰 major) 이 리그의 ortho(plan·입면·저면)는 전부 프러스텀 X반사 — 반사는 쿼터니언에
    // 없으므로 화면 x를 미러해야 공 방위가 씬(동=오른쪽)과 일치. persp는 무반사.
    const sx = ortho ? -1 : 1;
    for (const [axis, ball] of this.balls) {
      const v = this._v.copy(AXIS_DIR[axis]!).applyQuaternion(this._q);
      const x = v.x * sx * R;
      const y = -v.y * R;
      const front = v.z > -1e-3; // 정확한 축뷰에서 지평선 공 4개가 float 노이즈로 뒷면 처리되지 않게
      ball.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${front ? 1 : 0.82})`;
      ball.style.zIndex = String(100 + Math.round(v.z * 50));
      ball.style.opacity = front ? '1' : '0.45'; // 뒤쪽 공 = 흐리게 (Blender −축 관례)
      // +축 선: 중심→공 (E/N/T만)
      const line = this.lines.get(axis);
      if (line) {
        const len = Math.hypot(x, y);
        line.style.width = `${len.toFixed(1)}px`;
        line.style.transform = `rotate(${Math.atan2(y, x)}rad)`;
        line.style.opacity = front ? '0.55' : '0.25';
      }
    }
    if (this.projBtn.textContent !== projLabel) this.projBtn.textContent = projLabel;
    // plan·걷기에선 setProjection이 내부 no-op — 침묵 무반응 대신 비활성 표시(리뷰)
    this.projBtn.disabled = mode !== '3d';
  }
}
