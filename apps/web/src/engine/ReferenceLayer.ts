import * as THREE from 'three';
import { clipSegmentAabb, type DwgUnderlay } from '@figcad/interop/dwg-underlay';
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

/** 추출기 결과 — solid 메시 + (선택) 3D 와이어프레임 에지(.3dm Brep edge 등 = "있는 그대로"). */
export interface ReferenceResult {
  meshes: ReferenceMesh[];
  /** 3D 라인 세그먼트 [x0,y0,z0,x1,y1,z1...] 월드 미터 — Brep/커브 와이어프레임. */
  edges?: Float32Array;
}

const REF_COLOR = 0x6a8caf;
const REF_OPACITY = 0.5;
const CLAY_COLOR = 0xdedee2; // 오버레이 메시 = 흰색 솔리드(클레이 렌더) — 불투명 매트
const CLAY_EDGE = 0x8a909a; // 메시 없는 Brep/커브 와이어 = 옅은 회색 선(클레이와 조화)
const UNDERLAY_COLOR = 0x49545e; // 빽도면 라인 — 진한 청회색(PDF 흑백 대비, 네이티브 요소와 구분)
const UNDERLAY_OPACITY = 1; // 불투명 — 반투명이면 빽빽한 데서 겹치는 선 알파 누적해 회색 덩어리. opacity 1 = 누적 없음(transparent는 채움/라인 렌더순서용 유지)
const UNDERLAY_MAX_LABELS = 4000; // 초과(예: 메가시트 18k) 시 텍스트 생략 (스프라이트 draw call·텍스처 예산)

/** 언더레이 텍스트 라벨 스프라이트 (CanvasTexture). worldH = 월드 높이(미터), 폭은 글자 비율. */
function makeTextSprite(text: string, worldH: number): THREE.Sprite {
  const FONT = 40;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `${FONT}px sans-serif`;
  const tw = Math.max(2, measure.measureText(text).width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(tw) + 6;
  canvas.height = FONT + 6;
  const g = canvas.getContext('2d')!;
  g.font = `${FONT}px sans-serif`;
  g.textBaseline = 'middle';
  g.fillStyle = '#5b6b7a';
  g.fillText(text, 3, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    // side: DoubleSide 필수 — plan 직교뷰는 X-반사 투영(음수폭 frustum)이라 front-side 스프라이트는 back-face 컬링돼 안 보임.
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0.92, side: THREE.DoubleSide }),
  );
  sprite.scale.set((worldH * canvas.width) / canvas.height, worldH, 1);
  sprite.renderOrder = 3;
  return sprite;
}

/** plan X-반사 상쇄 — 스프라이트는 scale.x 부호 무시(|scale|)라 텍스처 U를 뒤집어 미러 해제. */
function flipSpriteTexture(sp: THREE.Sprite, flipped: boolean): void {
  const map = (sp.material as THREE.SpriteMaterial).map;
  if (!map) return;
  map.center.set(0.5, 0.5);
  map.repeat.x = flipped ? -1 : 1;
  map.needsUpdate = true;
}

/** 2D 언더레이 배치 (FederationSource.underlay) — origin[mm] 평면이동·rotation[rad]·scale + XCLIP. */
export interface UnderlayPlacement {
  origin: [number, number];
  rotation: number;
  scale: number;
  /** XCLIP 사각형 [minX,minY,maxX,maxY] DWG 도면 로컬 mm — 이 안만 렌더(경계 트림). 없음=전체. */
  clip?: [number, number, number, number];
}

export class ReferenceLayer {
  private group = new THREE.Group();
  private sources = new Map<string, THREE.Group>();
  private planFlipped = false; // plan 직교뷰 X 반사 상태 — 언더레이 텍스트 스프라이트 역-flip용

  constructor(private engine: Engine) {
    this.group.name = 'figcad-reference';
    engine.scene.add(this.group);
  }

  /**
   * 외부 모델 추가 (읽기전용). 같은 name이면 교체.
   * offset(월드 미터) = projectOrigin recenter 보정 — 네이티브 프레임이 recenter됐으면
   * 원좌표 glTF/IFC 오버레이를 -origin만큼 옮겨 정합(M13 projectOrigin).
   */
  add(name: string, result: ReferenceResult, offset?: [number, number, number]): void {
    this.remove(name);
    const g = new THREE.Group();
    g.name = `reference:${name}`;
    if (offset) g.position.set(offset[0], offset[1], offset[2]);
    // 클레이 렌더 — 흰색 불투명 솔리드(매트). depthWrite 기본(true)이라 제대로 가려짐(반투명 고스트 아님).
    const mat = new THREE.MeshLambertMaterial({
      color: CLAY_COLOR,
      side: THREE.DoubleSide,
    });
    for (const m of result.meshes) {
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
    // 3D 와이어프레임 에지(.3dm Brep edge·커브 = "있는 그대로") — 1 LineSegments draw call.
    if (result.edges && result.edges.length) {
      const egeo = new THREE.BufferGeometry();
      egeo.setAttribute('position', new THREE.BufferAttribute(result.edges, 3));
      const emesh = new THREE.LineSegments(egeo, new THREE.LineBasicMaterial({ color: CLAY_EDGE }));
      emesh.userData['figcadReference'] = true;
      g.add(emesh);
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

    // frozen/off 레이어는 기본 제외 = CAD 작성자가 숨긴 그대로(임의 hide 아님 — 정보는 underlay에 보존,
    // 레이어 픽커가 toggle). 메가시트 xref 베이스맵(이 파일=교통 75%)이 자동으로 빠져 CAD 화면과 일치.
    // XCLIP(placement.clip): DWG 로컬 mm AABB로 세그 트림(경계서 자름). 배치 적용 전 좌표 = seg 그대로.
    const seg = underlay.segments;
    const clip = placement.clip;
    const buf: number[] = [];
    for (let i = 0; i < seg.length; i += 4) {
      if (underlay.layerHidden[underlay.segLayer[i / 4]!]) continue;
      let x0 = seg[i]!, y0 = seg[i + 1]!, x1 = seg[i + 2]!, y1 = seg[i + 3]!;
      if (clip) {
        const c = clipSegmentAabb(x0, y0, x1, y1, clip[0], clip[1], clip[2], clip[3]);
        if (!c) continue;
        [x0, y0, x1, y1] = c;
      }
      buf.push(x0 * 0.001, 0, y0 * 0.001, x1 * 0.001, 0, y1 * 0.001);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf), 3));
    const mat = new THREE.LineBasicMaterial({
      color: UNDERLAY_COLOR,
      transparent: true,
      opacity: UNDERLAY_OPACITY,
      depthWrite: false,
    });
    // 솔리드 해치 채움(로고·poché) — 루프 삼각화해 한 메시(1 draw call). 라인보다 살짝 아래(y) 둬 경계선이 위.
    const fillTris: number[] = [];
    for (const fl of underlay.fills) {
      if (underlay.layerHidden[fl.layerIdx]) continue;
      // 각 루프 독립 삼각화 — 한 HATCH의 여러 path는 별개 영역(예 로고 글자)이라 outer/holes로 묶으면 garbage.
      for (const lp of fl.loops) {
        if (lp.length < 3) continue;
        const pts = lp.map(([x, y]) => new THREE.Vector2(x, y));
        let faces: number[][];
        try { faces = THREE.ShapeUtils.triangulateShape(pts, []); } catch { continue; }
        for (const f of faces) for (const idx of f) { const v = pts[idx]; if (v) fillTris.push(v.x * 0.001, -0.01, v.y * 0.001); }
      }
    }
    if (fillTris.length) {
      const fgeo = new THREE.BufferGeometry();
      fgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fillTris), 3));
      const fmesh = new THREE.Mesh(fgeo, new THREE.MeshBasicMaterial({ color: 0x6b8095, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
      fmesh.userData['figcadReference'] = true;
      fmesh.renderOrder = -1;
      g.add(fmesh);
    }

    const lines = new THREE.LineSegments(geo, mat);
    lines.userData['figcadReference'] = true;
    g.add(lines);

    // 텍스트 라벨(TEXT/MTEXT) — 스프라이트(빌보드). frozen 레이어·클립 밖은 제외. 메가시트(>캡)는 생략.
    const labels = underlay.labels;
    if (labels.length && labels.length <= UNDERLAY_MAX_LABELS) {
      const hidden = new Set<string>();
      underlay.layers.forEach((nm, i) => { if (underlay.layerHidden[i]) hidden.add(nm); });
      for (const lb of labels) {
        if (lb.layer && hidden.has(lb.layer)) continue;
        if (clip && (lb.x < clip[0] || lb.x > clip[2] || lb.y < clip[1] || lb.y > clip[3])) continue;
        const sp = makeTextSprite(lb.text, Math.max(0.06, (lb.height || 200) * 0.001));
        sp.position.set(lb.x * 0.001, 0.02, lb.y * 0.001);
        if (this.planFlipped) flipSpriteTexture(sp, true); // plan 미러 상쇄(텍스처 U)
        sp.userData['underlayLabel'] = true;
        g.add(sp);
      }
    }
    g.userData['isUnderlay'] = true; // DWG 빽도면 — 그리드 숨김 트리거
    this.sources.set(name, g);
    this.group.add(g);
    this.updateGridVisibility();
    this.engine.requestRender();
  }

  /**
   * 래스터 언더레이(이미지/PDF) 추가 — 텍스처 쿼드를 한 레벨 평면(XZ)에 평평히 깐다 (iter-3 import 업그레이드).
   * addUnderlay와 동일 group TRS(origin[mm]→position·rotation→Y·scale). 쿼드 = wMm×hMm(그룹 scale 전 mm).
   * 텍스처 메시는 라인워크처럼 geometry라 plan X-반사서 자연 정합(스프라이트와 달리 flip 불요).
   * rotateX(+90°): 이미지 상단(+V)→북(+Z)·우(+U)→동(+X) — 평면도 방위 일치.
   */
  addImageUnderlay(
    name: string,
    source: ImageBitmap | HTMLCanvasElement,
    wMm: number,
    hMm: number,
    placement: UnderlayPlacement,
    levelElevationMm: number,
    opacity: number,
  ): void {
    this.remove(name);
    const texture = new THREE.Texture(source);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    const g = new THREE.Group();
    g.name = `reference:${name}`;
    g.scale.setScalar(placement.scale);
    g.rotation.y = -placement.rotation;
    g.position.set(placement.origin[0] * 0.001, levelElevationMm * 0.001 + 0.001, placement.origin[1] * 0.001);
    const geo = new THREE.PlaneGeometry(wMm * 0.001, hMm * 0.001);
    geo.rotateX(Math.PI / 2); // XY 평면 → XZ 바닥 (상단→+Z 북, 우→+X 동)
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData['figcadReference'] = true;
    mesh.renderOrder = -2; // 라인워크(-1)·요소보다 아래
    g.add(mesh);
    g.userData['isUnderlay'] = true; // 그리드 숨김 트리거
    this.sources.set(name, g);
    this.group.add(g);
    this.updateGridVisibility();
    this.engine.requestRender();
  }

  /** DWG 언더레이 표시 중이면 네이티브 1m 그리드 숨김 — 평면서 빽빽한 도면 위 격자 클러터 방지. */
  private updateGridVisibility(): void {
    const grid = this.engine.scene.userData['grid'] as THREE.Object3D | undefined;
    if (!grid) return;
    grid.visible = ![...this.sources.values()].some((g) => g.userData['isUnderlay']);
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

  /**
   * plan 직교뷰는 프로젝션 X 반사(동=右 CAD표준)라 빌보드 스프라이트 텍스트가 거울로 그려짐 →
   * 텍스처 U 플립으로 상쇄(scale.x 부호는 스프라이트가 무시). main.ts가 뷰모드 변경 시 호출.
   */
  setPlanFlipped(flipped: boolean): void {
    if (flipped === this.planFlipped) return;
    this.planFlipped = flipped;
    for (const g of this.sources.values()) {
      g.traverse((o) => {
        const s = o as THREE.Sprite;
        if (s.isSprite && o.userData['underlayLabel']) flipSpriteTexture(s, flipped);
      });
    }
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
    this.updateGridVisibility();
    this.engine.requestRender();
  }

  clear(): void {
    for (const g of this.sources.values()) {
      this.disposeGroup(g);
      this.group.remove(g);
    }
    this.sources.clear();
    this.updateGridVisibility();
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
            (m as THREE.MeshBasicMaterial).map?.dispose(); // 래스터 언더레이 텍스처 dispose
            m.dispose();
            disposed.add(m);
          }
        }
      } else if ((o as THREE.Sprite).isSprite) {
        // 텍스트 라벨 스프라이트 — CanvasTexture + material dispose.
        const m = (o as THREE.Sprite).material;
        m.map?.dispose();
        if (!disposed.has(m)) { m.dispose(); disposed.add(m); }
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
    this.add('demo', { meshes: [box(8, 0, 4, 3, 6), box(14, 2, 3, 5, 3)] });
  }
}
