import * as THREE from 'three';
import { snapPoint, type Pt, type SnapResult } from '@figcad/core';
import { useUiStore } from '../state/uiStore';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const SNAP_PX = 12;
const GRID_MM = 100;
const DRAG_COMMIT_PX = 8;

/**
 * 단면선 — 평면에서 두 점(절단선 a→b)을 그어 단면 도면 뷰를 생성한다.
 * 요소가 아닌 'views' 채널 엔트리. 커밋 즉시 도면 패널을 그 단면으로 연다.
 * (DrawingPanel "+단면" 버튼이 이 도구를 활성화 — 평면에 선 긋기.)
 */
export class SectionTool implements Tool {
  private chainStart: Pt | null = null;
  private downClient: { x: number; y: number } | null = null;
  private preview: THREE.Line;
  private marker: THREE.Mesh;

  constructor(private ctx: EditorContext) {
    this.preview = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xc0392b }),
    );
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xc0392b }),
    );
    this.preview.visible = this.marker.visible = false;
    ctx.engine.scene.add(this.preview, this.marker);
  }

  down(info: ToolPointerInfo): void {
    if (!info.doc) return;
    const snap = this.snap(info);
    if (this.chainStart) this.commit(snap.point);
    else this.chainStart = snap.point;
    this.downClient = { x: info.clientX, y: info.clientY };
  }

  move(info: ToolPointerInfo): void {
    if (!info.doc) return;
    const snap = this.snap(info);
    this.updateMarker(snap, info.mmPerPixel);
    if (this.chainStart) this.updatePreview(this.chainStart, snap.point);
    this.ctx.engine.requestRender();
  }

  up(info: ToolPointerInfo): void {
    if (!this.chainStart || !this.downClient || !info.doc) return;
    const dragPx = Math.hypot(info.clientX - this.downClient.x, info.clientY - this.downClient.y);
    if (dragPx > DRAG_COMMIT_PX) {
      this.commit(this.snap(info).point);
      this.ctx.engine.requestRender();
    }
    this.downClient = null;
  }

  cancel(): void {
    this.chainStart = null;
    this.downClient = null;
    this.preview.visible = this.marker.visible = false;
    this.ctx.engine.requestRender();
  }

  enter(): void {
    this.cancel();
  }

  private commit(end: Pt): void {
    const start = this.chainStart!;
    const lenMm = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (lenMm >= 100) {
      const n = this.ctx.store.listViews().filter((v) => v.type === 'section').length + 1;
      const id = this.ctx.store.createView({ name: `단면 ${n}`, type: 'section', line: [start, end] });
      const ui = useUiStore.getState();
      ui.setActiveViewId(id);
      ui.setDrawingOpen(true);
      ui.setTool('select'); // 한 단면 긋고 종료
    }
    this.chainStart = null;
    this.preview.visible = this.marker.visible = false;
  }

  private snap(info: ToolPointerInfo): SnapResult {
    return snapPoint([info.doc![0], info.doc![1]], {
      endpoints: this.ctx.store.wallEndpoints(this.ctx.levelId()),
      endpointTolerance: SNAP_PX * info.mmPerPixel,
      grid: GRID_MM,
      ...(this.chainStart ? { axisFrom: this.chainStart } : {}),
    });
  }

  private updatePreview(a: Pt, b: Pt): void {
    const level = this.ctx.store.getLevel(this.ctx.levelId());
    const elev = (level?.elevation ?? 0) / 1000;
    this.preview.geometry.setFromPoints([
      new THREE.Vector3(a[0] / 1000, elev + 0.02, a[1] / 1000),
      new THREE.Vector3(b[0] / 1000, elev + 0.02, b[1] / 1000),
    ]);
    this.preview.visible = true;
  }

  private updateMarker(snap: SnapResult, mmPerPixel: number): void {
    const level = this.ctx.store.getLevel(this.ctx.levelId());
    const elev = (level?.elevation ?? 0) / 1000;
    this.marker.visible = true;
    this.marker.position.set(snap.point[0] / 1000, elev + 0.02, snap.point[1] / 1000);
    this.marker.scale.setScalar(Math.max((6 * mmPerPixel) / 1000, 0.01));
  }
}
