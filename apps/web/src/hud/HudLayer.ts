import * as THREE from 'three';
import { worldToScreen } from '../engine/Picker';

/**
 * 명령형 DOM HUD (불변 규칙 3: React는 여기 못 들어온다).
 * 앵커(월드 좌표)를 기억하고 매 렌더 프레임 reproject()로 재투영 —
 * 칩이 떠 있는 동안 카메라가 움직여도 따라붙는다.
 */
export class HudLayer {
  private chip: HTMLDivElement;
  private anchor: THREE.Vector3 | null = null;

  constructor() {
    this.chip = document.createElement('div');
    this.chip.style.cssText = [
      'position:fixed',
      'padding:4px 10px',
      'border-radius:999px',
      'background:rgba(255,255,255,0.92)',
      'border:1px solid rgba(0,0,0,0.1)',
      'box-shadow:0 2px 8px rgba(0,0,0,0.12)',
      'color:#1d1d1f',
      'font-size:13px',
      'font-weight:600',
      'font-variant-numeric:tabular-nums',
      'pointer-events:none',
      'transform:translate(-50%,-150%)',
      'display:none',
      'z-index:10',
      'white-space:nowrap',
    ].join(';');
    document.body.appendChild(this.chip);
  }

  /** 치수칩 표시 — worldMid: 벽 중심선 중점 (m), lengthMm: 길이 */
  showDimension(worldMid: THREE.Vector3, lengthMm: number, camera: THREE.Camera): void {
    this.anchor = worldMid.clone();
    this.chip.textContent = `${Math.round(lengthMm).toLocaleString('ko-KR')}`;
    this.chip.style.display = 'block';
    this.place(camera);
  }

  hideDimension(): void {
    this.anchor = null;
    this.chip.style.display = 'none';
  }

  /** Engine 렌더 프레임마다 호출 — 카메라 변화에 칩 추적 */
  reproject(camera: THREE.Camera): void {
    if (this.anchor) this.place(camera);
  }

  private place(camera: THREE.Camera): void {
    const { x, y } = worldToScreen(this.anchor!, camera);
    this.chip.style.left = `${x}px`;
    this.chip.style.top = `${y}px`;
  }
}
