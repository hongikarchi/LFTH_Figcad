import * as THREE from 'three';
import { snapPoint, type SnapResult } from '@figcad/core';
import { pickElement } from '../engine/Picker';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const SNAP_PX = 12;
const GRID_MM = 100;

/**
 * 레이블(Revit 태그) 도구 — 점 클릭:
 *   요소 위 = 그 요소를 타깃으로 자동 라벨 (존=면적, 그 외=이름/타입명) + 지시선.
 *   빈 곳 = 떠있는 입력으로 자유 custom 노트.
 * 타깃 추종·고아 fallback은 파생(deriveLabel)에서. CommentTool 앵커 패턴 재사용.
 */
export class LabelTool implements Tool {
  private marker: THREE.Mesh;
  private editing = false;

  constructor(private ctx: EditorContext) {
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff9500 }),
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

  // up에서 처리 (down의 mouseup이 입력창 포커스 강탈)
  up(info: ToolPointerInfo): void {
    if (!info.doc || this.editing) return;
    const at = this.snap(info).point;
    let levelId = this.ctx.levelId();
    const hit = pickElement(info.clientX, info.clientY, this.ctx.rig.active, this.ctx.scene.pickables);
    const target = hit ? this.ctx.store.getElement(hit) : undefined;
    // 자기 자신(라벨)·코멘트류는 타깃으로 안 씀
    if (target && target.kind !== 'label') {
      if ('levelId' in target) levelId = target.levelId;
      const template = target.kind === 'zone' ? 'area' : 'name';
      this.ctx.store.createLabel({ levelId, at, targetId: target.id, template, leader: true });
      this.marker.visible = false; // 펜 탭은 후속 hover move가 없어 마커가 남음 — 즉시 숨김
      this.ctx.engine.requestRender();
      return;
    }
    // 빈 곳 = 자유 custom 노트 (텍스트 입력)
    const elev = (this.ctx.store.getLevel(levelId)?.elevation ?? 0) / 1000;
    const world = new THREE.Vector3(at[0] / 1000, elev + 0.02, at[1] / 1000);
    this.editing = true;
    this.marker.visible = false;
    void this.ctx.hud.promptText(world, this.ctx.rig.active).then((text) => {
      this.editing = false;
      if (text) {
        this.ctx.store.createLabel({ levelId, at, template: 'custom', customText: text });
        this.ctx.engine.requestRender();
      }
    });
  }

  cancel(): void {
    this.marker.visible = false;
    this.ctx.engine.requestRender();
  }

  enter(): void {
    this.cancel();
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
    this.marker.position.set(snap.point[0] / 1000, elev + 0.02, snap.point[1] / 1000);
    this.marker.scale.setScalar(Math.max((6 * mmPerPixel) / 1000, 0.01));
  }
}
