import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import * as THREE from 'three';
import * as Y from 'yjs';
import { DocStore, seedDocument, diffSnapshots, type Viewpoint, type DocSnapshot } from '@figcad/core';
import { Engine } from './engine/Engine';
import { CameraRig, lensMmToFovDeg, type ViewPreset } from './engine/CameraRig';
import { buildScene } from './engine/buildScene';
import { SceneManager } from './engine/SceneManager';
import { ReferenceLayer } from './engine/ReferenceLayer';
import { raycastPoint } from './engine/Picker';
import { DiffOverlay } from './engine/diffOverlay';
import { computeSectionContour, computeSectionFill } from './engine/sectionContour';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { FederationReconciler } from './engine/FederationReconciler';
import { MaterialReconciler } from './engine/MaterialReconciler';
import { FEDERATION_EXTRACTORS, fetchDwgUnderlay } from './interop/federationExtract';
import { InputManager } from './input/InputManager';
import { initHotkeys } from './input/hotkeys';
import { WalkController } from './input/WalkController';
import { HudLayer } from './hud/HudLayer';
import { WalkJoystick } from './hud/WalkJoystick';
import { ToolController } from './tools/ToolController';
import { WallTool } from './tools/WallTool';
import { SelectTool } from './tools/SelectTool';
import { OpeningTool } from './tools/OpeningTool';
import { SlabTool } from './tools/SlabTool';
import { GridTool } from './tools/GridTool';
import { ColumnTool } from './tools/ColumnTool';
import { BeamTool } from './tools/BeamTool';
import { StairTool } from './tools/StairTool';
import { RailingTool } from './tools/RailingTool';
import { RoofTool } from './tools/RoofTool';
import { MeasureTool } from './tools/MeasureTool';
import { LabelTool } from './tools/LabelTool';
import { SketchTool } from './tools/SketchTool';
import { MarkupTool } from './tools/MarkupTool';
import { PaintTool } from './tools/PaintTool';
import { CommentTool } from './tools/CommentTool';
import { SectionTool } from './tools/SectionTool';
import { ZoneTool } from './tools/ZoneTool';
import { AssetTool } from './tools/AssetTool';
import { CurtainWallTool } from './tools/CurtainWallTool';
import { setupCollab } from './collab/provider';
import { Presence, NOOP_COLLAB } from './collab/presence';
import { useUiStore, type ClipState } from './state/uiStore';
import { App } from './ui/App';
import { initDeviceClass } from './ui/useDeviceClass';
import type { EditorContext } from './tools/context';

// --- 문서: Y.Doc 하나 = 프로젝트 하나 (URL ?p=) ---
const ydoc = new Y.Doc();
const store = new DocStore(ydoc);
const seed = seedDocument(store); // 고정 id 시드 — 동시 시드해도 수렴
{
  const ui = useUiStore.getState();
  ui.setActiveType('wall', seed.wallTypeIds[0]!);
  ui.setActiveType('door', seed.doorTypeId);
  ui.setActiveType('window', seed.windowTypeId);
  ui.setActiveType('slab', seed.slabTypeId);
  ui.setActiveType('column', seed.columnTypeId);
  ui.setActiveType('beam', seed.beamTypeId);
  ui.setActiveType('stair', seed.stairTypeId);
  ui.setActiveType('railing', seed.railingTypeId);
  ui.setActiveType('roof', seed.roofTypeId);
  ui.setActiveType('curtainwall', seed.curtainWallTypeId);
  ui.setActiveLevel(seed.levelId);
}

// 활성 레벨/타입이 (원격 편집·JSON import로) 삭제되면 첫 항목으로 복구 —
// 죽은 id로 그리면 보이지 않는 요소가 문서에 쌓인다
store.observe(() => {
  const ui = useUiStore.getState();
  if (ui.activeLevelId && !store.getLevel(ui.activeLevelId)) {
    const first = store.listLevels()[0];
    if (first) ui.setActiveLevel(first.id);
  }
  const typeKindOf = {
    wall: 'wall',
    door: 'opening',
    window: 'opening',
    slab: 'slab',
    column: 'column',
    beam: 'beam',
    stair: 'stair',
    railing: 'railing',
    roof: 'roof',
    curtainwall: 'curtainwall',
  } as const;
  for (const k of ['wall', 'door', 'window', 'slab', 'column', 'beam', 'stair', 'railing', 'roof', 'curtainwall'] as const) {
    const id = ui.activeTypes[k];
    if (id && !store.getType(id)) {
      const candidates = store.listTypes(typeKindOf[k]);
      // 문/창은 같은 opening kind 안에서 세부 종류 일치 우선
      const next =
        k === 'door' || k === 'window'
          ? candidates.find((t) => t.kind === 'opening' && t.opening.kind === k)
          : candidates[0];
      if (next) ui.setActiveType(k, next.id);
    }
  }
});

// --- 렌더 ---
const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const rig = new CameraRig(window.innerWidth / window.innerHeight);
const engine = new Engine(canvas, () => rig.active);
engine.addTicker((dt) => rig.tick(dt));
buildScene(engine.scene);
const hud = new HudLayer();
const sceneManager = new SceneManager(store, engine, hud);
// M13 멀티모델 허브: 외부 모델 read-only 오버레이(별도 표현, derive·store 밖 — 불변①).
// reconciler가 동기화된 federation 채널을 ReferenceLayer(로컬 메시)에 반영(명령형 — 불변③).
const referenceLayer = new ReferenceLayer(engine);
const federation = new FederationReconciler(store, referenceLayer, FEDERATION_EXTRACTORS, fetchDwgUnderlay);
// 프로젝션 X 반사 상쇄 동기 — plan 탑다운 또는 입면/저면 ortho(A-S1)면 스프라이트 텍스트가 거울로
// 그려지므로 텍스처 U 반전으로 상쇄. rig.projection은 rig 내부 상태라 뷰 상태를 바꾸는 모든 경로
// (viewMode 구독·setView 프리셋·뷰포인트 점프·걷기 진입)에서 이 헬퍼로 재동기한다.
const syncMirrorComp = () => {
  const mirrored =
    useUiStore.getState().viewMode === 'plan' || (rig.mode === '3d' && !rig.isWalking && rig.isOrtho);
  sceneManager.setMirrorComp(mirrored);
  referenceLayer.setPlanFlipped(mirrored);
};
syncMirrorComp(); // 초기 모드 반영(뷰모드 변경 훅이 init엔 안 불림 → 평면서 업로드 시 텍스트 미러 방지)
// 재질 오버라이드(materials 채널) → ReferenceLayer 재질 재적용 (페인트 도구 — 임포트 레이어/카테고리 도색)
new MaterialReconciler(store, referenceLayer);
const diffOverlay = new DiffOverlay(engine.scene); // 버전 비교 3D 오버레이(항목4) — VersionPanel이 previewDiff로 구동

// 줌 익스텐트(전체맞춤) — 씬 전체 bbox(네이티브 derive + federation 레퍼런스 메시)로 카메라 맞춤.
// import/federation 모델은 원점서 멀거나 커서 기본 카메라엔 빈 화면 → 이게 해결. 'F' 키 + federation 로드 후 1회 자동.
// 모델 bbox(요소 메시 + 보이는 federation 레퍼런스, 고정 그리드 제외) — fit·clip 공유.
function modelBox(): THREE.Box3 {
  const box = new THREE.Box3();
  for (const o of sceneManager.pickables) box.expandByObject(o);
  box.union(referenceLayer.visibleBounds());
  return box;
}
// 항목1: 원점서 먼 모델 밑에 그리드(z=0)+ground를 깔기 — 모델 bbox 중심(x,z)으로 이동(y=0 유지,
// 정수 미터 스냅으로 격자선 정렬). fit/로드 시에만 호출(매 doc 변경 갱신은 churn — 회피).
function recenterGrid(box: THREE.Box3): void {
  if (box.isEmpty() || !isFinite(box.min.x)) return;
  const cx = Math.round((box.min.x + box.max.x) / 2);
  const cz = Math.round((box.min.z + box.max.z) / 2);
  const grid = engine.scene.userData['grid'] as THREE.Object3D | undefined;
  const ground = engine.scene.userData['ground'] as THREE.Object3D | undefined;
  if (grid) grid.position.set(cx, grid.position.y, cz);
  if (ground) ground.position.set(cx, ground.position.y, cz);
}
function fitView(): boolean {
  const box = modelBox();
  if (box.isEmpty() || !isFinite(box.min.x)) return false;
  recenterGrid(box);
  rig.fitBounds(box.min, box.max);
  engine.requestRender();
  return true;
}
// 줌-선택(Z) — 선택 요소 bbox만 프레이밍. 선택 없거나 bbox 못 구하면 전체맞춤 폴백.
function fitSelection(): boolean {
  const sel = useUiStore.getState().selection;
  if (!sel.length) return fitView();
  const box = sceneManager.boundsOf(sel);
  if (box.isEmpty() || !isFinite(box.min.x)) return fitView();
  rig.fitBounds(box.min, box.max);
  engine.requestRender();
  return true;
}
// 단면(클리핑 플레인) — 전역 renderer.clippingPlanes(전 머티리얼 클립). 평면 위치 = 모델 bbox축 0~1.
// + 단면선(section line): 오버레이 메시∩평면 윤곽을 CPU로 그려 라이노식 절단선 실시간 표시(디바운스).
let currentClip: ClipState | null = null;
// 라이노식 굵은 절단선 — LineSegments2(인스턴스 쿼드)라 WebGL 1px 한계 회피(LineBasicMaterial은 linewidth 무시).
// LineMaterial.resolution은 드로잉버퍼(px·DPR)와 일치해야 안 보이거나 굵기 틀림 → 생성 시 + resize서 갱신 필수.
const sectionLineMat = new LineMaterial({ color: 0x1d1d1f, linewidth: 2.5 });
const sectionLine = new LineSegments2(new LineSegmentsGeometry(), sectionLineMat);
sectionLine.visible = false;
sectionLine.renderOrder = 3;
sectionLine.frustumCulled = false;
engine.scene.add(sectionLine);
// 단면 poché(해치) 채움 — 닫힌 루프만(computeSectionFill). 라인(renderOrder 3) 아래·클레이 위(2), 반투명.
const sectionFill = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({ color: 0x8a909a, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
);
sectionFill.visible = false;
sectionFill.renderOrder = 2;
sectionFill.frustumCulled = false;
engine.scene.add(sectionFill);
function updateSectionResolution(): void {
  const v = new THREE.Vector2();
  engine.renderer.getDrawingBufferSize(v);
  sectionLineMat.resolution.copy(v);
}
updateSectionResolution();
window.addEventListener('resize', updateSectionResolution); // Engine resize 뒤(등록 순서) → 새 드로잉버퍼 크기 반영
let contourTimer: ReturnType<typeof setTimeout> | null = null;
let prevClipAxis: ClipState['axis'] | null = null;
let prevClipT = -1;
function scheduleContour(plane: THREE.Plane): void {
  if (contourTimer) clearTimeout(contourTimer);
  // 디바운스 — 슬라이더 드래그 매 입력마다 메시 재스캔 방지(release 후 1회). 드래그 중엔 직전 윤곽 유지.
  // (실측: 1.25M-tri 단일 메시 ~31ms = 잭 임계 이하. 오프셋은 applyClip서 즉시 설정 — flip 깜빡임 방지.)
  contourTimer = setTimeout(() => {
    if (!currentClip) return;
    updateSectionResolution(); // 매 재빌드 시 드로잉버퍼 크기 재반영(LineMaterial.resolution 신선 유지 — clip 시점엔 DPR 안정).
    // 보이는·비언더레이 솔리드만(숨긴/2D 오버레이 유령 절단선 방지 — Codex 리뷰).
    const seg = computeSectionContour(referenceLayer.sectionMeshes(), plane);
    if (seg.length > 0) {
      sectionLine.geometry.dispose(); // 이전 인스턴스 버퍼 해제(setPositions가 새 InterleavedBuffer 생성).
      sectionLine.geometry.setPositions(seg); // 6 float = 1세그먼트(start xyz, end xyz) — 윤곽 출력 형식과 동일.
      sectionLine.visible = true; // frustumCulled=false + 미레이캐스트 → boundingSphere 불요(Codex).
      // poché 채움 — 절단선 세그먼트 재사용(재계산 없음), 닫힌 루프만 채워짐(열린 경계=선만).
      const fill = computeSectionFill(seg, plane);
      sectionFill.geometry.dispose();
      sectionFill.geometry.setAttribute('position', new THREE.BufferAttribute(fill, 3));
      sectionFill.visible = fill.length > 0;
    } else {
      sectionLine.visible = false;
      sectionFill.visible = false;
    }
    engine.requestRender();
  }, 130);
}
function applyClip(): void {
  const r = engine.renderer;
  if (!currentClip) { r.clippingPlanes = []; sectionLine.visible = sectionFill.visible = false; engine.requestRender(); return; }
  const box = modelBox();
  if (box.isEmpty() || !isFinite(box.min.x)) { r.clippingPlanes = []; sectionLine.visible = sectionFill.visible = false; engine.requestRender(); return; }
  const a = { x: 0, y: 1, z: 2 }[currentClip.axis];
  const min = box.min.getComponent(a);
  const max = box.max.getComponent(a);
  const pos = min + (max - min) * currentClip.t;
  const sign = currentClip.flip ? -1 : 1;
  // 평면: normal·P + constant > 0 인 쪽만 남김. sign=+면 axis>pos, flip(sign=-1)이면 axis<pos.
  const plane = new THREE.Plane(new THREE.Vector3().setComponent(a, sign), -pos * sign);
  r.clippingPlanes = [plane];
  const size = box.getSize(new THREE.Vector3());
  // 단면선을 kept 쪽으로 미세 오프셋 → 전역 clip이 같은 평면의 선을 잘라내지 않게.
  // 디바운스 밖(여기서 즉시) 설정해야 flip 시 ~130ms 깜빡임 없음(윤곽 동일, 노멀 부호만 반전).
  const off = (Math.max(size.x, size.y, size.z) + 1) * 0.0008;
  sectionLine.position.copy(plane.normal).multiplyScalar(off);
  sectionFill.position.copy(plane.normal).multiplyScalar(off);
  // axis/t 변경(flip 아님) 시 스테일 채움 시트 즉시 숨김 — 큰 회색면이 디바운스(130ms) 동안 잘못된
  // 방향/위치로 크게 보임(Codex). flip은 윤곽·채움 반사대칭 불변이라 유지. scheduleContour가 재계산 후 복원.
  if (currentClip.axis !== prevClipAxis || currentClip.t !== prevClipT) sectionFill.visible = false;
  prevClipAxis = currentClip.axis;
  prevClipT = currentClip.t;
  scheduleContour(plane);
  engine.requestRender();
}
window.addEventListener('keydown', (e) => {
  if (/^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement)?.tagName)) return;
  if (useUiStore.getState().walkActive) return; // 걷기 중 F/Z 무력 — F는 D 옆이라 오폭 위험
  if (e.key === 'f' || e.key === 'F') fitView();
  else if ((e.key === 'z' || e.key === 'Z') && !e.ctrlKey && !e.metaKey) fitSelection(); // 줌-선택 (Ctrl/⌘+Z=undo는 별도 핸들러)
});
initHotkeys(() => engine.requestRender()); // per-tool 핫키 레이어 (Slice 11 — W=벽·V=선택·1/2/3=모드)
// federation 소스가 처음 ready 되면 1회 자동 맞춤(오버레이가 화면 밖이면 무의미하므로).
let didFitFed = false;
let clipRefreshTimer: ReturnType<typeof setTimeout> | null = null;
federation.onChange(() => {
  // 모델이 clip 켠 뒤 로드되면 평면 위치 재계산. notify는 로드 중 여러 번 발화하므로 단일 트레일링 타이머로 합침.
  if (currentClip) {
    if (clipRefreshTimer) clearTimeout(clipRefreshTimer);
    clipRefreshTimer = setTimeout(() => { clipRefreshTimer = null; applyClip(); }, 120);
  }
  // 첫 ready 시 1회 자동 맞춤 — latch는 fitView 성공 후에만(스케줄 창서 reload로 소스 사라지면 fit 유실 방지).
  if (!didFitFed && referenceLayer.list().length > 0) {
    setTimeout(() => { if (!didFitFed && fitView()) didFitFed = true; }, 100);
  }
});
engine.addTicker(() => {
  hud.reproject(rig.active);
  hud.updateViewportWidgets(rig.worldPerPixel(), rig.northScreenAngle()); // 스케일바·방위표(줌/회전 실시간)
  return false;
});

// --- 도구 ---
const seedTypeByKind = {
  wall: seed.wallTypeIds[0]!,
  door: seed.doorTypeId,
  window: seed.windowTypeId,
  slab: seed.slabTypeId,
  column: seed.columnTypeId,
  beam: seed.beamTypeId,
  stair: seed.stairTypeId,
  railing: seed.railingTypeId,
  roof: seed.roofTypeId,
  curtainwall: seed.curtainWallTypeId,
} as const;
const ctx: EditorContext = {
  store,
  engine,
  rig,
  scene: sceneManager,
  hud,
  levelId: () => useUiStore.getState().activeLevelId ?? seed.levelId,
  typeId: (kind) => useUiStore.getState().activeTypes[kind] ?? seedTypeByKind[kind],
  wallTypeId: () => useUiStore.getState().activeTypes.wall ?? seedTypeByKind.wall,
  collab: NOOP_COLLAB,
  overlayRoot: referenceLayer.root, // 3D 코멘트 = 오버레이 메시 위 레이캐스트
  // 빽도면(언더레이) 끝점 스냅 후보 — 활성 레벨의 보이는 언더레이만 (읽기전용 트레이싱)
  importSnapCandidates: (near, radiusMm) =>
    federation.underlaySnapCandidates(useUiStore.getState().activeLevelId ?? seed.levelId, near, radiusMm),
};
const tools = new ToolController();
tools.register('wall', new WallTool(ctx));
tools.register('select', new SelectTool(ctx));
tools.register('door', new OpeningTool(ctx, 'door'));
tools.register('window', new OpeningTool(ctx, 'window'));
tools.register('slab', new SlabTool(ctx));
tools.register('grid', new GridTool(ctx));
tools.register('column', new ColumnTool(ctx));
tools.register('beam', new BeamTool(ctx));
tools.register('stair', new StairTool(ctx));
tools.register('railing', new RailingTool(ctx));
tools.register('roof', new RoofTool(ctx));
tools.register('curtainwall', new CurtainWallTool(ctx));
tools.register('zone', new ZoneTool(ctx));
tools.register('asset', new AssetTool(ctx)); // 오브젝트(엔투라지) 배치(항목7)
// 치수(dimension) 생성 도구 제거(항목5) — 측정(줄자)로 대체. 스키마·derive는 back-compat 보존(기존 요소 렌더).
tools.register('measure', new MeasureTool(ctx));
tools.register('label', new LabelTool(ctx));
tools.register('sketch', new SketchTool(ctx));
tools.register('sketch-pen', new MarkupTool(ctx));
tools.register('comment', new CommentTool(ctx));
tools.register('section', new SectionTool(ctx, 'section'));
tools.register('elevation', new SectionTool(ctx, 'elevation'));
tools.register('paint', new PaintTool(ctx)); // 재질 페인트 — 네이티브=타입, 임포트=레이어/카테고리 도색
tools.setActive(useUiStore.getState().activeTool);

// --- 협업: 프로바이더 + presence + 사용자별 undo ---
const { provider, projectId, persistence } = setupCollab(ydoc);
const presence = new Presence(
  provider.awareness,
  engine,
  sceneManager,
  hud,
  (n) => useUiStore.getState().setPeerCount(n),
  (peers) => useUiStore.getState().setPeers(peers), // 아바타 파일 (signature-diff됨, 커서 이동 무관)
);
ctx.collab = presence;
// presence 초기 정체성 1회 seed (혼자일 때도 내 아바타 표시 — 첫 awareness change 전까지)
useUiStore.getState().setUserName(presence.userName);
useUiStore.getState().setPeers([
  { clientId: provider.awareness.clientID, name: presence.userName, color: presence.color, self: true },
]);

provider.on('status', (e: { status: string }) => {
  const map = { connected: 'connected', connecting: 'connecting', disconnected: 'offline' } as const;
  useUiStore.getState().setConnection(map[e.status as keyof typeof map] ?? 'offline');
});

const undoMgr = store.createUndoManager();
// 협업 병합 알림(M13-B): undo는 로컬 출신 → '원격 머지' 오탐 제외. 초기 동기화(provider synced)
// 후에만 라이브 — 그전 캐시/서버 로드는 기존 요소라 알림 대상 아님(리뷰 반영).
store.registerLocalOrigin(undoMgr);
store.registerLocalOrigin(persistence); // IDB 캐시 리플레이 = 내 콘텐츠(원격 머지 오탐 방지)
provider.on('synced', () => store.setLive());
const doUndo = () => {
  undoMgr.undo();
  engine.requestRender();
};
const doRedo = () => {
  undoMgr.redo();
  engine.requestRender();
};

// fork(M6.5): VersionPanel이 한 버전 스냅샷을 localStorage에 두고 새 룸(?p=)을 연다.
// 이 룸이 그 핸드오프 대상이면 sync 후 importSnapshot으로 새 프로젝트 콘텐츠를 채운다.
// (서버 fork 불가 — 타겟 Doc DO storage는 인스턴스 격리라 클라가 채워야 함.)
const forkKey = `figcad.fork:${projectId}`;
if (localStorage.getItem(forkKey)) {
  let imported = false;
  const doImport = (): void => {
    if (imported) return;
    const raw = localStorage.getItem(forkKey);
    if (!raw) return;
    try {
      store.importSnapshot(JSON.parse(raw));
      imported = true;
      localStorage.removeItem(forkKey); // 성공 시에만 소비 — 실패면 새로고침 재시도 가능
      undoMgr.clear(); // fork = 룸 초기 콘텐츠 → 첫 undo가 전체를 되돌리지 않게
      engine.requestRender();
    } catch (e) {
      console.warn('[fork] import 실패 — 새로고침으로 재시도 가능', e);
      hud.toast('fork 콘텐츠 로드 실패 — 새로고침해 보세요');
    }
  };
  provider.on('synced', doImport); // sync 완료 시
  setTimeout(doImport, 2500); // 이벤트 미발화 폴백
}

// --- 걷기(1인칭) 모드 — 리뷰 walk. 이동=ticker, 조이스틱=명령형 HUD, 시선/휠은 InputManager 분기 ---
const walk = new WalkController(rig, {
  groundRoots: () => [...sceneManager.pickables, referenceLayer.root],
  levelElevationM: () => (store.getLevel(ctx.levelId())?.elevation ?? 0) / 1000,
  requestRender: () => engine.requestRender(),
  onToast: (m) => hud.toast(m),
});
engine.addTicker(walk.update);
const joystick = new WalkJoystick((x, y) => walk.setJoystick(x, y));
// 조이스틱 = 터치 능력 기준 (iPad는 device-class 'desktop' — device 기준 금지)
const hasTouch = window.matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0;

const input = new InputManager(
  canvas,
  rig,
  tools,
  () => (store.getLevel(ctx.levelId())?.elevation ?? 0) / 1000,
  () => engine.requestRender(),
  {
    onCursor: (doc) =>
      presence.setCursor(doc, (store.getLevel(ctx.levelId())?.elevation ?? 0) / 1000),
    onTwoFingerTap: doUndo,
    onThreeFingerTap: doRedo,
    walkActive: () => useUiStore.getState().walkActive,
    walkLook: (dx, dy) => walk.look(dx, dy),
    walkSpeed: (d) => walk.adjustSpeed(d),
    walkFocalDelta: (dMm) => {
      const s = useUiStore.getState();
      s.setLensMm(s.lensMm + dMm);
    },
    walkFocalPinch: (ratio) => {
      const s = useUiStore.getState();
      s.setLensMm(s.lensMm * ratio);
    },
    // 항목3: RMB 오빗 피벗 — 선택 있으면 그 중심, 없으면 커서 아래 메시(요소+federation 오버레이) 히트.
    // 둘 다 없으면 null → 현재 target 유지(지면 z=0 강제교차 금지: 상층/측량Z 모델서 거대호 회귀).
    resolvePivot: (clientX, clientY) => {
      const sel = useUiStore.getState().selection;
      if (sel.length) {
        const box = sceneManager.boundsOf(sel);
        if (!box.isEmpty() && isFinite(box.min.x)) {
          const c = box.getCenter(new THREE.Vector3());
          return [c.x, c.y, c.z];
        }
      }
      const hit = raycastPoint(clientX, clientY, rig.active, [...sceneManager.pickables, referenceLayer.root]);
      return hit ? [hit.x, hit.y, hit.z] : null;
    },
  },
);

// --- UI 상태 → 엔진/도구/awareness 동기화 (React는 uiStore만 쓴다) ---
useUiStore.subscribe((state, prev) => {
  if (state.activeTool !== prev.activeTool) {
    tools.setActive(state.activeTool);
    sceneManager.setSelected([]);
  }
  // 걷기 **종료**는 viewMode 블록보다 먼저 — setViewMode('plan')이 {plan, walkActive:false}를 단일
  // set으로 커밋하므로, exitWalk(걷기 방위 역산)가 setMode('plan')의 북향 스냅(θ=π)을 되덮지 않게
  // 순서 보장. (진입은 반대로 viewMode 블록 뒤 — rig.setMode('3d') 선행 필요.)
  const walkOff = !state.walkActive && prev.walkActive;
  const walkOn = state.walkActive && !prev.walkActive;
  if (walkOff) {
    input.resetTouch();
    document.body.classList.remove('walk-active');
    walk.exit();
    joystick.hide();
    rig.resetFov(); // 렌즈 = 걷기 스코프 — 오빗 복귀 시 기본 fov (lensMm 값은 localStorage 기억)
    engine.requestRender();
  }
  if (state.viewMode !== prev.viewMode || state.activeLevelId !== prev.activeLevelId) {
    rig.setMode(state.viewMode);
    sceneManager.setViewContext(state.viewMode, state.activeLevelId);
    syncMirrorComp(); // plan/입면 ortho 반사 상쇄 (라벨·핀·언더레이 텍스트)
    // 측정 중/완료 상태에서 모드·층 전환 = 3D 표면점과 지면점이 섞여 잘못된 거리 → 리셋(Codex 리뷰).
    if (tools.active instanceof MeasureTool) tools.active.cancel();
    engine.requestRender();
  }
  if (state.selection !== prev.selection) {
    sceneManager.setSelected(state.selection);
    presence.setSelection(state.selection);
  }
  // 걷기 **진입** — viewMode 블록 뒤(평면서 진입 시 rig.setMode('3d')가 walk.enter()보다 먼저 실행).
  if (walkOn) {
    input.resetTouch(); // 진행 중 터치 제스처 폐기 (스테일 포인터 방지)
    document.body.classList.add('walk-active');
    tools.cancel(); // 진행 중 드로우 체인 정리 (도구 자체는 유지 — 탭 클릭 계속 동작)
    rig.setFov(lensMmToFovDeg(state.lensMm));
    walk.enter(); // enterWalk가 projection persp 리셋 — 입면 ortho서 진입해도 원근
    syncMirrorComp();
    if (hasTouch) joystick.show();
    hud.toast(hasTouch ? '왼쪽 스틱 이동 · 화면 드래그 둘러보기' : 'WASD 이동 · 드래그 둘러보기 · 휠 속도 · Esc 종료');
    engine.requestRender();
  }
  if (state.lensMm !== prev.lensMm && state.walkActive) {
    rig.setFov(lensMmToFovDeg(state.lensMm));
    engine.requestRender();
  }
});

// --- 키보드 (PageUp/Down 줌, 화살표 팬 — Rhino shortcuts.htm / Ctrl+Z undo) ---
const ARROW_PAN_PX = 40;
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) doRedo();
    else doUndo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    doRedo();
    return;
  }
  // 걷기 중: Esc = 걷기 종료(도구 cancel 미실행), 나머지 단축키(PgUp/Dn·화살표·Delete) 무력
  // (WASD·Q/E·Shift는 WalkController 자체 리스너). Ctrl+Z/Y undo/redo는 위에서 이미 통과.
  if (useUiStore.getState().walkActive) {
    if (e.key === 'Escape') useUiStore.getState().setWalkActive(false);
    return;
  }
  switch (e.key) {
    case 'Escape':
      tools.cancel(); // 진행 중 드로우 체인 종료(기존 동작)
      useUiStore.getState().setTool('select'); // 그 다음 선택 도구로 (사용자 요청)
      engine.requestRender();
      break;
    case 'Delete':
    case 'Backspace': {
      const sel = useUiStore.getState().selection;
      if (sel.length) {
        store.deleteElements(sel);
        useUiStore.getState().setSelection([]);
      }
      break;
    }
    case 'PageUp':
      rig.zoom(1 / 1.25);
      engine.requestRender();
      break;
    case 'PageDown':
      rig.zoom(1.25);
      engine.requestRender();
      break;
    case 'ArrowLeft':
      rig.pan(ARROW_PAN_PX, 0);
      engine.requestRender();
      break;
    case 'ArrowRight':
      rig.pan(-ARROW_PAN_PX, 0);
      engine.requestRender();
      break;
    case 'ArrowUp':
      rig.pan(0, ARROW_PAN_PX);
      engine.requestRender();
      break;
    case 'ArrowDown':
      rig.pan(0, -ARROW_PAN_PX);
      engine.requestRender();
      break;
  }
});

// --- React UI (패널만 — 캔버스/HUD는 명령형) ---
// 카메라를 점프시키는 액션은 걷기 자동 종료 — zustand subscribe 동기 발화라 walk.exit()(오빗 복원)가
// setPose/fitBounds 실행 전 완료. saveViewpoint는 제외(걷기 중 저장 = getPose 합성으로 동작).
const exitWalk = () => useUiStore.getState().setWalkActive(false);
const viewActions = {
  focusWorld: (x: number, y: number, z: number) => {
    exitWalk();
    rig.focusOn(x, y, z);
    engine.requestRender();
  },
  undo: doUndo,
  redo: doRedo,
  fit: () => {
    exitWalk();
    fitView();
  },
  fitSelection: () => {
    exitWalk();
    fitSelection();
  },
  setClip: (clip: ClipState | null) => {
    currentClip = clip;
    applyClip();
  },
  // 현재 카메라 궤도 + viewMode + 단면(클립)을 뷰포인트로 저장(문서 채널, 전원 공유) → id.
  saveViewpoint: (name?: string) => {
    const s = useUiStore.getState();
    return store.addViewpoint({
      camera: rig.getPose(),
      viewMode: s.viewMode,
      clip: s.clip,
      author: presence.userName || '게스트', // presence.userName은 항상 문자열이나 방어적 폴백
      ...(name ? { name } : {}),
    });
  },
  // 저장 뷰포인트로 점프 — viewMode(→rig.setMode) → 카메라 포즈 스냅 → 클립 재현("N번 단면 봐주세요").
  jumpViewpoint: (vp: Viewpoint) => {
    exitWalk();
    const s = useUiStore.getState();
    s.setViewMode(vp.viewMode); // 구독이 rig.setMode + sceneManager.setViewContext
    rig.setPose(vp.camera); // projection persp 리셋 포함
    syncMirrorComp();
    s.setClipState(vp.clip);
    currentClip = vp.clip;
    applyClip();
    engine.requestRender();
  },
  // 버전 비교 3D 오버레이(항목4) — snap=커밋 스냅샷(before), null=끄기. diff는 현재 문서 대비 계산.
  previewDiff: (snap: DocSnapshot | null) => {
    if (snap) diffOverlay.show(store, snap, diffSnapshots(snap, store.snapshot()));
    else diffOverlay.clear();
    engine.requestRender();
  },
  // 뷰 기즈모 프리셋(항목8a) — rig가 mode+각도 설정, uiStore.viewMode 동기화(setViewContext·flip 트리거).
  setView: (preset: ViewPreset) => {
    exitWalk();
    rig.setView(preset);
    useUiStore.getState().setViewMode(rig.mode);
    syncMirrorComp(); // 입면/저면 ortho = X반사 — viewMode 무변화(3d 유지)라 구독이 안 불림
    engine.requestRender();
  },
};
// 협업 핸들 — presence 명령형 객체를 React 패널에 노출 (rename). peers/connection은 uiStore.
const collab = {
  setUserName: (name: string) => {
    presence.setUserName(name);
    useUiStore.getState().setUserName(name);
  },
};
initDeviceClass(); // mount 전 body.device-phone + store.device 교정(첫 페인트부터 모바일 셸 정확)
createRoot(document.getElementById('ui-root')!).render(
  createElement(App, { store, actions: viewActions, federation, collab }),
);

engine.requestRender();

// 데브 전용: E2E·스트레스 테스트가 실제 브라우저 경로로 문서/렌더를 조작할 수 있게 노출
if (import.meta.env.DEV) {
  void Promise.all([
    import('@figcad/core'),
    import('./interop/ifcClient'),
    import('./ai/sketchCapture'),
    import('./interop/federationExtract'),
    import('./interop/dwgClient'),
  ]).then(([{ lint }, ifc, sketch, federationExtract, dwg]) => {
    (window as unknown as Record<string, unknown>)['__figcad'] = {
      store,
      ydoc,
      seed,
      engine,
      rig,
      sceneManager, // 스모크: 라이브 파생 라벨 검증(debugLabelKey)
      tools, // 스모크: 도구 down/move/up 직접 구동(정점 편집 등)
      lint,
      ifc, // { downloadIfc, parseIfc } — web-ifc는 호출 시에만 로드
      sketch, // { rasterizeSketch, hasSketch, clearSketch, getStrokes } — E2E용
      // M13 멀티모델 허브: 프로덕션 referenceLayer + reconciler (federation 채널 구동).
      referenceLayer,
      federation,
      federationExtract, // { extractFigcadRoom, FEDERATION_EXTRACTORS } — A4 스모크/오프라인 추출용
      dwg, // { parseDwgUnderlay, underlayDenseCenter } — DWG 언더레이 스모크(libredwg WASM)
      ui: useUiStore,
      walk, // 걷기 모드 스모크 — active/setJoystick 직접 구동
    };
  });
}
