import * as THREE from 'three';
import { snapPoint, type Pt } from '@figcad/core';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const SNAP_PX = 12;
const GRID_MM = 100;
const CLOSE_PX = 14; // 첫 점 근처 클릭 = 폴리곤 닫기

/**
 * 슬라브: 폴리곤 꼭짓점 클릭 체인 → 첫 점 클릭/Enter(우클릭)로 닫기.
 * 자가교차는 즉시 거부(토스트).
 */
export class SlabTool implements Tool {
  private points: Pt[] = [];
  private preview: THREE.Line;
  private marker: THREE.Mesh;

  constructor(private ctx: EditorContext) {
    this.preview = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x0a84ff }),
    );
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x0a84ff }),
    );
    this.preview.visible = this.marker.visible = false;
    ctx.engine.scene.add(this.preview, this.marker);
  }

  down(): void {}

  move(info: ToolPointerInfo): void {
    if (!info.doc) return;
    const snap = this.snap(info);
    this.updateMarker(snap, info.mmPerPixel);
    this.updatePreview(snap);
    this.ctx.engine.requestRender();
  }

  up(info: ToolPointerInfo): void {
    if (!info.doc) return;
    const snap = this.snap(info);

    // 첫 점 근처 클릭 = 닫기
    if (this.points.length >= 3) {
      const first = this.points[0]!;
      const distMm = Math.hypot(snap[0] - first[0], snap[1] - first[1]);
      if (distMm <= CLOSE_PX * info.mmPerPixel) {
        this.commit();
        return;
      }
    }

    // 퇴화 가드: 기존 꼭짓점과 같거나 마지막 점에서 50mm 미만이면 무시
    // (자기 점이 스냅 후보라 정확히 같은 좌표가 쉽게 나옴 — 0면적 슬라브 방지)
    if (this.points.some(([x, y]) => x === snap[0] && y === snap[1])) return;
    const last = this.points[this.points.length - 1];
    if (last && Math.hypot(snap[0] - last[0], snap[1] - last[1]) < 50) return;

    this.points.push(snap); // 자가교차는 commit 시 isSimplePolygon으로 최종 검증
    // 펜/터치 탭은 후속 move가 없어 미리보기가 stale — 커밋한 정점까지 즉시 재렌더
    this.updatePreview();
    this.updateMarker(snap, info.mmPerPixel);
    this.ctx.engine.requestRender();
  }

  cancel(): void {
    this.points = [];
    this.preview.visible = this.marker.visible = false;
    this.ctx.hud.hideDimension();
    this.ctx.engine.requestRender();
  }

  /** Rhino RMB 클릭 = Enter — 폴리곤 닫기 */
  enter(): void {
    if (this.points.length >= 3) this.commit();
    else this.cancel();
  }

  private commit(): void {
    try {
      this.ctx.store.createSlab({
        levelId: this.ctx.levelId(),
        typeId: this.ctx.typeId('slab'),
        boundary: this.points,
      });
    } catch {
      this.ctx.hud.toast('자가교차 폴리곤은 만들 수 없습니다');
    }
    this.cancel();
  }

  private snap(info: ToolPointerInfo): Pt {
    return snapPoint([info.doc![0], info.doc![1]], {
      endpoints: [
        ...this.ctx.store.wallEndpoints(this.ctx.levelId()),
        ...this.points, // 자기 꼭짓점(첫 점 닫기 포함)도 후보
      ],
      endpointTolerance: SNAP_PX * info.mmPerPixel,
      grid: GRID_MM,
      ...(this.points.length
        ? { axisFrom: this.points[this.points.length - 1]! }
        : {}),
    }).point;
  }

  // current 생략(커밋 직후) = 확정 정점들만 그림 — 중복점/0mm 치수칩 방지
  private updatePreview(current?: Pt): void {
    if (!this.points.length) {
      this.preview.visible = false;
      return;
    }
    const elev = (this.ctx.store.getLevel(this.ctx.levelId())?.elevation ?? 0) / 1000;
    const ptsMm = current ? [...this.points, current] : this.points;
    const pts = ptsMm.map(([x, y]) => new THREE.Vector3(x / 1000, elev + 0.03, y / 1000));
    this.preview.geometry.setFromPoints(pts);
    this.preview.visible = true;

    if (!current) {
      this.ctx.hud.hideDimension();
      return;
    }
    const last = this.points[this.points.length - 1]!;
    const lenMm = Math.hypot(current[0] - last[0], current[1] - last[1]);
    const mid = new THREE.Vector3(
      (current[0] + last[0]) / 2000,
      elev + 0.03,
      (current[1] + last[1]) / 2000,
    );
    this.ctx.hud.showDimension(mid, lenMm, this.ctx.rig.active);
  }

  private updateMarker(p: Pt, mmPerPixel: number): void {
    const elev = (this.ctx.store.getLevel(this.ctx.levelId())?.elevation ?? 0) / 1000;
    this.marker.visible = true;
    this.marker.position.set(p[0] / 1000, elev + 0.03, p[1] / 1000);
    this.marker.scale.setScalar(Math.max((6 * mmPerPixel) / 1000, 0.01));
  }
}
