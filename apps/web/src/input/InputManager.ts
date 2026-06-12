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
 * 펜 활성 중 신규 터치 무시(팜 리젝션). Safari 퀴크 방어 포함.
 */
export class InputManager {
  private touch: TouchGestures;
  private cameraButton = -1; // 카메라 조작 중인 마우스 버튼
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
    canvas.addEventListener('pointercancel', this.onUp);
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
      // 화면 1px당 문서 mm (rig 거리 기반 근사 — 스냅 톨러런스 환산용)
      mmPerPixel: ((this.rig.viewDistance / window.innerHeight) * 2 * 1000) | 0 || 1,
    };
  }

  private onDown = (e: PointerEvent): void => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') {
      if (this.penActive) return; // 팜 리젝션
      this.touch.down(e);
      return;
    }
    if (e.pointerType === 'pen') this.penActive = true;
    if (e.pointerType === 'mouse' && e.button !== 0) {
      // 중/우클릭 = 카메라
      this.cameraButton = e.button;
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
    if (this.cameraButton >= 0) {
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      if (this.cameraButton === 2) this.rig.pan(dx, dy);
      else this.rig.orbit(dx, dy);
      this.onChange();
      return;
    }
    // 호버 포함 — 도구가 고스트/스냅 마커를 그린다
    this.tools.active?.move(this.info(e));
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touch.up(e);
      return;
    }
    if (e.pointerType === 'pen') this.penActive = false;
    if (this.cameraButton >= 0 && e.pointerType === 'mouse' && e.button === this.cameraButton) {
      this.cameraButton = -1;
      return;
    }
    if (this.toolPointerId === e.pointerId) {
      this.toolPointerId = null;
      this.tools.active?.up(this.info(e));
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.rig.zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
    this.onChange();
  };
}
