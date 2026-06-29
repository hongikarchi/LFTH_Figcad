import type { CameraRig } from '../engine/CameraRig';

interface TrackedPointer {
  x: number;
  y: number;
}

/**
 * 터치 카메라 제스처: 1지 = 궤도(3D)/팬(평면), 2지 = 팬 + 핀치 줌.
 * 도구(펜) 입력과 분리된 카메라 전용 상태머신.
 */
export interface TapCallbacks {
  /** 2지 탭 = undo, 3지 탭 = redo (Procreate/iPad 관례) */
  onTwoFingerTap?: () => void;
  onThreeFingerTap?: () => void;
}

export class TouchGestures {
  private pointers = new Map<number, TrackedPointer>();
  private lastCentroid: TrackedPointer | null = null;
  private lastSpread = 0;
  // 탭 감지: 제스처 세션(첫 다운→전체 업) 동안 최대 포인터 수 + 이동량 추적
  private sessionStart = 0;
  private sessionMaxCount = 0;
  private sessionMoved = 0;

  constructor(
    private rig: CameraRig,
    private onChange: () => void,
    private taps: TapCallbacks = {},
  ) {}

  down(e: PointerEvent): void {
    if (this.pointers.size === 0) {
      this.sessionStart = performance.now();
      this.sessionMaxCount = 0;
      this.sessionMoved = 0;
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.sessionMaxCount = Math.max(this.sessionMaxCount, this.pointers.size);
    this.resetReference();
  }

  move(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;

    this.sessionMoved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);

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
    // 모든 손가락이 떨어졌을 때 탭 판정 (<300ms, 이동 <10px)
    if (this.pointers.size === 0 && this.sessionMaxCount >= 2) {
      const dur = performance.now() - this.sessionStart;
      if (dur < 300 && this.sessionMoved < 10) {
        if (this.sessionMaxCount === 2) this.taps.onTwoFingerTap?.();
        else if (this.sessionMaxCount === 3) this.taps.onThreeFingerTap?.();
      }
    }
  }

  /** 팜 리젝션: 펜 활성 전환 시 추적 중인 터치를 모두 버린다 (스테일 점프 방지) */
  reset(): void {
    this.pointers.clear();
    this.resetReference();
    // 탭 세션 카운터도 리셋 — 안 하면 팜 리젝 후 스테일 pointerup(size 0)이 stale sessionMaxCount로
    // 가짜 2/3손가락 탭(undo/redo)을 발사(펜 워크플로 중 조용한 파괴, 불변 4). down()이 size 0서 재초기화.
    this.sessionMaxCount = 0;
  }

  get activeCount(): number {
    return this.pointers.size;
  }

  private resetReference(): void {
    this.lastCentroid = null;
    this.lastSpread = 0;
  }
}
