import * as THREE from 'three';
import { snapPoint, type Pt, type SnapResult } from '@figcad/core';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const SNAP_PX = 12;
const GRID_MM = 100;
const DRAG_COMMIT_PX = 8;
const DEFAULT_OFFSET = 500;

const MARKER_COLORS: Record<SnapResult['kind'], number> = {
  endpoint: 0xff9500, // 끝점 스냅 = 바인딩 캡처(이동 추종)
  grid: 0x0a84ff,
  none: 0x1d1d1f,
};

/**
 * 치수선 — 두 점 클릭(또는 펜 드래그). 끝점이 요소 끝점에 스냅되면 createDimension이
 * mm-정확 일치로 바인딩을 자동 캡처(요소 이동 시 치수 추종). offset은 기본값, InfoBox에서 조정.
 */
export class DimensionTool implements Tool {
  private chainStart: Pt | null = null;
  private downClient: { x: number; y: number } | null = null;
  private preview: THREE.Line;
  private marker: THREE.Mesh;

  constructor(private ctx: EditorContext) {
    this.preview = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x0a84ff }),
    );
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
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
      this.marker.visible = false;
      this.ctx.engine.requestRender();
    }
    this.downClient = null;
  }

  cancel(): void {
    this.chainStart = null;
    this.downClient = null;
    this.preview.visible = this.marker.visible = false;
    this.ctx.hud.hideDimension();
    this.ctx.engine.requestRender();
  }

  enter(): void {
    this.cancel();
  }

  private commit(end: Pt): void {
    const start = this.chainStart!;
    const lenMm = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (lenMm >= 50) {
      try {
        this.ctx.store.createDimension({
          levelId: this.ctx.levelId(),
          a: start,
          b: end,
          offset: DEFAULT_OFFSET,
        });
      } catch {
        /* zero-length 등 — 무시 */
      }
    }
    this.chainStart = null;
    this.preview.visible = false;
    this.ctx.hud.hideDimension();
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
    const lenMm = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mid = new THREE.Vector3((a[0] + b[0]) / 2000, elev + 0.02, (a[1] + b[1]) / 2000);
    this.ctx.hud.showDimension(mid, lenMm, this.ctx.rig.active);
  }

  private updateMarker(snap: SnapResult, mmPerPixel: number): void {
    const level = this.ctx.store.getLevel(this.ctx.levelId());
    const elev = (level?.elevation ?? 0) / 1000;
    this.marker.visible = true;
    this.marker.position.set(snap.point[0] / 1000, elev + 0.02, snap.point[1] / 1000);
    this.marker.scale.setScalar(Math.max((6 * mmPerPixel) / 1000, 0.01));
    (this.marker.material as THREE.MeshBasicMaterial).color.setHex(MARKER_COLORS[snap.kind]);
  }
}
