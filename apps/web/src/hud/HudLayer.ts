import * as THREE from 'three';
import { worldToScreen } from '../engine/Picker';

interface HudLabel {
  el: HTMLDivElement;
  anchor: THREE.Vector3;
}

/**
 * 명령형 DOM HUD (불변 규칙 3: React는 여기 못 들어온다).
 * 치수칩 + 원격 커서 이름표 + 토스트. 앵커(월드 좌표)를 기억하고
 * 매 렌더 프레임 reproject()로 재투영 — 카메라가 움직여도 따라붙는다.
 */
export class HudLayer {
  private chip: HTMLDivElement;
  private chipAnchor: THREE.Vector3 | null = null;
  private labels = new Map<string, HudLabel>();
  private toastEl: HTMLDivElement;
  private toastTimer: number | null = null;

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

    this.toastEl = document.createElement('div');
    this.toastEl.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:64px',
      'transform:translateX(-50%)',
      'padding:8px 16px',
      'border-radius:10px',
      'background:rgba(29,29,31,0.9)',
      'color:#fff',
      'font-size:13px',
      'font-weight:500',
      'pointer-events:none',
      'display:none',
      'z-index:30',
      'white-space:nowrap',
    ].join(';');
    document.body.appendChild(this.toastEl);
  }

  /** 치수칩 표시 — worldMid: 벽 중심선 중점 (m), lengthMm: 길이 */
  showDimension(worldMid: THREE.Vector3, lengthMm: number, camera: THREE.Camera): void {
    this.chipAnchor = worldMid.clone();
    this.chip.textContent = `${Math.round(lengthMm).toLocaleString('ko-KR')}`;
    this.chip.style.display = 'block';
    this.placeChip(camera);
  }

  hideDimension(): void {
    this.chipAnchor = null;
    this.chip.style.display = 'none';
  }

  /** 원격 커서 이름표 등 월드 앵커 라벨 */
  setLabel(key: string, text: string, color: string, world: THREE.Vector3): void {
    let label = this.labels.get(key);
    if (!label) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:fixed',
        'padding:2px 8px',
        'border-radius:999px',
        'color:#fff',
        'font-size:11px',
        'font-weight:600',
        'pointer-events:none',
        'transform:translate(10px,-50%)',
        'z-index:10',
        'white-space:nowrap',
        'box-shadow:0 1px 4px rgba(0,0,0,0.2)',
      ].join(';');
      document.body.appendChild(el);
      label = { el, anchor: world.clone() };
      this.labels.set(key, label);
    }
    label.el.textContent = text;
    label.el.style.background = color;
    label.anchor.copy(world);
  }

  removeLabel(key: string): void {
    const label = this.labels.get(key);
    if (label) {
      label.el.remove();
      this.labels.delete(key);
    }
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.style.display = 'block';
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.style.display = 'none';
    }, 2500);
  }

  /** Engine 렌더 프레임마다 호출 — 카메라 변화에 칩/라벨 추적 */
  reproject(camera: THREE.Camera): void {
    if (this.chipAnchor) this.placeChip(camera);
    for (const label of this.labels.values()) {
      const { x, y } = worldToScreen(label.anchor, camera);
      label.el.style.left = `${x}px`;
      label.el.style.top = `${y}px`;
    }
  }

  private placeChip(camera: THREE.Camera): void {
    const { x, y } = worldToScreen(this.chipAnchor!, camera);
    this.chip.style.left = `${x}px`;
    this.chip.style.top = `${y}px`;
  }
}
