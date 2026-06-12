import type { CameraRig } from '../engine/CameraRig';

interface TrackedPointer {
  x: number;
  y: number;
}

/**
 * 터치 카메라 제스처: 1지 = 궤도(3D)/팬(평면), 2지 = 팬 + 핀치 줌.
 * 도구(펜) 입력과 분리된 카메라 전용 상태머신.
 */
export class TouchGestures {
  private pointers = new Map<number, TrackedPointer>();
  private lastCentroid: TrackedPointer | null = null;
  private lastSpread = 0;

  constructor(
    private rig: CameraRig,
    private onChange: () => void,
  ) {}

  down(e: PointerEvent): void {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.resetReference();
  }

  move(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;

    if (this.pointers.size === 1) {
      this.rig.orbit(e.clientX - p.x, e.clientY - p.y);
      this.onChange();
    } else if (this.pointers.size === 2) {
      p.x = e.clientX;
      p.y = e.clientY;
      const [a, b] = [...this.pointers.values()] as [TrackedPointer, TrackedPointer];
      const centroid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const spread = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.lastCentroid) {
        this.rig.pan(centroid.x - this.lastCentroid.x, centroid.y - this.lastCentroid.y);
        if (this.lastSpread > 0 && spread > 0) {
          this.rig.zoom(this.lastSpread / spread);
        }
        this.onChange();
      }
      this.lastCentroid = centroid;
      this.lastSpread = spread;
      return;
    }

    p.x = e.clientX;
    p.y = e.clientY;
  }

  up(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    this.resetReference();
  }

  /** 팜 리젝션: 펜 활성 전환 시 추적 중인 터치를 모두 버린다 (스테일 점프 방지) */
  reset(): void {
    this.pointers.clear();
    this.resetReference();
  }

  get activeCount(): number {
    return this.pointers.size;
  }

  private resetReference(): void {
    this.lastCentroid = null;
    this.lastSpread = 0;
  }
}
