import type { Pt } from '@figcad/core';

export interface ToolPointerInfo {
  /** 지면 평면 교차점 (문서 mm), 교차 없으면 null */
  doc: Pt | null;
  clientX: number;
  clientY: number;
  /** 화면 1px당 문서 mm — 스냅 톨러런스 환산용 */
  mmPerPixel: number;
}

export interface Tool {
  down(info: ToolPointerInfo): void;
  move(info: ToolPointerInfo): void;
  up(info: ToolPointerInfo): void;
  /** Esc/도구 전환 시 정리 */
  cancel(): void;
  /** Rhino RMB 클릭(드래그 없음) = Enter 의미론 — 체인 종료/확정 */
  enter?(): void;
}

/** 활성 도구 라우터. InputManager가 펜/마우스좌클릭 이벤트를 여기로 보낸다. */
export class ToolController {
  private tools = new Map<string, Tool>();
  private activeName = '';

  register(name: string, tool: Tool): void {
    this.tools.set(name, tool);
  }

  setActive(name: string): void {
    if (name === this.activeName) return;
    this.tools.get(this.activeName)?.cancel();
    this.activeName = name;
  }

  get active(): Tool | undefined {
    return this.tools.get(this.activeName);
  }

  cancel(): void {
    this.active?.cancel();
  }

  enter(): void {
    this.active?.enter?.();
  }
}
