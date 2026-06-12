import type { CameraRig } from '../engine/CameraRig';
import { TouchGestures } from './gestures';

/**
 * 모든 포인터 이벤트의 단일 진입점. pointerType으로 분기:
 *   touch → 카메라 제스처
 *   mouse → 좌드래그 궤도, 우드래그 팬, 휠 줌
 *   pen   → M0에서는 궤도 (M1부터 ToolController로 라우팅; 펜=도구 원칙)
 * Safari 퀴크 방어(페이지 핀치 줌, 컨텍스트 메뉴, 더블탭 줌)도 여기서 처리.
 */
export class InputManager {
  private touch: TouchGestures;
  private mouseButton = -1;
  private lastMouse = { x: 0, y: 0 };

  constructor(
    canvas: HTMLCanvasElement,
    private rig: CameraRig,
    private onChange: () => void,
  ) {
    this.touch = new TouchGestures(rig, onChange);

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS Safari 페이지 핀치 줌/더블탭 줌 차단
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
  }

  private onDown = (e: PointerEvent): void => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') {
      this.touch.down(e);
    } else {
      // mouse + pen(M0 임시)
      this.mouseButton = e.button;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touch.move(e);
      return;
    }
    if (this.mouseButton < 0) return;
    const dx = e.clientX - this.lastMouse.x;
    const dy = e.clientY - this.lastMouse.y;
    this.lastMouse = { x: e.clientX, y: e.clientY };
    if (this.mouseButton === 2 || this.mouseButton === 1) {
      this.rig.pan(dx, dy);
    } else {
      this.rig.orbit(dx, dy);
    }
    this.onChange();
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touch.up(e);
    } else {
      this.mouseButton = -1;
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.rig.zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
    this.onChange();
  };
}
