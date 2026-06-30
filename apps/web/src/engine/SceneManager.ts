import * as THREE from 'three';
import {
  buildDeriveIndex,
  DeriveCache,
  resolveCommentPoint,
  type DeriveIndex,
  type DocStore,
  type Id,
  type SketchElement,
} from '@figcad/core';
import type { Engine } from './Engine';
import type { HudLayer, CommentBubble } from '../hud/HudLayer';
import type { DerivedGeometry } from '@figcad/core';

const EDGE_COLOR = 0x2a2a2e;
const GRID_COLOR = 0xc0392b;
const SELECT_EMISSIVE = 0x0a84ff; // Apple blue
const GHOST_OPACITY = 0.12;

interface SceneEntry {
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  baseColor: string;
  kind: string;
  levelId: Id | null; // 그리드 = null (전 층 공통, 고스팅 제외)
  labelKey: string; // 라벨 채널 직렬화 (텍스트+스타일 변경 시만 스프라이트 재생성)
  sprites: THREE.Sprite[];
  lastGeo: DerivedGeometry | null;
  glassMesh: THREE.Mesh | null; // 반투명 자식(커튼월 유리) — 메인 메시 단일 머티리얼 보존
  ownedEdgeMat: THREE.LineBasicMaterial | null; // 스케치 전용 에지 머티리얼(스타일색) — 공유mat 아님, remove서 dispose
  styleKey: string; // 스케치 스타일 직렬화(diff — deriveKey가 style 제외라 여기서 갱신)
}

const GLASS_COLOR = 0x88ccee;
const GLASS_OPACITY = 0.3;

type LabelStyle = 'grid' | 'text' | 'dim';

/**
 * 씬 라벨 스프라이트 — style별: grid=빨강 원 버블, text/dim=흰 알약+검정 글자(B&W).
 * 캔버스 폭을 글자에 맞춰(가변), 월드 스케일은 높이 기준 고정.
 */
function makeLabelSprite(text: string, style: LabelStyle = 'grid'): THREE.Sprite {
  const H = 96;
  const measure = document.createElement('canvas').getContext('2d')!;
  const fontPx = H * (style === 'grid' ? 0.42 : 0.5);
  measure.font = `bold ${fontPx}px -apple-system, sans-serif`;
  const grid = style === 'grid';
  const textW = measure.measureText(text || ' ').width;
  const W = grid ? H : Math.max(H, Math.ceil(textW + H * 0.5));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.font = `bold ${fontPx}px -apple-system, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (grid) {
    g.beginPath();
    g.arc(W / 2, H / 2, H / 2 - 4, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#c0392b';
    g.stroke();
  } else {
    const r = H * 0.28;
    const pad = 6;
    g.beginPath();
    g.roundRect(pad, pad, W - pad * 2, H - pad * 2, r);
    g.fillStyle = style === 'dim' ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.85)';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.stroke();
  }
  g.fillStyle = '#1d1d1f';
  g.fillText(text, W / 2, H / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; // 캔버스 텍스처 sRGB — 색 정확(미설정 시 선형 취급=칙칙)
  const sprite = new THREE.Sprite(
    // side: DoubleSide — plan 직교뷰 X-반사 투영서 front-side 스프라이트는 back-face 컬링됨
    new THREE.SpriteMaterial({ map: tex, depthTest: false, side: THREE.DoubleSide }),
  );
  // 높이 0.5m 고정, 폭은 캔버스 비율 유지
  const scaleH = grid ? 0.5 : 0.4;
  sprite.scale.set((scaleH * W) / H, scaleH, 1);
  sprite.renderOrder = 5;
  return sprite;
}

/** 코멘트 핀 스프라이트 — 열림=파랑/💬·답글수, 해결=회색/✓ */
function makeCommentPin(resolved: boolean, replyCount: number): THREE.Sprite {
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d')!;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 5, 0, Math.PI * 2);
  g.fillStyle = resolved ? 'rgba(140,140,140,0.95)' : 'rgba(10,132,255,0.95)';
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `bold ${S * 0.4}px -apple-system, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(resolved ? '✓' : replyCount > 0 ? String(replyCount + 1) : '💬', S / 2, S / 2 + 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false, side: THREE.DoubleSide }),
  );
  sprite.scale.setScalar(0.6);
  sprite.renderOrder = 6;
  return sprite;
}

/**
 * 문서 → 씬 reconciler. 변경 시 모든 벽에 derive를 다시 요청한다 —
 * 캐시 키에 조인 정보가 들어 있어 이웃이 움직인 벽만 실제 재파생되고,
 * 나머지는 같은 geo 객체가 돌아와(lastGeo 비교) GPU 업로드를 스킵한다.
 */
export class SceneManager {
  private entries = new Map<Id, SceneEntry>();
  private derive = new DeriveCache();
  private edgeMat = new THREE.LineBasicMaterial({ color: EDGE_COLOR });
  private gridEdgeMat = new THREE.LineBasicMaterial({ color: GRID_COLOR });
  private ghostEdgeMat = new THREE.LineBasicMaterial({
    color: EDGE_COLOR,
    transparent: true,
    opacity: 0.15,
  });
  // 주석(치수·레이블·그리드) 선택 피드백 — 픽 프록시 메시가 opacity 0.04라 emissive가 안 보임 →
  // 보이는 에지·스프라이트를 강조. 선택=파랑, 원격=피어색(색별 캐시).
  private selEdgeMat = new THREE.LineBasicMaterial({ color: SELECT_EMISSIVE });
  private remoteEdgeMats = new Map<string, THREE.LineBasicMaterial>();
  private selected = new Set<Id>(); // 내 선택 (다중)
  private remoteHighlights = new Map<Id, string>(); // 원격 사용자 선택 (id → 사용자 색)
  private viewMode: '3d' | 'plan' = '3d';
  private activeLevelId: Id | null = null;

  // 코멘트 지시선(말풍선 at → 앵커 핀) — 파랑 반투명
  private commentLeaderMat = new THREE.LineBasicMaterial({ color: 0x0a84ff, transparent: true, opacity: 0.55 });
  private commentLeaders = new Map<Id, THREE.Line>();

  constructor(
    private store: DocStore,
    private engine: Engine,
    private hud: HudLayer,
  ) {
    store.observe((change) => {
      // 빈 change = 코멘트 등 요소-아닌 변경(notifyAll) → 핀만 재동기, 전체 요소 재파생 스킵
      // (emit은 비어있는 요소 change를 통지하지 않으므로 여기 빈 change는 코멘트뿐)
      if (!change.added.length && !change.updated.length && !change.removed.length) {
        this.syncComments(store);
        engine.requestRender();
        return;
      }
      for (const id of change.removed) this.remove(id);
      // 조인 때문에 전체 벽 재요청 (캐시가 무변경을 걸러낸다).
      // 의존 인덱스를 변경당 1회 구축 — 없으면 요소마다 전체 스캔 = 변경당 O(n²)
      const index = buildDeriveIndex(store);
      for (const el of store.listElements()) this.upsert(el.id, index);
      this.syncComments(store); // 요소 이동 시 앵커된 코멘트 핀도 재배치
      engine.requestRender();
    });
  }

  /**
   * 코멘트 핀·지시선·말풍선 동기화 — 루트 코멘트마다:
   *  핀 = 앵커 해석 위치(resolveCommentPoint, 요소 추종), 말풍선 = at(텍스트 위치, HUD DOM),
   *  지시선 = 핀→말풍선(둘이 다를 때). 요소 파이프라인 밖(불변①·③).
   */
  private commentPins = new Map<Id, THREE.Sprite>();
  private syncComments(store: DocStore): void {
    const comments = store.listComments();
    const replyCount = new Map<Id, number>();
    for (const c of comments) if (c.parentId) replyCount.set(c.parentId, (replyCount.get(c.parentId) ?? 0) + 1);
    const seen = new Set<Id>();
    const bubbles: CommentBubble[] = [];
    for (const c of comments) {
      if (c.parentId) continue; // 루트만 핀
      seen.add(c.id);
      const anchor = resolveCommentPoint(store, c); // 핀 = 앵커(요소 추종)
      const bubblePt = c.at; // 말풍선·지시선 끝 = 텍스트 위치
      const elev = (store.getLevel(c.levelId)?.elevation ?? 0) / 1000 + 0.05;
      // 3D 코멘트(오버레이/메시 위 — c.z 있으면 그 높이). 없으면 레벨 elevation(레벨바닥 핀).
      const pinY = c.z !== undefined ? c.z / 1000 + 0.05 : elev;
      const n = replyCount.get(c.id) ?? 0;
      const key = `${c.resolved ? 'r' : 'o'}:${n}`;
      let sprite = this.commentPins.get(c.id);
      if (!sprite || sprite.userData['key'] !== key) {
        if (sprite) {
          this.engine.scene.remove(sprite);
          sprite.material.map?.dispose();
          sprite.material.dispose();
        }
        sprite = makeCommentPin(!!c.resolved, n);
        sprite.userData['key'] = key;
        this.flipSprite(sprite); // plan 모드면 X 역-flip
        this.engine.scene.add(sprite);
        this.commentPins.set(c.id, sprite);
      }
      sprite.position.set(anchor[0] / 1000, pinY, anchor[1] / 1000);

      // 지시선 (핀→말풍선) — 1mm 넘게 떨어졌을 때만 (앵커=at인 자유 코멘트는 생략)
      const apart = Math.hypot(anchor[0] - bubblePt[0], anchor[1] - bubblePt[1]) > 1;
      let leader = this.commentLeaders.get(c.id);
      if (apart) {
        if (!leader) {
          leader = new THREE.Line(new THREE.BufferGeometry(), this.commentLeaderMat);
          this.engine.scene.add(leader);
          this.commentLeaders.set(c.id, leader);
        }
        // setLineGeometry = computeBoundingSphere 포함(고정 6-float) → 스테일 bbox로 화면서 frustum-culled 방지.
        setLineGeometry(
          leader.geometry,
          new Float32Array([anchor[0] / 1000, pinY, anchor[1] / 1000, bubblePt[0] / 1000, pinY, bubblePt[1] / 1000]),
        );
        leader.visible = true;
      } else if (leader) {
        leader.visible = false;
      }

      // 말풍선 (텍스트 — HUD DOM) at 위치. 첫 줄 ~24자.
      const oneLine = c.text.replace(/\s+/g, ' ').trim();
      bubbles.push({
        id: c.id,
        text: oneLine.length > 24 ? `${oneLine.slice(0, 24)}…` : oneLine,
        world: new THREE.Vector3(bubblePt[0] / 1000, pinY, bubblePt[1] / 1000),
        resolved: !!c.resolved,
      });
    }
    for (const [id, sprite] of this.commentPins) {
      if (seen.has(id)) continue;
      this.engine.scene.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
      this.commentPins.delete(id);
    }
    for (const [id, leader] of this.commentLeaders) {
      if (seen.has(id)) continue;
      this.engine.scene.remove(leader);
      leader.geometry.dispose();
      this.commentLeaders.delete(id);
    }
    this.hud.setCommentBubbles(bubbles);
  }

  get pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const e of this.entries.values()) {
      out.push(e.mesh);
      if (e.glassMesh) out.push(e.glassMesh); // 유리 클릭도 커튼월 선택 (userData.elementId 동일)
    }
    return out;
  }

  setSelected(ids: Id[]): void {
    const affected = new Set<Id>([...this.selected, ...ids]);
    this.selected = new Set(ids);
    for (const id of affected) this.applyHighlight(id);
    this.engine.requestRender();
  }

  /** 원격 사용자 선택/편집 표시 — awareness 변경 시 호출 */
  setRemoteHighlights(highlights: Map<Id, string>): void {
    const affected = new Set([...this.remoteHighlights.keys(), ...highlights.keys()]);
    this.remoteHighlights = highlights;
    for (const id of affected) this.applyHighlight(id);
    this.engine.requestRender();
  }

  /** 우선순위: 내 선택 > 원격 하이라이트 > 없음 */
  private applyHighlight(id: Id): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const sel = this.selected.has(id);
    const remote = sel ? undefined : this.remoteHighlights.get(id);
    // 솔리드: 메시 emissive (보이는 메시라 그대로 동작)
    const mat = entry.mesh.material as THREE.MeshLambertMaterial;
    if (sel) {
      mat.emissive.setHex(SELECT_EMISSIVE);
      mat.emissiveIntensity = 0.3;
    } else if (remote) {
      mat.emissive.set(remote);
      mat.emissiveIntensity = 0.25;
    } else {
      mat.emissive.setHex(0x000000);
    }
    // 주석·스케치(line): 픽 프록시 메시(opacity 0.04)는 emissive가 안 보임 → 보이는 에지·스프라이트 강조.
    // 스케치 복원색 = owned 에지 머티리얼(스타일색, 공유 edgeMat 아님). zone은 채움 emissive도 같이 동작.
    if (
      entry.kind === 'grid' ||
      entry.kind === 'text' ||
      entry.kind === 'label' ||
      entry.kind === 'dimension' ||
      entry.kind === 'sketch'
    ) {
      const base =
        entry.kind === 'grid'
          ? this.gridEdgeMat
          : entry.kind === 'sketch'
            ? (entry.ownedEdgeMat ?? this.edgeMat)
            : this.edgeMat;
      entry.edges.material = sel ? this.selEdgeMat : remote ? this.remoteEdgeMat(remote) : base;
      const tint = sel ? SELECT_EMISSIVE : remote ?? 0xffffff;
      for (const s of entry.sprites) (s.material as THREE.SpriteMaterial).color.set(tint);
    }
  }

  /** 원격 선택 에지색 — 피어 색별 LineBasicMaterial 캐시(매 변경 재생성 방지). */
  private remoteEdgeMat(color: string): THREE.LineBasicMaterial {
    let m = this.remoteEdgeMats.get(color);
    if (!m) {
      m = new THREE.LineBasicMaterial({ color });
      this.remoteEdgeMats.set(color, m);
    }
    return m;
  }

  /** 평면 모드에서 비활성 레벨 고스팅 (15% — ArchiCAD 고스트 스토리 식) */
  setViewContext(mode: '3d' | 'plan', activeLevelId: Id | null): void {
    this.viewMode = mode;
    this.activeLevelId = activeLevelId;
    for (const entry of this.entries.values()) {
      this.applyGhosting(entry);
      for (const s of entry.sprites) this.flipSprite(s);
    }
    for (const s of this.commentPins.values()) this.flipSprite(s);
    this.engine.requestRender();
  }

  /**
   * 라벨/핀 스프라이트 X 역-flip — plan 직교뷰는 프로젝션 X가 음수(동=右 위해 반사)라 스프라이트
   * quad(텍스트)가 거울로 그려진다. **텍스처 U를 뒤집어** 상쇄(반사×반사=정방향). scale.x 부호는
   * 스프라이트 렌더러가 무시(|scale|)라 안 먹힘. 3D는 반사 없음 → repeat.x=1. 멱등.
   */
  private flipSprite(s: THREE.Sprite): void {
    const map = (s.material as THREE.SpriteMaterial).map;
    if (!map) return;
    map.center.set(0.5, 0.5);
    map.repeat.x = this.viewMode === 'plan' ? -1 : 1;
    map.needsUpdate = true;
  }

  /**
   * 스케치 스타일(색·투명도·모드) 적용 — deriveKey가 style 제외라 geo 무변경 시에도 호출됨.
   * line=메시는 픽 프록시(투명)+보이는 styled edges · zone=styled 채움+edges. owned 에지 머티리얼 갱신.
   */
  private applySketchStyle(entry: SceneEntry, el: SketchElement): void {
    const s = el.style;
    const key = `${el.mode}|${s.color}|${s.opacity}|${s.width}|${s.lineType}`;
    if (key === entry.styleKey) return;
    entry.styleKey = key;
    // 메시: line=픽 프록시(투명), zone=styled 채움
    const mat = entry.mesh.material as THREE.MeshLambertMaterial;
    if (el.mode === 'line') {
      mat.transparent = true;
      mat.opacity = 0.04;
      mat.depthWrite = false;
      mat.side = THREE.FrontSide;
    } else {
      mat.color.set(s.color);
      mat.transparent = s.opacity < 1;
      mat.opacity = s.opacity;
      mat.depthWrite = true;
      // zone 채움 = buildFaces 단면(deriveZone u,-v 플립) → 그린 쪽서 back-face. DoubleSide로 양면 표시.
      mat.side = THREE.DoubleSide;
    }
    mat.needsUpdate = true;
    // 픽 우선(annotation) = line 모드만 — 투명 프록시 리본이라 아래 솔리드 안 가림. zone은 보이는 채움이라
    // 우선픽이면 밑의 모든 솔리드 픽을 가로챔 → mode 따라 갱신(모드 변경 시 동기).
    entry.mesh.userData['annotation'] = el.mode === 'line';
    // owned 에지 머티리얼 — lineType별 클래스(solid=Basic / dashed·dotted=Dashed). 변경 시 재생성.
    // edges.material 자체는 applyHighlight(upsert 끝)가 선택상태대로 설정 → 여기선 안 건드림.
    const wantDashed = s.lineType !== 'solid';
    const isDashed = entry.ownedEdgeMat instanceof THREE.LineDashedMaterial;
    if (!entry.ownedEdgeMat || wantDashed !== isDashed) {
      entry.ownedEdgeMat?.dispose();
      entry.ownedEdgeMat = wantDashed
        ? new THREE.LineDashedMaterial({ color: s.color })
        : new THREE.LineBasicMaterial({ color: s.color });
    }
    const ed = entry.ownedEdgeMat;
    ed.color.set(s.color);
    ed.transparent = s.opacity < 1;
    ed.opacity = s.opacity;
    if (ed instanceof THREE.LineDashedMaterial) {
      // 대시 크기 = 데시메이트 세그(≥40mm)보다 작게 — LineSegments는 세그별 거리 리셋이라
      // 세그보다 크면 solid로 보임(다정점 연속 대시 = S3b Line2). 월드 m 단위.
      ed.dashSize = s.lineType === 'dotted' ? 0.006 : 0.025;
      ed.gapSize = s.lineType === 'dotted' ? 0.018 : 0.025;
      entry.edges.computeLineDistances();
    }
    ed.needsUpdate = true;
  }

  private applyGhosting(entry: SceneEntry): void {
    // 그리드·주석(text/label/dimension)은 픽 프록시 메시가 거의 투명(생성 시 설정) — 고스팅 제외.
    // 그리드는 전 층 공통, 주석은 메시가 픽 전용이라 불투명 처리하면 안 됨(불투명화 시 텍스트 위 솔리드 박스).
    // 스케치는 owned 에지 머티리얼이라 공유 ghostEdgeMat로 덮으면 색 손실 → 제외(S1: 전 레벨 표시).
    if (
      entry.kind === 'grid' ||
      entry.kind === 'text' ||
      entry.kind === 'label' ||
      entry.kind === 'dimension' ||
      entry.kind === 'sketch'
    )
      return;
    const ghosted =
      this.viewMode === 'plan' &&
      this.activeLevelId !== null &&
      entry.levelId !== null &&
      entry.levelId !== this.activeLevelId;
    const mat = entry.mesh.material as THREE.MeshLambertMaterial;
    const baseOpacity = entry.kind === 'opening:window' ? 0.55 : 1;
    mat.transparent = ghosted || baseOpacity < 1;
    mat.opacity = ghosted ? GHOST_OPACITY : baseOpacity;
    mat.needsUpdate = true;
    entry.edges.material = ghosted ? this.ghostEdgeMat : this.edgeMat;
    if (entry.glassMesh) {
      const gm = entry.glassMesh.material as THREE.MeshLambertMaterial;
      gm.opacity = ghosted ? GHOST_OPACITY : GLASS_OPACITY;
      gm.needsUpdate = true;
    }
  }

  private upsert(id: Id, index?: DeriveIndex): void {
    const geo = this.derive.derive(this.store, id, index);
    if (!geo) {
      this.remove(id);
      return;
    }
    const el = this.store.getElement(id);
    if (!el) return;

    // 종류별 시각 속성
    const elType = 'typeId' in el ? this.store.getType(el.typeId) : undefined;
    const color =
      el.kind === 'grid'
        ? '#c0392b'
        : el.kind === 'sketch'
          ? el.style.color
          : elType && 'color' in elType
            ? elType.color
            : '#cccccc';
    const kind =
      el.kind === 'opening' && elType?.kind === 'opening'
        ? `opening:${elType.opening.kind}`
        : el.kind;
    // 개구부의 레벨 = 호스트 벽의 레벨 (고스팅용)
    let levelId: Id | null = null;
    if ('levelId' in el) levelId = el.levelId;
    else if (el.kind === 'opening') {
      const host = this.store.getElement(el.hostId);
      levelId = host && 'levelId' in host ? host.levelId : null;
    }

    let entry = this.entries.get(id);
    if (!entry) {
      const mat = new THREE.MeshLambertMaterial({ color });
      const isAnnotationKind =
        el.kind === 'grid' || el.kind === 'text' || el.kind === 'label' || el.kind === 'dimension';
      if (isAnnotationKind) {
        // 픽킹 전용 프록시 메시 (거의 안 보이게) — 그리드 리본·텍스트/레이블 박스·치수선 리본.
        // 보이는 것은 라벨 스프라이트(text/label/dim)와 에지(dimension 치수선·label 지시선)뿐.
        mat.transparent = true;
        mat.opacity = 0.04;
        mat.depthWrite = false;
      }
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.userData['elementId'] = id;
      // 주석·스케치(line만) 프록시 = Picker 우선 픽(솔리드에 가려도 선택되게 — iter-2 3).
      // sketch zone은 보이는 채움이라 우선픽 제외(applySketchStyle가 mode별 갱신).
      if (isAnnotationKind || (el.kind === 'sketch' && el.mode === 'line')) mesh.userData['annotation'] = true;
      // 스케치 = 스타일색 owned 에지 머티리얼(공유 edgeMat 아님 — remove서 dispose)
      const ownedEdgeMat = el.kind === 'sketch' ? new THREE.LineBasicMaterial({ color: el.style.color }) : null;
      const edges = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        el.kind === 'grid' ? this.gridEdgeMat : (ownedEdgeMat ?? this.edgeMat),
      );
      this.engine.scene.add(mesh, edges);
      entry = {
        mesh,
        edges,
        baseColor: color,
        kind,
        levelId,
        labelKey: '',
        sprites: [],
        lastGeo: null,
        glassMesh: null,
        ownedEdgeMat,
        styleKey: '',
      };
      this.entries.set(id, entry);
      this.applyGhosting(entry);
    }
    if (entry.baseColor !== color) {
      (entry.mesh.material as THREE.MeshLambertMaterial).color.set(color);
      entry.baseColor = color;
    }
    if (entry.levelId !== levelId || entry.kind !== kind) {
      entry.levelId = levelId;
      entry.kind = kind;
      this.applyGhosting(entry);
    }

    if (entry.lastGeo !== geo) {
      setBufferGeometry(entry.mesh.geometry, geo.positions, geo.normals);
      setLineGeometry(entry.edges.geometry, geo.edges);
      // dashed/dotted 스케치는 대시 패턴용 누적거리 필요(geo 갱신마다 재계산 — LineSegments 메서드)
      if (el.kind === 'sketch' && el.style.lineType !== 'solid') entry.edges.computeLineDistances();
      entry.lastGeo = geo;
      this.updateLabels(entry, geo);
      this.syncGlass(entry, id, geo);
    }

    // 스케치 스타일 적용(생성+변경) — geo 설정 후(대시 거리 유효). deriveKey가 style 제외라 무변경시에도.
    if (el.kind === 'sketch') this.applySketchStyle(entry, el);

    this.applyHighlight(id);
  }

  /** 반투명 자식 메시(커튼월 유리 패널) 동기 — 메인 메시는 단일 머티리얼 유지(핫 캐스트 경로 무영향). */
  private syncGlass(entry: SceneEntry, id: Id, geo: DerivedGeometry): void {
    if (geo.panels) {
      if (!entry.glassMesh) {
        const gm = new THREE.Mesh(
          new THREE.BufferGeometry(),
          new THREE.MeshLambertMaterial({
            color: GLASS_COLOR,
            transparent: true,
            opacity: GLASS_OPACITY,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        gm.userData['elementId'] = id; // 유리 픽 = 커튼월 선택
        this.engine.scene.add(gm);
        entry.glassMesh = gm;
      }
      setBufferGeometry(entry.glassMesh.geometry, geo.panels.positions, geo.panels.normals);
      this.applyGhosting(entry); // 새 유리 불투명도를 현재 고스트 상태에 동기
    } else if (entry.glassMesh) {
      this.engine.scene.remove(entry.glassMesh);
      entry.glassMesh.geometry.dispose();
      (entry.glassMesh.material as THREE.Material).dispose();
      entry.glassMesh = null;
    }
  }

  /**
   * 라벨 채널 스프라이트 (그리드 버블·텍스트·치수). 텍스트/스타일 변경 시만
   * 스프라이트(캔버스 텍스처) 재생성, 위치는 매 geo 갱신마다 재배치 (GC 누수 방지).
   */
  private updateLabels(entry: SceneEntry, geo: DerivedGeometry): void {
    const labels = geo.labels ?? [];
    const key = labels.map((l) => `${l.style ?? 'grid'}:${l.text}`).join('|');
    if (key !== entry.labelKey) {
      for (const s of entry.sprites) {
        this.engine.scene.remove(s);
        s.material.map?.dispose();
        s.material.dispose();
      }
      entry.sprites = labels.map((l) => {
        const s = makeLabelSprite(l.text, l.style ?? 'grid');
        this.flipSprite(s); // plan 모드면 X 역-flip(생성 시점 반영)
        this.engine.scene.add(s);
        return s;
      });
      entry.labelKey = key;
    }
    labels.forEach((l, i) => entry.sprites[i]?.position.set(...l.pos));
  }

  /** 디버그/스모크 전용 — 라이브 파생 경로가 만든 라벨 텍스트 키 (`style:text|...`). */
  debugLabelKey(id: Id): string | null {
    return this.entries.get(id)?.labelKey ?? null;
  }

  private remove(id: Id): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.engine.scene.remove(entry.mesh, entry.edges, ...entry.sprites);
    entry.mesh.geometry.dispose();
    entry.edges.geometry.dispose();
    (entry.mesh.material as THREE.Material).dispose();
    entry.ownedEdgeMat?.dispose(); // 스케치 owned 에지 머티리얼 (공유 edgeMat은 dispose 안 함)
    if (entry.glassMesh) {
      this.engine.scene.remove(entry.glassMesh);
      entry.glassMesh.geometry.dispose();
      (entry.glassMesh.material as THREE.Material).dispose();
    }
    for (const s of entry.sprites) {
      s.material.map?.dispose();
      s.material.dispose();
    }
    this.entries.delete(id);
    this.derive.evict(id);
    this.selected.delete(id);
  }
}

/**
 * 어트리뷰트 갱신 — 길이가 같으면 기존 GL 버퍼에 복사(needsUpdate),
 * 다를 때만 새 BufferAttribute (드래그 중 매 프레임 버퍼 재생성으로 인한
 * GPU 메모리 churn 방지 — three는 교체된 어트리뷰트의 GL 버퍼를 GC까지 못 푼다).
 */
function updateAttr(geometry: THREE.BufferGeometry, name: string, array: Float32Array): void {
  const attr = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
  if (attr && attr.array.length === array.length) {
    (attr.array as Float32Array).set(array);
    attr.needsUpdate = true;
  } else {
    geometry.setAttribute(name, new THREE.BufferAttribute(array, 3));
  }
}

export function setBufferGeometry(
  geometry: THREE.BufferGeometry,
  positions: Float32Array,
  normals: Float32Array,
): void {
  updateAttr(geometry, 'position', positions);
  updateAttr(geometry, 'normal', normals);
  geometry.computeBoundingSphere();
}

export function setLineGeometry(geometry: THREE.BufferGeometry, positions: Float32Array): void {
  updateAttr(geometry, 'position', positions);
  geometry.computeBoundingSphere();
}
