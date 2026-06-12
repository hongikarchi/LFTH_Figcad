import * as THREE from 'three';
import { resolveOpening, type OpeningType, type WallElement, type WallType } from '@figcad/core';
import { pickElement } from '../engine/Picker';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

/**
 * 문/창 배치: 벽 호버 → 중심선에 투영된 위치에 고스트 → 탭/클릭으로 배치.
 * 구멍은 호스트 벽 파생이 뚫고, 이 도구는 OpeningElement만 생성한다.
 */
export class OpeningTool implements Tool {
  private ghost: THREE.Mesh;
  private hover: { wallId: string; offset: number } | null = null;

  constructor(
    private ctx: EditorContext,
    private openingKind: 'door' | 'window',
  ) {
    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0x0a84ff, transparent: true, opacity: 0.45 }),
    );
    this.ghost.visible = false;
    ctx.engine.scene.add(this.ghost);
  }

  down(): void {
    // 배치 확정은 up에서 (탭 의미론 — 드래그로 카메라 안 움직였을 때만)
  }

  move(info: ToolPointerInfo): void {
    this.updateHover(info);
  }

  up(info: ToolPointerInfo): void {
    this.updateHover(info);
    if (!this.hover) return;
    try {
      this.ctx.store.createOpening({
        hostId: this.hover.wallId,
        typeId: this.ctx.typeId(this.openingKind),
        offset: this.hover.offset,
      });
    } catch {
      this.ctx.hud.toast('이 위치에는 배치할 수 없습니다');
    }
  }

  cancel(): void {
    this.hover = null;
    this.ghost.visible = false;
    this.ctx.hud.hideDimension();
    this.ctx.engine.requestRender();
  }

  private clearHover(): void {
    this.hover = null;
    this.ghost.visible = false;
    this.ctx.hud.hideDimension();
    this.ctx.engine.requestRender();
  }

  private updateHover(info: ToolPointerInfo): void {
    const hit = pickElement(info.clientX, info.clientY, this.ctx.rig.active, this.ctx.scene.pickables);
    const el = hit ? this.ctx.store.getElement(hit) : undefined;
    if (el?.kind !== 'wall' || !info.doc) {
      this.clearHover();
      return;
    }
    const wall = el as WallElement;
    const type = this.ctx.store.getType(this.ctx.typeId(this.openingKind)) as
      | OpeningType
      | undefined;
    const hostType = this.ctx.store.getType(wall.typeId) as WallType | undefined;
    const level = this.ctx.store.getLevel(wall.levelId);
    if (!type || type.kind !== 'opening' || !hostType || !level) return;

    // 포인터를 중심선에 투영 → offset
    const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    if (len === 0) return;
    const dir = [(wall.b[0] - wall.a[0]) / len, (wall.b[1] - wall.a[1]) / len] as const;
    const rawOffset =
      (info.doc[0] - wall.a[0]) * dir[0] + (info.doc[1] - wall.a[1]) * dir[1];

    const H = wall.height ?? level.height;
    const r = resolveOpening(
      { ...emptyOpening, hostId: wall.id, typeId: type.id, offset: Math.round(rawOffset) },
      type,
      wall,
      H,
    );
    if (!r) {
      this.clearHover();
      return;
    }
    this.hover = { wallId: wall.id, offset: r.offset };

    // 고스트 박스 (벽 프레임 정렬)
    const MM = 0.001;
    const cx = (wall.a[0] + dir[0] * r.offset) * MM;
    const cz = (wall.a[1] + dir[1] * r.offset) * MM;
    const baseY = (level.elevation + (wall.baseOffset ?? 0)) * MM;
    this.ghost.visible = true;
    this.ghost.position.set(cx, baseY + (r.sill + r.height / 2) * MM, cz);
    this.ghost.scale.set(r.width * MM, r.height * MM, (hostType.thickness + 40) * MM);
    this.ghost.rotation.y = -Math.atan2(dir[1], dir[0]);
    this.ctx.engine.requestRender();

    this.ctx.hud.showDimension(
      new THREE.Vector3(cx, baseY + (r.sill + r.height) * MM, cz),
      r.offset,
      this.ctx.rig.active,
    );
  }
}

const emptyOpening = {
  id: '__ghost__',
  kind: 'opening' as const,
  hostId: '',
  typeId: '',
  offset: 0,
};
