import * as THREE from 'three';
import { snapPoint, type Pt } from '@figcad/core';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const SNAP_PX = 12;
const GRID_MM = 100;
const CLOSE_PX = 14;

/**
 * 존(공간): 폴리곤 꼭짓점 클릭 체인 → 첫 점/Enter(우클릭)로 닫기 (SlabTool과 동일 UX).
 * 타입 없음 — 자동 이름(공간 N) 부여 후 InfoBox에서 이름/번호 편집. 면적은 자동 계산.
 */
export class ZoneTool implements Tool {
  private points: Pt[] = [];
  private preview: THREE.Line;
  private marker: THREE.Mesh;

  constructor(private ctx: EditorContext) {
    this.preview = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x34a853 }),
    );
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x34a853 }),
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
    if (this.points.length >= 3) {
      const first = this.points[0]!;
      if (Math.hypot(snap[0] - first[0], snap[1] - first[1]) <= CLOSE_PX * info.mmPerPixel) {
        this.commit();
        return;
      }
    }
    if (this.points.some(([x, y]) => x === snap[0] && y === snap[1])) return;
    const last = this.points[this.points.length - 1];
    if (last && Math.hypot(snap[0] - last[0], snap[1] - last[1]) < 50) return;
    this.points.push(snap);
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

  enter(): void {
    if (this.points.length >= 3) this.commit();
    else this.cancel();
  }

  private commit(): void {
    try {
      const n = this.ctx.store.listElements().filter((e) => e.kind === 'zone').length + 1;
      this.ctx.store.createZone({ levelId: this.ctx.levelId(), boundary: this.points, name: `공간 ${n}` });
    } catch {
      this.ctx.hud.toast('자가교차 폴리곤은 만들 수 없습니다');
    }
    this.cancel();
  }

  private snap(info: ToolPointerInfo): Pt {
    return snapPoint([info.doc![0], info.doc![1]], {
      endpoints: [
        ...this.ctx.store.wallEndpoints(this.ctx.levelId()),
        ...this.points,
        ...(this.ctx.importSnapCandidates?.([info.doc![0], info.doc![1]], SNAP_PX * info.mmPerPixel) ?? []), // 빽도면 끝점 트레이싱
      ],
      endpointTolerance: SNAP_PX * info.mmPerPixel,
      grid: GRID_MM,
      ...(this.points.length ? { axisFrom: this.points[this.points.length - 1]! } : {}),
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
    // three 0.184 setFromPoints는 기존 attribute 재사용(첫 호출 정점수 고정) → 정점 늘면 잘림+경고. 재생성.
    const prevGeo = this.preview.geometry;
    this.preview.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    prevGeo.dispose();
    this.preview.visible = true;
    if (!current) {
      this.ctx.hud.hideDimension();
      return;
    }
    const last = this.points[this.points.length - 1]!;
    const lenMm = Math.hypot(current[0] - last[0], current[1] - last[1]);
    const mid = new THREE.Vector3((current[0] + last[0]) / 2000, elev + 0.03, (current[1] + last[1]) / 2000);
    this.ctx.hud.showDimension(mid, lenMm, this.ctx.rig.active);
  }

  private updateMarker(p: Pt, mmPerPixel: number): void {
    const elev = (this.ctx.store.getLevel(this.ctx.levelId())?.elevation ?? 0) / 1000;
    this.marker.visible = true;
    this.marker.position.set(p[0] / 1000, elev + 0.03, p[1] / 1000);
    this.marker.scale.setScalar(Math.max((6 * mmPerPixel) / 1000, 0.01));
  }
}
