import * as THREE from 'three';
import { snapPoint, type SnapResult } from '@figcad/core';
import { pickElement } from '../engine/Picker';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const SNAP_PX = 12;
const GRID_MM = 100;

/**
 * 코멘트 도구 — 평면 점 클릭 → (요소 위면 그 요소에 앵커링) → 떠있는 입력 → addComment.
 * 앵커된 코멘트는 요소가 움직이면 따라가고, 삭제돼도 fallback 위치로 남는다.
 */
export class CommentTool implements Tool {
  private marker: THREE.Mesh;
  private editing = false;

  constructor(private ctx: EditorContext) {
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x0a84ff }),
    );
    this.marker.visible = false;
    ctx.engine.scene.add(this.marker);
  }

  down(): void {}

  move(info: ToolPointerInfo): void {
    if (!info.doc || this.editing) return;
    this.updateMarker(this.snap(info), info.mmPerPixel);
    this.ctx.engine.requestRender();
  }

  // up에서 입력창 (down은 mouseup이 포커스 강탈)
  up(info: ToolPointerInfo): void {
    if (!info.doc || this.editing) return;
    const at = this.snap(info).point;
    // 요소 위 클릭이면 앵커링 (세그먼트=가까운 끝점, 기둥=at). 그 외=자유 코멘트.
    let anchorId: string | undefined;
    let anchorWhich: 'a' | 'b' | undefined;
    let levelId = this.ctx.levelId();
    const hit = pickElement(info.clientX, info.clientY, this.ctx.rig.active, this.ctx.scene.pickables);
    if (hit) {
      const el = this.ctx.store.getElement(hit);
      if (el && 'a' in el && 'b' in el) {
        anchorId = el.id;
        const da = Math.hypot(at[0] - el.a[0], at[1] - el.a[1]);
        const db = Math.hypot(at[0] - el.b[0], at[1] - el.b[1]);
        anchorWhich = da <= db ? 'a' : 'b';
        if ('levelId' in el) levelId = el.levelId;
      } else if (el?.kind === 'column') {
        anchorId = el.id;
        anchorWhich = 'a';
        levelId = el.levelId;
      }
    }
    const elev = (this.ctx.store.getLevel(levelId)?.elevation ?? 0) / 1000;
    const world = new THREE.Vector3(at[0] / 1000, elev + 0.05, at[1] / 1000);
    const author = localStorage.getItem('figcad.userName') ?? '게스트';
    this.editing = true;
    this.marker.visible = false;
    void this.ctx.hud.promptText(world, this.ctx.rig.active).then((text) => {
      this.editing = false;
      if (text) {
        this.ctx.store.addComment({
          levelId,
          at,
          author,
          text,
          ...(anchorId ? { anchorId } : {}),
          ...(anchorWhich ? { anchorWhich } : {}),
        });
        this.ctx.engine.requestRender();
      }
    });
  }

  cancel(): void {
    this.marker.visible = false;
    this.ctx.engine.requestRender();
  }

  private snap(info: ToolPointerInfo): SnapResult {
    return snapPoint([info.doc![0], info.doc![1]], {
      endpoints: this.ctx.store.wallEndpoints(this.ctx.levelId()),
      endpointTolerance: SNAP_PX * info.mmPerPixel,
      grid: GRID_MM,
    });
  }

  private updateMarker(snap: SnapResult, mmPerPixel: number): void {
    const elev = (this.ctx.store.getLevel(this.ctx.levelId())?.elevation ?? 0) / 1000;
    this.marker.visible = true;
    this.marker.position.set(snap.point[0] / 1000, elev + 0.05, snap.point[1] / 1000);
    this.marker.scale.setScalar(Math.max((6 * mmPerPixel) / 1000, 0.01));
  }
}
