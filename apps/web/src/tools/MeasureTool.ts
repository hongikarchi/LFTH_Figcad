import * as THREE from 'three';
import { useUiStore } from '../state/uiStore';
import { raycastPoint } from '../engine/Picker';
import type { EditorContext } from './context';
import type { Tool, ToolPointerInfo } from './ToolController';

const DRAG_COMMIT_PX = 8;
const MIN_LEN_MM = 5; // 이보다 짧으면 퇴화(더블클릭/제자리 두 번) — 무시하고 도구 유지

/**
 * 줄자(measure) — 리뷰 허브용 일회성 거리 측정. 두 점(클릭-클릭 또는 펜 드래그) 사이 거리를 mm로 표시.
 * 3D 모드: 오버레이/요소 **메시 표면** 히트(높이 포함 = 대각/높이 측정). 평면 모드: 지면 평면(수평 거리).
 *
 * 불변① 준수: 문서에 저장하지 않는 순수 렌더 ephemera(치수 요소가 아님) — **읽기전용 오버레이에서도 동작**.
 * 영구 치수가 필요하면 DimensionTool(요소·바인딩·평면). 줄자는 임포트 모델을 빠르게 재보는 검수 동작.
 */
export class MeasureTool implements Tool {
  private a: THREE.Vector3 | null = null;
  private finalized = false;
  private downClient: { x: number; y: number } | null = null;
  private line: THREE.Line;
  private markerA: THREE.Mesh;
  private markerB: THREE.Mesh;

  constructor(private ctx: EditorContext) {
    this.line = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0x0a84ff, dashSize: 0.25, gapSize: 0.15 }),
    );
    this.line.frustumCulled = false;
    // 대시 거리 attribute 미리 확보 → drawLine서 in-place 갱신(computeLineDistances 매 프레임 attribute 교체 누수 방지).
    this.line.geometry.setAttribute('lineDistance', new THREE.Float32BufferAttribute([0, 0], 1));
    this.markerA = this.makeMarker(0x0a84ff);
    this.markerB = this.makeMarker(0xffffff);
    this.line.visible = this.markerA.visible = this.markerB.visible = false;
    ctx.engine.scene.add(this.line, this.markerA, this.markerB);
  }

  private makeMarker(color: number): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color }));
    m.renderOrder = 4;
    return m;
  }

  /** 화면 → 월드(m). 3D = 메시 표면 히트 우선, 폴백/평면 = 지면(활성 레벨 고도). */
  private worldAt(info: ToolPointerInfo): THREE.Vector3 | null {
    const is3d = useUiStore.getState().viewMode === '3d';
    const roots = this.ctx.overlayRoot ? [this.ctx.overlayRoot, ...this.ctx.scene.pickables] : this.ctx.scene.pickables;
    const p3d = is3d ? raycastPoint(info.clientX, info.clientY, this.ctx.rig.active, roots) : null;
    if (p3d) return p3d;
    if (info.doc) {
      const elev = (this.ctx.store.getLevel(this.ctx.levelId())?.elevation ?? 0) / 1000;
      return new THREE.Vector3(info.doc[0] / 1000, elev, info.doc[1] / 1000);
    }
    return null;
  }

  private markerScale(mmPerPixel: number): number {
    return Math.max((6 * mmPerPixel) / 1000, 0.01);
  }

  down(info: ToolPointerInfo): void {
    if (this.finalized) this.reset(); // 완료된 측정 위에서 새로 시작
    const w = this.worldAt(info);
    if (!w) return;
    this.downClient = { x: info.clientX, y: info.clientY };
    if (!this.a) {
      this.a = w.clone();
      this.markerA.position.copy(this.a);
      this.markerA.scale.setScalar(this.markerScale(info.mmPerPixel));
      this.markerA.visible = true;
      this.ctx.engine.requestRender();
    } else {
      this.finalize(w, info.mmPerPixel);
    }
  }

  move(info: ToolPointerInfo): void {
    if (!this.a || this.finalized) return; // 측정 진행 중에만 — idle/완료 hover서 전체 씬 레이캐스트 낭비 방지(Codex 리뷰)
    const w = this.worldAt(info);
    if (!w) return;
    this.markerB.position.copy(w);
    this.markerB.scale.setScalar(this.markerScale(info.mmPerPixel));
    this.markerB.visible = true;
    this.drawLine(this.a, w);
    this.showChip(this.a, w);
    this.ctx.engine.requestRender();
  }

  up(info: ToolPointerInfo): void {
    if (!this.a || this.finalized || !this.downClient) {
      this.downClient = null;
      return;
    }
    const dragPx = Math.hypot(info.clientX - this.downClient.x, info.clientY - this.downClient.y);
    if (dragPx > DRAG_COMMIT_PX) {
      const w = this.worldAt(info);
      if (w) this.finalize(w, info.mmPerPixel);
    }
    this.downClient = null;
  }

  cancel(): void {
    this.reset(); // reset()이 requestRender 포함
  }

  /** RMB(Enter) = 측정 초기화 — 다음 측정 준비 */
  enter(): void {
    this.reset();
  }

  private finalize(b: THREE.Vector3, mmPerPixel: number): void {
    if (!this.a) return;
    if (this.a.distanceTo(b) * 1000 < MIN_LEN_MM) return; // 0mm 퇴화 측정 무시 — 도구는 B 대기 유지
    this.markerB.position.copy(b);
    this.markerB.scale.setScalar(this.markerScale(mmPerPixel));
    this.markerB.visible = true;
    this.drawLine(this.a, b);
    this.showChip(this.a, b);
    this.finalized = true;
    this.ctx.engine.requestRender();
  }

  private drawLine(a: THREE.Vector3, b: THREE.Vector3): void {
    this.line.geometry.setFromPoints([a, b]); // position만 in-place 갱신(2정점)
    const ld = this.line.geometry.getAttribute('lineDistance') as THREE.BufferAttribute;
    ld.setX(0, 0);
    ld.setX(1, a.distanceTo(b));
    ld.needsUpdate = true; // 대시 거리 in-place(computeLineDistances의 attribute 교체 누수 회피)
    this.line.visible = true;
  }

  private showChip(a: THREE.Vector3, b: THREE.Vector3): void {
    const lenMm = a.distanceTo(b) * 1000;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    this.ctx.hud.showDimension(mid, lenMm, this.ctx.rig.active);
  }

  private reset(): void {
    this.a = null;
    this.finalized = false;
    this.downClient = null;
    this.line.visible = this.markerA.visible = this.markerB.visible = false;
    this.ctx.hud.hideDimension();
    this.ctx.engine.requestRender(); // 비주얼 정리 단일소스(cancel/enter/down-while-finalized 고스트 방지)
  }
}
