import type { Pt } from '@figcad/core';
import type { CameraRig } from '../engine/CameraRig';
import { screenToDoc } from '../engine/Picker';
import { TouchGestures, type TapCallbacks, type WalkTouchSink } from './gestures';
import type { ToolController, ToolPointerInfo } from '../tools/ToolController';

export interface InputOptions extends TapCallbacks {
  /** 포인터의 지면 위치 발행 (presence 커서) — null = 화면 밖/교차 없음 */
  onCursor?: (doc: Pt | null) => void;
  /** RMB 오빗 시작 시 피벗(월드 m [x,y,z]) 해석 — 선택중심/커서히트. null=피벗 유지(현재 target). 항목3. */
  resolvePivot?: (clientX: number, clientY: number) => [number, number, number] | null;
  /** 걷기 모드 활성 여부 — true면 마우스 드래그=시선·휠=속도, 터치 1지 드래그=시선·핀치=렌즈 */
  walkActive?: () => boolean;
  /** 걷기 시선 드래그 (px 델타) */
  walkLook?: (dx: number, dy: number) => void;
  /** 걷기 휠 = 이동 속도 (Enscape 관례) */
  walkSpeed?: (wheelDeltaY: number) => void;
  /** 걷기 Ctrl+휠 / 핀치 = 렌즈 mm 델타(±) 또는 핀치 ratio */
  walkFocalDelta?: (deltaMm: number) => void;
  walkFocalPinch?: (ratio: number) => void;
}

/**
 * 모든 포인터 이벤트의 단일 진입점 (불변 규칙 4: 펜=도구, 터치=카메라).
 *   touch        → 카메라 제스처 (1지 궤도/팬, 2지 팬+핀치)
 *   pen          → 활성 도구
 *   mouse 좌     → 활성 도구
 *   mouse 중/우  → 궤도/팬, 휠 → 줌
 * pointercancel은 도구 cancel로 라우팅 (커밋 금지 — 시스템 제스처/팜 인계 등).
 * 펜 활성(다운/호버) 시 신규 터치 무시 + 추적 중 터치 폐기(팜 리젝션).
 */
export class InputManager {
  private touch: TouchGestures;
  private cameraButton = -1;
  private cameraPointerId: number | null = null;
  private lastMouse = { x: 0, y: 0 };
  private cameraMoved = 0; // RMB 클릭(Enter) vs 드래그 판별용 누적 이동량
  private toolPointerId: number | null = null;
  private penActive = false;
  // 걷기: LMB = 잠정 룩 포인터 — >3px 드래그 = 시선(도구 미도달), ≤3px 클릭 = tapTool(코멘트/선택 유지)
  private walkLookId: number | null = null;
  private walkMoved = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private rig: CameraRig,
    private tools: ToolController,
    private getElevationM: () => number,
    private onChange: () => void,
    private opts: InputOptions = {},
  ) {
    // 1지 탭 = 활성 도구 클릭(선택/코멘트/배치) — 폰(펜 없음) 뷰·리뷰용. 드래그는 그대로 카메라(불변 4 유지).
    // 마우스 클릭과 동일 경로(down+up) → SelectTool 픽/CommentTool 리더와 무충돌. 2/3지 탭(undo/redo)은 opts에서.
    // 걷기 중 터치 = 1지 드래그 시선·2지 핀치 렌즈 (TouchGestures walk sink — 탭 판정은 공통 유지).
    const walkSink: WalkTouchSink = {
      look: (dx, dy) => this.opts.walkLook?.(dx, dy),
      pinchFocal: (ratio) => this.opts.walkFocalPinch?.(ratio),
    };
    this.touch = new TouchGestures(
      rig,
      onChange,
      { ...opts, onTap: (x, y) => this.tapTool(x, y) },
      () => (this.opts.walkActive?.() ? walkSink : null),
    );

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
  }

  private info(e: PointerEvent): ToolPointerInfo {
    return {
      doc: screenToDoc(e.clientX, e.clientY, this.rig.active, this.getElevationM()),
      clientX: e.clientX,
      clientY: e.clientY,
      mmPerPixel: Math.max(this.rig.worldPerPixel() * 1000, 0.001),
    };
  }

  /** 터치 1지 탭 → 활성 도구에 합성 클릭(down+up, 마우스 클릭과 동일 경로). 폰 선택/코멘트/배치. */
  private tapTool(x: number, y: number): void {
    if (this.penActive) return; // 펜 워크플로 중엔 무시(팜 리젝션 대칭)
    const info: ToolPointerInfo = {
      doc: screenToDoc(x, y, this.rig.active, this.getElevationM()),
      clientX: x,
      clientY: y,
      mmPerPixel: Math.max(this.rig.worldPerPixel() * 1000, 0.001),
    };
    this.tools.active?.down(info);
    this.tools.active?.up(info);
  }

  private setPenActive(on: boolean): void {
    if (on && !this.penActive) this.touch.reset();
    this.penActive = on;
  }

  private onDown = (e: PointerEvent): void => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') {
      if (this.penActive) return; // 팜 리젝션
      this.touch.down(e);
      return;
    }
    if (e.pointerType === 'pen') this.setPenActive(true);
    // 걷기: 마우스 전 버튼 = 잠정 룩 포인터 (펜은 도구 유지 — 불변4). 클릭(≤3px)은 up에서 도구/Enter 합성.
    if (e.pointerType === 'mouse' && this.opts.walkActive?.()) {
      this.walkLookId = e.pointerId;
      this.walkMoved = 0;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) {
      this.cameraButton = e.button;
      this.cameraPointerId = e.pointerId;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.cameraMoved = 0;
      // 항목3: 무수식 RMB 오빗 시작 시 피벗을 선택중심/커서히트로 (원점 고정 오빗 회귀 수정). 3D·무수식만.
      if (e.button === 2 && this.rig.mode === '3d' && !e.ctrlKey && !e.shiftKey) {
        const p = this.opts.resolvePivot?.(e.clientX, e.clientY);
        if (p) this.rig.setPivot(p[0], p[1], p[2]);
      }
      return;
    }
    this.toolPointerId = e.pointerId;
    this.tools.active?.down(this.info(e));
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      if (this.penActive) return;
      this.touch.move(e);
      return;
    }
    if (e.pointerType === 'pen') this.setPenActive(true); // 호버 포함 — 팜 선접촉 방어
    // 걷기 룩 드래그 — 호버(비캡처)는 아래 기존 경로로 폴스루(onCursor presence + 도구 고스트 생존)
    if (this.walkLookId === e.pointerId) {
      // 유실 릴리즈 방어(기존 카메라 경로와 대칭): 버튼이 전부 떼졌으면 룩 해제 — alt-tab 후 창 밖
      // 릴리즈로 pointerup이 유실되면 호버 이동이 계속 시선을 돌리는 스틱-룩 방지.
      if ((e.buttons & 7) === 0) {
        this.walkLookId = null;
      } else {
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        this.walkMoved += Math.abs(dx) + Math.abs(dy);
        if (this.walkMoved > 3) {
          this.opts.walkLook?.(dx, dy);
          this.onChange();
        }
        return;
      }
    }
    if (this.cameraButton >= 0) {
      // 코디드 릴리즈 방어: 해당 버튼 비트가 꺼졌으면 카메라 모드 해제
      const bit = this.cameraButton === 2 ? 2 : 4;
      if ((e.buttons & bit) === 0) {
        this.cameraButton = -1;
        this.cameraPointerId = null;
      } else {
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        this.cameraMoved += Math.abs(dx) + Math.abs(dy);
        // Rhino 바인딩 (docs.mcneel.com / wiki.mcneel.com cameramanipulation) —
        // 모디파이어는 드래그 중 실시간 평가
        if (this.cameraButton === 2) {
          // RMB: Ctrl+Shift=회전(평행 뷰 포함), Shift=팬, Ctrl=줌, 무수식=회전(원근)/팬(평행)
          if (e.ctrlKey && e.shiftKey) this.rig.rotate(dx, dy);
          else if (e.shiftKey) this.rig.pan(dx, dy);
          else if (e.ctrlKey) this.rig.zoomDrag(dy);
          else this.rig.orbit(dx, dy);
        } else {
          // MMB 기본 = 팬, Shift/Alt+MMB = 회전, Ctrl+MMB = 줌 (options/mouse.htm)
          if (e.ctrlKey) this.rig.zoomDrag(dy);
          else if (e.shiftKey || e.altKey) this.rig.rotate(dx, dy);
          else this.rig.pan(dx, dy);
        }
        this.onChange();
        return;
      }
    }
    // 호버 포함 — 도구가 고스트/스냅 마커를 그린다
    const info = this.info(e);
    this.opts.onCursor?.(info.doc);
    this.tools.active?.move(info);
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      // 펜 활성 중 터치 up 무시(팜 리젝션 — onDown/onMove와 대칭). reset()이 이미 터치를 비웠고,
      // gestures.reset()의 sessionMaxCount=0가 스테일 탭도 차단하지만 여기서 한 번 더 방어.
      if (!this.penActive) this.touch.up(e);
      return;
    }
    if (e.pointerType === 'pen') this.setPenActive(false);
    if (this.walkLookId === e.pointerId) {
      this.walkLookId = null;
      // 클릭(≤3px): LMB = 도구 합성클릭(걸어다니며 코멘트/선택), RMB = Enter(기존 의미 유지 — 무해)
      if (this.walkMoved <= 3) {
        if (e.button === 0) this.tapTool(e.clientX, e.clientY);
        else if (e.button === 2) {
          this.tools.enter();
          this.onChange();
        }
      }
      return;
    }
    if (this.cameraPointerId === e.pointerId && this.cameraButton >= 0) {
      // 같은 포인터의 어떤 up이든 카메라 모드 해제 (button 일치 요구 금지)
      const bit = this.cameraButton === 2 ? 2 : 4;
      if ((e.buttons & bit) === 0) {
        const wasRmb = this.cameraButton === 2;
        this.cameraButton = -1;
        this.cameraPointerId = null;
        // Rhino: RMB 클릭(드래그 없음) = Enter/명령 반복 → 체인 종료/확정
        if (wasRmb && this.cameraMoved < 3 && !e.ctrlKey && !e.shiftKey) {
          this.tools.enter();
          this.onChange();
        }
        if (e.button !== 0) return;
      }
    }
    if (this.toolPointerId === e.pointerId) {
      this.toolPointerId = null;
      this.tools.active?.up(this.info(e));
    }
  };

  /** 브라우저가 제스처를 중단 — 절대 커밋하지 않는다 */
  private onCancel = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touch.up(e);
      return;
    }
    if (e.pointerType === 'pen') this.penActive = false;
    if (this.walkLookId === e.pointerId) this.walkLookId = null;
    if (this.cameraPointerId === e.pointerId) {
      this.cameraButton = -1;
      this.cameraPointerId = null;
    }
    if (this.toolPointerId === e.pointerId) {
      this.toolPointerId = null;
      this.tools.active?.cancel();
      this.onChange();
    }
  };

  private onLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'pen') this.penActive = false;
    this.opts.onCursor?.(null);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.opts.walkActive?.()) {
      // 걷기: 휠 = 이동 속도(Enscape 관례), Ctrl+휠 = 렌즈 ±2mm
      if (e.ctrlKey) {
        this.opts.walkFocalDelta?.(e.deltaY > 0 ? -2 : 2);
        this.onChange();
      } else {
        this.opts.walkSpeed?.(e.deltaY);
      }
      return;
    }
    this.rig.zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
    this.onChange();
  };

  /** 걷기 토글 시 진행 중 터치 제스처 폐기 — 스테일 포인터가 1/2지 판정 오염 방지 */
  resetTouch(): void {
    this.touch.reset();
    this.walkLookId = null;
  }
}
