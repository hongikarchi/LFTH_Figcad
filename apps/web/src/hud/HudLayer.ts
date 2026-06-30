import * as THREE from 'three';
import { worldToScreen } from '../engine/Picker';

interface HudLabel {
  el: HTMLDivElement;
  anchor: THREE.Vector3;
}

export interface CommentBubble {
  id: string;
  text: string;
  world: THREE.Vector3;
  resolved: boolean;
}

/** 스케일바용 "라운드" 길이 — 1/2/5 × 10ⁿ (m). 도면 축척 표기 관례. */
function niceLength(meters: number): number {
  if (!isFinite(meters) || meters <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(meters)));
  const f = meters / pow;
  const nice = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return nice * pow;
}

/** 1234.5 → "1,235", 0.5 → "0.5" (정수면 천단위 콤마, 소수면 그대로) */
function formatNum(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : String(n);
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
  private bubbles = new Map<string, HudLabel>(); // 코멘트 말풍선 (월드 앵커 + reproject 추종)
  private toastEl: HTMLDivElement;
  private toastTimer: number | null = null;
  private dragBox: HTMLDivElement;
  // 뷰포트 위젯 (iter-2 4) — 스케일바(줌 실시간) + 방위표(읽기전용). 캔버스 우하단, 명령형.
  private scaleBar: HTMLDivElement;
  private scaleLabel: HTMLSpanElement;
  private northRot: HTMLDivElement;
  private lastScaleLabel = '';

  constructor() {
    this.dragBox = document.createElement('div');
    this.dragBox.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'display:none',
      'z-index:9',
      'background:rgba(10,132,255,0.08)',
    ].join(';');
    document.body.appendChild(this.dragBox);
    this.chip = document.createElement('div');
    this.chip.className = 'hud-chip'; // 치수/측정 칩 — 식별용(스타일은 인라인)
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

    // 뷰포트 위젯 컨테이너 (우하단, ViewportCluster 위) — 방위표 + 스케일바
    const widgets = document.createElement('div');
    widgets.className = 'viewport-widgets';
    // 방위표 — 회전하는 N 화살표(읽기전용)
    const north = document.createElement('div');
    north.className = 'vw-north';
    this.northRot = document.createElement('div');
    this.northRot.className = 'vw-north-rot';
    this.northRot.innerHTML = '<span class="vw-n">N</span><span class="vw-arrow">▲</span>';
    north.appendChild(this.northRot);
    // 스케일바 — 눈금 막대 + 라벨(줌 실시간)
    const scale = document.createElement('div');
    scale.className = 'vw-scale';
    this.scaleBar = document.createElement('div');
    this.scaleBar.className = 'vw-scale-bar';
    this.scaleLabel = document.createElement('span');
    this.scaleLabel.className = 'vw-scale-label';
    scale.append(this.scaleBar, this.scaleLabel);
    widgets.append(north, scale);
    document.body.appendChild(widgets);
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

  /**
   * 코멘트 말풍선 동기 (iter-2 1-2) — 화면에 코멘트 텍스트를 말풍선으로 표시.
   * 월드 앵커(at)에 떠있는 DOM, reproject로 카메라 추종. 명령형(불변 규칙 3 — React 아님).
   * SceneManager.syncComments가 루트 코멘트마다 호출(빈 배열=전부 제거).
   */
  setCommentBubbles(list: CommentBubble[]): void {
    const seen = new Set<string>();
    for (const b of list) {
      seen.add(b.id);
      let bubble = this.bubbles.get(b.id);
      if (!bubble) {
        const el = document.createElement('div');
        el.className = 'hud-comment-bubble';
        el.style.cssText = [
          'position:fixed',
          'max-width:180px',
          'padding:5px 9px',
          'border-radius:10px',
          'background:rgba(255,255,255,0.95)',
          'border:1px solid rgba(10,132,255,0.35)',
          'color:#1d1d1f',
          'font-size:11px',
          'font-weight:500',
          'line-height:1.35',
          'pointer-events:none',
          'transform:translate(10px,-120%)',
          'z-index:11',
          'box-shadow:0 2px 8px rgba(0,0,0,0.14)',
          'overflow:hidden',
          'text-overflow:ellipsis',
          'white-space:nowrap',
        ].join(';');
        document.body.appendChild(el);
        bubble = { el, anchor: b.world.clone() };
        this.bubbles.set(b.id, bubble);
      }
      bubble.el.textContent = b.text;
      bubble.el.style.opacity = b.resolved ? '0.5' : '1';
      bubble.anchor.copy(b.world);
    }
    for (const [id, bubble] of this.bubbles) {
      if (seen.has(id)) continue;
      bubble.el.remove();
      this.bubbles.delete(id);
    }
  }

  /**
   * 드래그 선택 박스 — 화면 px. crossing(우→좌)=점선, window(좌→우)=실선 (Rhino).
   */
  showDragBox(x1: number, y1: number, x2: number, y2: number, crossing: boolean): void {
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    this.dragBox.style.left = `${left}px`;
    this.dragBox.style.top = `${top}px`;
    this.dragBox.style.width = `${Math.abs(x2 - x1)}px`;
    this.dragBox.style.height = `${Math.abs(y2 - y1)}px`;
    this.dragBox.style.border = crossing
      ? '1px dashed rgba(10,132,255,0.9)'
      : '1px solid rgba(10,132,255,0.9)';
    this.dragBox.style.display = 'block';
  }

  hideDragBox(): void {
    this.dragBox.style.display = 'none';
  }

  /**
   * 떠있는 텍스트 입력 (텍스트 주석용) — 캔버스에 타이핑 불가하므로 DOM input.
   * 월드 앵커 위치에 클린 B&W 알약. Enter=확정, Esc/빈값=취소. Promise로 결과.
   * keydown stopPropagation으로 전역 단축키(undo 등) 오발 방지.
   */
  promptText(world: THREE.Vector3, camera: THREE.Camera, initial = ''): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = initial;
      input.style.cssText = [
        'position:fixed',
        'transform:translate(-50%,-50%)',
        'padding:4px 10px',
        'border-radius:8px',
        'border:1px solid rgba(10,132,255,0.9)',
        'background:rgba(255,255,255,0.98)',
        'color:#1d1d1f',
        'font-size:14px',
        'font-weight:500',
        'outline:none',
        'box-shadow:0 2px 10px rgba(0,0,0,0.18)',
        'z-index:40',
        'min-width:80px',
      ].join(';');
      const { x, y } = worldToScreen(world, camera);
      input.style.left = `${x}px`;
      input.style.top = `${y}px`;
      document.body.appendChild(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (val: string | null) => {
        if (done) return;
        done = true;
        input.remove();
        resolve(val);
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(input.value.trim() || null);
        else if (e.key === 'Escape') finish(null);
      });
      input.addEventListener('blur', () => finish(input.value.trim() || null));
    });
  }

  /**
   * 뷰포트 위젯 갱신 (iter-2 4) — 매 프레임(main 렌더 루프). 명령형(불변 규칙 3).
   * 스케일바 = 화면 ~80px에 맞는 "라운드" 거리(1/2/5×10ⁿ), 줌하면 실시간 변화.
   * 방위표 = 북(화면 각도)으로 화살표 회전(읽기전용).
   */
  updateViewportWidgets(worldPerPixel: number, northAngleRad: number): void {
    // 스케일바
    const targetPx = 80;
    const nice = niceLength(targetPx * worldPerPixel); // m
    const barPx = Math.round(nice / worldPerPixel);
    this.scaleBar.style.width = `${barPx}px`;
    const label = nice >= 1 ? `${formatNum(nice)} m` : `${formatNum(nice * 1000)} mm`;
    if (label !== this.lastScaleLabel) {
      this.scaleLabel.textContent = label;
      this.lastScaleLabel = label;
    }
    // 방위표 — 심볼 북(위, 화면각 -90°)을 실제 북(northAngleRad)에 정렬: 회전 = deg + 90
    const deg = (northAngleRad * 180) / Math.PI + 90;
    this.northRot.style.transform = `rotate(${deg}deg)`;
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.style.display = 'block';
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.style.display = 'none';
    }, 2500);
  }

  /** Engine 렌더 프레임마다 호출 — 카메라 변화에 칩/라벨/말풍선 추적 */
  reproject(camera: THREE.Camera): void {
    if (this.chipAnchor) this.placeChip(camera);
    // 앵커가 절두체 밖(특히 카메라 뒤)이면 project()가 미러 좌표 반환 → 숨김(고스트 방지).
    for (const label of this.labels.values()) {
      const { x, y, z } = worldToScreen(label.anchor, camera);
      const vis = z >= -1 && z <= 1;
      label.el.style.display = vis ? '' : 'none';
      if (vis) { label.el.style.left = `${x}px`; label.el.style.top = `${y}px`; }
    }
    for (const bubble of this.bubbles.values()) {
      const { x, y, z } = worldToScreen(bubble.anchor, camera);
      const vis = z >= -1 && z <= 1;
      bubble.el.style.display = vis ? '' : 'none';
      if (vis) { bubble.el.style.left = `${x}px`; bubble.el.style.top = `${y}px`; }
    }
  }

  private placeChip(camera: THREE.Camera): void {
    const { x, y, z } = worldToScreen(this.chipAnchor!, camera);
    const vis = z >= -1 && z <= 1;
    this.chip.style.display = vis ? '' : 'none';
    if (vis) { this.chip.style.left = `${x}px`; this.chip.style.top = `${y}px`; }
  }
}
