import * as THREE from 'three';

/**
 * 렌더 루프 소유자. render-on-demand: requestRender()가 호출됐을 때만,
 * 또는 tick 콜백(카메라 트윈 등)이 계속을 요청하는 동안만 rAF가 돈다.
 * iPad 배터리/발열 예산의 핵심.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();

  private dirty = true;
  private rafId: number | null = null;
  private tickers: Array<(dt: number) => boolean> = [];
  private lastTime = 0;
  private getCamera: () => THREE.Camera;

  constructor(canvas: HTMLCanvasElement, getCamera: () => THREE.Camera) {
    this.getCamera = getCamera;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const resize = () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.dirty = true;
      this.schedule();
    };
    window.addEventListener('resize', resize);
    resize();
  }

  /** tick 콜백 등록. true 반환 = 다음 프레임에도 계속 (트윈 진행 중 등) */
  addTicker(fn: (dt: number) => boolean): void {
    this.tickers.push(fn);
  }

  requestRender(): void {
    this.dirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.rafId !== null) return;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.rafId = null;
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    let keepGoing = false;
    for (const t of this.tickers) {
      if (t(dt)) keepGoing = true;
    }

    if (this.dirty || keepGoing) {
      this.renderer.render(this.scene, this.getCamera());
      this.dirty = false;
    }
    if (keepGoing) this.schedule();
  };
}
