import * as THREE from 'three';
import { snapPoint, type Pt } from '@figcad/core';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const SNAP_PX = 12;
const GRID_MM = 500; // 구조 그리드는 500mm 스냅 (벽보다 굵게)

/** 구조 그리드 축선: 2점 클릭 — 라벨 자동(세로=숫자, 가로=알파벳) */
export class GridTool implements Tool {
  private start: Pt | null = null;
  private preview: THREE.Line;

  constructor(private ctx: EditorContext) {
    this.preview = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xc0392b }),
    );
    this.preview.visible = false;
    ctx.engine.scene.add(this.preview);
  }

  down(info: ToolPointerInfo): void {
    if (!info.doc) return;
    const p = this.snap(info);
    if (!this.start) {
      this.start = p;
    } else {
      try {
        this.ctx.store.createGridLine({ a: this.start, b: p });
      } catch {
        /* 0길이 무시 */
      }
      this.start = null;
      this.preview.visible = false;
      this.ctx.engine.requestRender();
    }
  }

  move(info: ToolPointerInfo): void {
    if (!info.doc || !this.start) return;
    const p = this.snap(info);
    const pts = [this.start, p].map(([x, y]) => new THREE.Vector3(x / 1000, 0.02, y / 1000));
    this.preview.geometry.setFromPoints(pts);
    this.preview.visible = true;
    this.ctx.engine.requestRender();
  }

  up(): void {}

  cancel(): void {
    this.start = null;
    this.preview.visible = false;
    this.ctx.engine.requestRender();
  }

  enter(): void {
    this.cancel();
  }

  private snap(info: ToolPointerInfo): Pt {
    return snapPoint([info.doc![0], info.doc![1]], {
      endpoints: this.ctx.store.wallEndpoints(this.ctx.levelId()),
      endpointTolerance: SNAP_PX * info.mmPerPixel,
      grid: GRID_MM,
      ...(this.start ? { axisFrom: this.start } : {}),
    }).point;
  }
}
