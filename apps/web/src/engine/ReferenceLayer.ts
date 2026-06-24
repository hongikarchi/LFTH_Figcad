import * as THREE from 'three';
import type { DwgUnderlay } from '@figcad/interop/dwg-underlay';
import type { Engine } from './Engine';

/**
 * F6 Phase 0 — 읽기전용 레퍼런스 지오메트리 채널 (federation 스파이크).
 *
 * 외부 툴(Rhino·Revit…)에서 published 모델을 "읽기 메시"로 씬에 띄우는 격리 채널.
 * 불변① 정합: 이건 Figcad 네이티브 요소(파생)가 아니라 **별도 표현**(외부 읽기전용).
 * 불변②·③ 무관: DocStore·Y.Doc·ops를 안 거치는 **클라 로컬 뷰 상태**(HUD·presence와 동급).
 * store.listElements()에 안 들어오고 SceneManager.entries(derive)와 분리된다 —
 * 자기 THREE.Group을 직접 소유해 SceneManager를 건드리지 않는다(렌더 2경로 혼입 회피).
 *
 * 좌표 = 월드 미터(Three Y-up) — Figcad 렌더 관례(world=[x,y,z]*0.001)와 동일.
 * 픽킹: SceneManager.entries만 픽 대상이라 이 메시들은 자동 비픽(userData 플래그는 방어).
 * 전체 federation(소스 레지스트리·추출·3D-Tiles·픽킹)은 v1.5 — docs/federation-design.md.
 */

export interface ReferenceMesh {
  /** non-indexed 삼각형 정점, 월드 미터 (x,y,z 반복) */
  positions: Float32Array;
  /** 선택 — 없으면 geometry가 flat normal 계산 */
  normals?: Float32Array;
}

const REF_COLOR = 0x6a8caf;
const REF_OPACITY = 0.5;
const UNDERLAY_COLOR = 0x8aa0b4; // 빽도면 라인 — 흐릿한 청회색(네이티브 요소와 구분)
const UNDERLAY_OPACITY = 0.65;

/** 2D 언더레이 배치 (FederationSource.underlay) — origin[mm] 평면이동·rotation[rad]·scale. */
export interface UnderlayPlacement {
  origin: [number, number];
  rotation: number;
  scale: number;
}

export class ReferenceLayer {
  private group = new THREE.Group();
  private sources = new Map<string, THREE.Group>();

  constructor(private engine: Engine) {
    this.group.name = 'figcad-reference';
    engine.scene.add(this.group);
  }

  /**
   * 외부 모델 추가 (읽기전용). 같은 name이면 교체.
   * offset(월드 미터) = projectOrigin recenter 보정 — 네이티브 프레임이 recenter됐으면
   * 원좌표 glTF/IFC 오버레이를 -origin만큼 옮겨 정합(M13 projectOrigin).
   */
  add(name: string, meshes: ReferenceMesh[], offset?: [number, number, number]): void {
    this.remove(name);
    const g = new THREE.Group();
    g.name = `reference:${name}`;
    if (offset) g.position.set(offset[0], offset[1], offset[2]);
    const mat = new THREE.MeshLambertMaterial({
      color: REF_COLOR,
      transparent: true,
      opacity: REF_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    for (const m of meshes) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      if (m.normals) geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
      else geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      // v0 비픽은 SceneManager.pickables 미포함에서 옴(이 그룹은 별도). 이 플래그는
      // v1.5 픽킹(읽기전용 정보표시) 때 레퍼런스 메시 식별용 마커 — federation-design §4d.
      mesh.userData['figcadReference'] = true;
      g.add(mesh);
    }
    this.sources.set(name, g);
    this.group.add(g);
    this.engine.requestRender();
  }

  /**
   * 2D CAD 언더레이(빽도면) 추가 — DWG/DXF 평면 라인워크를 한 레벨 평면에 평평히 깐다.
   * 같은 name이면 교체. 라인워크는 LineSegments 한 버퍼(1 draw call). 라벨은 렌더 안 함
   * (텍스처-per-라벨 HUD 예산 초과 회피 — web-tools.md; 18k 라벨은 zoom-gate가 v1.5).
   *
   * 좌표: DWG mm 평면 [x,y] → 로컬 미터 [x*.001, 0, y*.001]. 배치는 group TRS로(slice④ 기즈모 =
   * 재파싱 없이 transform만 갱신 — advisor). origin[mm]→position, scale, rotation→Y축. 레벨 높이 = elevation.
   */
  addUnderlay(name: string, underlay: DwgUnderlay, placement: UnderlayPlacement, levelElevationMm: number): void {
    this.remove(name);
    const g = new THREE.Group();
    g.name = `reference:${name}`;
    g.scale.setScalar(placement.scale);
    // rotation: DWG-평면 CCW φ → 월드 Y축 회전. (rotation=0 기본이라 슬라이스④ 정합 때 부호 확정.)
    g.rotation.y = -placement.rotation;
    g.position.set(placement.origin[0] * 0.001, levelElevationMm * 0.001, placement.origin[1] * 0.001);

    const seg = underlay.segments;
    const pos = new Float32Array((seg.length / 4) * 6);
    for (let i = 0, j = 0; i < seg.length; i += 4) {
      pos[j++] = seg[i]! * 0.001; pos[j++] = 0; pos[j++] = seg[i + 1]! * 0.001;
      pos[j++] = seg[i + 2]! * 0.001; pos[j++] = 0; pos[j++] = seg[i + 3]! * 0.001;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: UNDERLAY_COLOR,
      transparent: true,
      opacity: UNDERLAY_OPACITY,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.userData['figcadReference'] = true;
    g.add(lines);
    this.sources.set(name, g);
    this.group.add(g);
    this.engine.requestRender();
  }

  setVisible(name: string, visible: boolean): void {
    const g = this.sources.get(name);
    if (!g) return;
    g.visible = visible;
    this.engine.requestRender();
  }

  setAllVisible(visible: boolean): void {
    this.group.visible = visible;
    this.engine.requestRender();
  }

  list(): string[] {
    return [...this.sources.keys()];
  }

  /** 레퍼런스 메시 루트 그룹 — 줌 익스텐트(fitView)가 오버레이까지 포함해 맞추도록 노출(읽기용). */
  get root(): THREE.Group {
    return this.group;
  }

  /**
   * 보이는(visible) 소스만 합친 월드 bbox — fitView용. Box3.expandByObject는 visible을 무시하므로
   * (숨긴 먼 소스가 카메라를 빈 공간으로 끌어당김, Codex #4) visible group만 직접 합친다.
   */
  visibleBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    if (!this.group.visible) return box; // setAllVisible(false)로 루트 숨김 → 빈 bbox (전부 안 보임)
    for (const g of this.sources.values()) if (g.visible) box.expandByObject(g);
    return box;
  }

  remove(name: string): void {
    const g = this.sources.get(name);
    if (!g) return;
    this.disposeGroup(g);
    this.group.remove(g);
    this.sources.delete(name);
    this.engine.requestRender();
  }

  clear(): void {
    for (const g of this.sources.values()) {
      this.disposeGroup(g);
      this.group.remove(g);
    }
    this.sources.clear();
    this.engine.requestRender();
  }

  private disposeGroup(g: THREE.Group): void {
    const disposed = new Set<THREE.Material>();
    g.traverse((o) => {
      // Mesh(오버레이) + LineSegments(언더레이) 둘 다 geometry/material 보유 → 일반 처리.
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        const mat = o.material;
        const list = Array.isArray(mat) ? mat : [mat];
        for (const m of list) {
          if (!disposed.has(m)) {
            m.dispose();
            disposed.add(m);
          }
        }
      }
    });
  }

  /** 스파이크 데모 — 원점서 떨어진 읽기전용 박스 2개(외부 모델 흉내). */
  addDemo(): void {
    const box = (cx: number, cz: number, w: number, h: number, d: number): ReferenceMesh => {
      const geo = new THREE.BoxGeometry(w, h, d).toNonIndexed();
      geo.translate(cx, h / 2, cz);
      const out = new Float32Array(geo.getAttribute('position').array as Float32Array);
      geo.dispose();
      return { positions: out };
    };
    this.add('demo', [box(8, 0, 4, 3, 6), box(14, 2, 3, 5, 3)]);
  }
}
