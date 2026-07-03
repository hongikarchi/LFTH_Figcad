const DEAD_ZONE = 0.1; // 최대 이동 대비 10%

/**
 * 걷기 가상 조이스틱 (명령형 DOM — 불변 규칙 3). 좌하단 투명 히트존 안 터치다운 지점에
 * 베이스 스폰(플로팅 스틱, 모바일 FPS 관례). 존이 포인터를 캡처해 캔버스(카메라 룩)와 분리.
 * 크기·위치는 CSS(.walk-zone/.walk-stick — index.html, 폰은 body.device-phone 오버라이드).
 * 릴리즈 = 즉시 벡터 (0,0) 후 노브만 복귀 애니. onVector: -1..1, y+=전진.
 */
export class WalkJoystick {
  private zone: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLDivElement;
  private pointerId: number | null = null;
  private baseX = 0; // 존 로컬 베이스 중심(px)
  private baseY = 0;

  constructor(private onVector: (x: number, y: number) => void) {
    this.zone = document.createElement('div');
    this.zone.className = 'walk-zone';
    this.stick = document.createElement('div');
    this.stick.className = 'walk-stick';
    this.knob = document.createElement('div');
    this.knob.className = 'walk-stick-knob';
    this.stick.appendChild(this.knob);
    this.zone.appendChild(this.stick);
    this.zone.style.display = 'none';
    document.body.appendChild(this.zone);

    this.zone.addEventListener('pointerdown', this.onDown);
    this.zone.addEventListener('pointermove', this.onMove);
    this.zone.addEventListener('pointerup', this.onUp);
    this.zone.addEventListener('pointercancel', this.onUp);
    this.zone.addEventListener('contextmenu', (e) => e.preventDefault());
    // 회전/리사이즈 = 존(vw/vh) 크기 변화 — 지난 스폰 px 위치가 존 밖에 뜨는 표류 방지, 휴지 위치로 리셋
    window.addEventListener('resize', () => {
      if (this.pointerId === null) this.restStick();
    });
  }

  show(): void {
    this.zone.style.display = 'block';
    this.restStick();
  }

  hide(): void {
    this.zone.style.display = 'none';
    this.release();
  }

  destroy(): void {
    this.zone.remove();
  }

  /** 베이스/노브 크기는 CSS 소유 — 여기선 측정만 (폰/아이패드 분기 CSS 일원화) */
  private radius(): number {
    return this.stick.offsetWidth * 0.36; // 베이스 112px → R≈40, 폰 96px → R≈34
  }

  private onDown = (e: PointerEvent): void => {
    if (this.pointerId !== null) return; // 단일 포인터 스틱 — 추가 포인터 무시(캔버스 미전달)
    this.pointerId = e.pointerId;
    this.zone.setPointerCapture(e.pointerId);
    const zr = this.zone.getBoundingClientRect();
    const half = this.stick.offsetWidth / 2;
    // 플로팅 스폰: 베이스 = 터치 지점 그대로 (클램프 금지 — 가장자리 밴드서 클램프하면 터치다운
    // 순간 dx가 R을 초과해 드래그 없이 풀틸트 이동이 나감. 스틱이 존 밖으로 살짝 넘치는 건 무해).
    this.baseX = e.clientX - zr.left;
    this.baseY = e.clientY - zr.top;
    this.stick.style.left = `${this.baseX - half}px`;
    this.stick.style.top = `${this.baseY - half}px`;
    this.stick.classList.add('active');
    this.knob.classList.remove('settling');
    this.emit(e); // 베이스=터치점이므로 시작 벡터 (0,0)
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.emit(e);
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.release();
  };

  private release(): void {
    this.pointerId = null;
    this.onVector(0, 0); // 릴리즈 즉시 정지 (애니메이션 대기 없음)
    this.stick.classList.remove('active');
    this.knob.classList.add('settling');
    this.knob.style.transform = 'translate(0px, 0px)';
  }

  private restStick(): void {
    this.stick.classList.remove('active');
    this.knob.classList.remove('settling');
    this.knob.style.transform = 'translate(0px, 0px)';
    this.stick.style.left = '';
    this.stick.style.top = '';
  }

  private emit(e: PointerEvent): void {
    const zr = this.zone.getBoundingClientRect();
    const R = this.radius();
    let dx = e.clientX - zr.left - this.baseX;
    let dy = e.clientY - zr.top - this.baseY;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // 데드존 10% + 2차 반응곡선 (미세 조작 정밀·풀틸트 즉답)
    const curve = (v: number): number => (Math.abs(v) < DEAD_ZONE ? 0 : Math.sign(v) * v * v);
    this.onVector(curve(dx / R), curve(-dy / R));
  }
}
