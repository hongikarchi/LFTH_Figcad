import * as THREE from 'three';
import { snapPoint, type Element, type Pt, type SnapResult } from '@figcad/core';
import { pickElement, raycastPoint } from '../engine/Picker';
import type { EditorContext } from './context';
import type { ToolPointerInfo } from './ToolController';

const SNAP_PX = 12;
const GRID_MM = 100;

export interface LeaderResult {
  /** 지시선 시작점(앵커) — doc mm. 클릭1 위치. */
  anchor: Pt;
  /** 앵커에서 픽된 요소(있으면) — 라벨 targetId / 코멘트 anchorId 후보 */
  anchorEl: Element | null;
  /** 앵커 레벨 (요소 위면 그 요소 레벨, 아니면 활성 레벨) */
  anchorLevelId: string;
  /** 텍스트/말풍선 위치 — doc mm. 클릭2 위치. */
  textAt: Pt;
  /** 클릭2가 오버레이/메시 표면을 맞혔으면 그 3D 높이(월드 mm) — 3D 코멘트 핀. 평면 바닥이면 undefined. */
  textZ?: number;
}

/**
 * 2클릭 지시선(leader) 캡처 — 클릭1=지시선 시작점(앵커), 클릭2=텍스트 위치 (iter-2 3-2).
 * 레이블·코멘트가 공유(같은 생성 UX, 색만 다름: 레이블=주황, 코멘트=파랑).
 * up마다 단계 진행, onComplete(result) 후 리셋. cancel/enter = 취소. 입력잠금은 호출 도구가 게이트.
 */
export class LeaderCapture {
  private marker: THREE.Mesh;
  private line: THREE.Line;
  private anchor: { pt: Pt; el: Element | null; levelId: string } | null = null;

  constructor(
    private ctx: EditorContext,
    color: number,
    private onComplete: (r: LeaderResult) => void,
  ) {
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color }),
    );
    this.marker.visible = false;
    this.line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color }));
    this.line.visible = false;
    ctx.engine.scene.add(this.marker, this.line);
  }

  /** true = 지시선 시작점 대기(클릭1 전), false = 텍스트 위치 대기(클릭1 후) */
  get awaitingAnchor(): boolean {
    return this.anchor === null;
  }

  move(info: ToolPointerInfo): void {
    if (!info.doc) return;
    const pt = this.snap(info).point;
    this.updateMarker(pt, info.mmPerPixel);
    if (this.anchor) this.updateLine(pt);
    this.ctx.engine.requestRender();
  }

  up(info: ToolPointerInfo): void {
    if (!info.doc) return;
    const pt = this.snap(info).point;
    if (!this.anchor) {
      // 클릭1 = 지시선 시작점 (요소 위면 그 요소를 앵커로)
      const hit = pickElement(info.clientX, info.clientY, this.ctx.rig.active, this.ctx.scene.pickables);
      const el = hit ? (this.ctx.store.getElement(hit) ?? null) : null;
      const levelId = el && 'levelId' in el ? el.levelId : this.ctx.levelId();
      this.anchor = { pt, el, levelId };
      this.line.visible = true;
      this.updateLine(pt);
      this.ctx.engine.requestRender();
      return;
    }
    // 클릭2 = 텍스트/핀 위치 → 완료. 오버레이·메시 표면을 맞히면 그 3D점(높이 z 포함) = 3D 코멘트.
    const a = this.anchor;
    let textAt = pt;
    let textZ: number | undefined;
    const roots = this.ctx.overlayRoot ? [this.ctx.overlayRoot, ...this.ctx.scene.pickables] : this.ctx.scene.pickables;
    const p3d = raycastPoint(info.clientX, info.clientY, this.ctx.rig.active, roots);
    if (p3d) {
      textAt = [Math.round(p3d.x * 1000), Math.round(p3d.z * 1000)];
      textZ = p3d.y * 1000;
    }
    this.reset();
    this.onComplete({ anchor: a.pt, anchorEl: a.el, anchorLevelId: a.levelId, textAt, ...(textZ !== undefined ? { textZ } : {}) });
  }

  cancel(): void {
    this.reset();
    this.ctx.engine.requestRender();
  }

  /** 마커·지시선·단계 초기화 (완료/취소 공통) */
  reset(): void {
    this.anchor = null;
    this.marker.visible = false;
    this.line.visible = false;
  }

  private snap(info: ToolPointerInfo): SnapResult {
    return snapPoint([info.doc![0], info.doc![1]], {
      endpoints: this.ctx.store.wallEndpoints(this.ctx.levelId()),
      endpointTolerance: SNAP_PX * info.mmPerPixel,
      grid: GRID_MM,
    });
  }

  private anchorElev(): number {
    return (this.ctx.store.getLevel(this.anchor?.levelId ?? this.ctx.levelId())?.elevation ?? 0) / 1000;
  }

  private updateMarker(pt: Pt, mmPerPixel: number): void {
    const elev = (this.ctx.store.getLevel(this.ctx.levelId())?.elevation ?? 0) / 1000;
    this.marker.visible = true;
    this.marker.position.set(pt[0] / 1000, elev + 0.02, pt[1] / 1000);
    this.marker.scale.setScalar(Math.max((6 * mmPerPixel) / 1000, 0.01));
  }

  private updateLine(cursor: Pt): void {
    if (!this.anchor) return;
    const elev = this.anchorElev() + 0.02;
    const a = this.anchor.pt;
    this.line.geometry.setFromPoints([
      new THREE.Vector3(a[0] / 1000, elev, a[1] / 1000),
      new THREE.Vector3(cursor[0] / 1000, elev, cursor[1] / 1000),
    ]);
  }
}
