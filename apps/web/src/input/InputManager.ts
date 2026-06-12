import type { CameraRig } from '../engine/CameraRig';
import { screenToDoc } from '../engine/Picker';
import { TouchGestures } from './gestures';
import type { ToolController, ToolPointerInfo } from '../tools/ToolController';

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
  private toolPointerId: number | null = null;
  private penActive = false;

  constructor(
    canvas: HTMLCanvasElement,
    private rig: CameraRig,
    private tools: ToolController,
    private getElevationM: () => number,
    private onChange: () => void,
  ) {
    this.touch = new TouchGestures(rig, onChange);

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
    if (e.pointerType === 'mouse' && e.button !== 0) {
      this.cameraButton = e.button;
      this.cameraPointerId = e.pointerId;
      this.lastMouse = { x: e.clientX, y: e.clientY };
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
        if (this.cameraButton === 2) this.rig.pan(dx, dy);
        else this.rig.orbit(dx, dy);
        this.onChange();
        return;
      }
    }
    // 호버 포함 — 도구가 고스트/스냅 마커를 그린다
    this.tools.active?.move(this.info(e));
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touch.up(e);
      return;
    }
    if (e.pointerType === 'pen') this.setPenActive(false);
    if (this.cameraPointerId === e.pointerId && this.cameraButton >= 0) {
      // 같은 포인터의 어떤 up이든 카메라 모드 해제 (button 일치 요구 금지)
      const bit = this.cameraButton === 2 ? 2 : 4;
      if ((e.buttons & bit) === 0) {
        this.cameraButton = -1;
        this.cameraPointerId = null;
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
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.rig.zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
    this.onChange();
  };
}
