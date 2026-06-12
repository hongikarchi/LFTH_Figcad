import * as THREE from 'three';
import { worldToScreen } from '../engine/Picker';

/**
 * 명령형 DOM HUD (불변 규칙 3: React는 여기 못 들어온다).
 * M1: 치수칩 1개. M2+: 원격 커서 이름표, 스냅 글리프 추가.
 */
export class HudLayer {
  private chip: HTMLDivElement;

  constructor() {
    this.chip = document.createElement('div');
    this.chip.style.cssText = [
      'position:fixed',
      'padding:3px 8px',
      'border-radius:6px',
      'background:rgba(20,24,30,0.85)',
      'color:#fff',
      'font-size:13px',
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
    const { x, y } = worldToScreen(worldMid, camera);
    this.chip.style.left = `${x}px`;
    this.chip.style.top = `${y}px`;
    this.chip.textContent = `${Math.round(lengthMm).toLocaleString('ko-KR')}`;
    this.chip.style.display = 'block';
  }

  hideDimension(): void {
    this.chip.style.display = 'none';
  }
}
