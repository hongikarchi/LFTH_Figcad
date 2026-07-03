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
  /** 1지 탭 = 활성 도구 클릭(선택/코멘트/배치) — 모바일 반응형(폰=펜 없음). 드래그는 카메라(불변 유지). */
  onTap?: (x: number, y: number) => void;
  /** 2지 탭 = undo, 3지 탭 = redo (Procreate/iPad 관례) */
  onTwoFingerTap?: () => void;
  onThreeFingerTap?: () => void;
}

/** 걷기 모드 터치 싱크 — null이면 걷기 꺼짐(기존 오빗/팬핀치). 탭 판정은 걷기와 무관하게 유지. */
export interface WalkTouchSink {
  look(dxPx: number, dyPx: number): void;
  /** ratio = spread/lastSpread — 핀치아웃(>1) = 망원(초점거리 증가) */
  pinchFocal(ratio: number): void;
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
    private walk: () => WalkTouchSink | null = () => null,
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

    const walk = this.walk();
    if (this.pointers.size === 1) {
      // 걷기 중 1지 드래그 = 시선(룩), 아니면 오빗. 탭 판정(up)은 양쪽 공통 유지.
      if (walk) walk.look(e.clientX - p.x, e.clientY - p.y);
      else this.rig.orbit(e.clientX - p.x, e.clientY - p.y);
      this.onChange();
    } else if (this.pointers.size === 2) {
      p.x = e.clientX;
      p.y = e.clientY;
      const [a, b] = [...this.pointers.values()] as [TrackedPointer, TrackedPointer];
      const centroid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const spread = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.lastCentroid) {
        if (walk) {
          // 걷기 중 2지 = 핀치 렌즈만 (팬 무시). 핀치아웃 = 망원 — rig.zoom 인자(last/spread)와 역수.
          if (this.lastSpread > 0 && spread > 0) walk.pinchFocal(spread / this.lastSpread);
        } else {
          this.rig.pan(centroid.x - this.lastCentroid.x, centroid.y - this.lastCentroid.y);
          if (this.lastSpread > 0 && spread > 0) {
            this.rig.zoom(this.lastSpread / spread);
          }
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
    // 모든 손가락이 떨어졌을 때 탭 판정 (<300ms, 이동 <10px). 1지=도구클릭, 2/3지=undo/redo.
    if (this.pointers.size === 0 && this.sessionMaxCount >= 1) {
      const dur = performance.now() - this.sessionStart;
      if (dur < 300 && this.sessionMoved < 10) {
        if (this.sessionMaxCount === 1) this.taps.onTap?.(e.clientX, e.clientY);
        else if (this.sessionMaxCount === 2) this.taps.onTwoFingerTap?.();
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
