import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import * as Y from 'yjs';
import { DocStore, seedDocument } from '@figcad/core';
import { Engine } from './engine/Engine';
import { CameraRig } from './engine/CameraRig';
import { buildScene } from './engine/buildScene';
import { SceneManager } from './engine/SceneManager';
import { InputManager } from './input/InputManager';
import { HudLayer } from './hud/HudLayer';
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
import { DimensionTool } from './tools/DimensionTool';
import { TextTool } from './tools/TextTool';
import { SketchTool } from './tools/SketchTool';
import { CommentTool } from './tools/CommentTool';
import { SectionTool } from './tools/SectionTool';
import { ZoneTool } from './tools/ZoneTool';
import { CurtainWallTool } from './tools/CurtainWallTool';
import { setupCollab } from './collab/provider';
import { Presence, NOOP_COLLAB } from './collab/presence';
import { useUiStore } from './state/uiStore';
import { App } from './ui/App';
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
const sceneManager = new SceneManager(store, engine);
const hud = new HudLayer();
engine.addTicker(() => {
  hud.reproject(rig.active);
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
tools.register('dimension', new DimensionTool(ctx));
tools.register('text', new TextTool(ctx));
tools.register('sketch', new SketchTool(ctx));
tools.register('comment', new CommentTool(ctx));
tools.register('section', new SectionTool(ctx, 'section'));
tools.register('elevation', new SectionTool(ctx, 'elevation'));
tools.setActive(useUiStore.getState().activeTool);

// --- 협업: 프로바이더 + presence + 사용자별 undo ---
const { provider, projectId } = setupCollab(ydoc);
const presence = new Presence(provider.awareness, engine, sceneManager, hud, (n) =>
  useUiStore.getState().setPeerCount(n),
);
ctx.collab = presence;

provider.on('status', (e: { status: string }) => {
  const map = { connected: 'connected', connecting: 'connecting', disconnected: 'offline' } as const;
  useUiStore.getState().setConnection(map[e.status as keyof typeof map] ?? 'offline');
});

const undoMgr = store.createUndoManager();
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

new InputManager(
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
  },
);

// --- UI 상태 → 엔진/도구/awareness 동기화 (React는 uiStore만 쓴다) ---
useUiStore.subscribe((state, prev) => {
  if (state.activeTool !== prev.activeTool) {
    tools.setActive(state.activeTool);
    sceneManager.setSelected([]);
  }
  if (state.viewMode !== prev.viewMode || state.activeLevelId !== prev.activeLevelId) {
    rig.setMode(state.viewMode);
    sceneManager.setViewContext(state.viewMode, state.activeLevelId);
    engine.requestRender();
  }
  if (state.selection !== prev.selection) {
    sceneManager.setSelected(state.selection);
    presence.setSelection(state.selection);
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
  switch (e.key) {
    case 'Escape':
      tools.cancel();
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
const viewActions = {
  zoomIn: () => {
    rig.zoom(1 / 1.25);
    engine.requestRender();
  },
  zoomOut: () => {
    rig.zoom(1.25);
    engine.requestRender();
  },
  focusWorld: (x: number, y: number, z: number) => {
    rig.focusOn(x, y, z);
    engine.requestRender();
  },
};
createRoot(document.getElementById('ui-root')!).render(
  createElement(App, { store, actions: viewActions }),
);

engine.requestRender();

// 데브 전용: E2E·스트레스 테스트가 실제 브라우저 경로로 문서/렌더를 조작할 수 있게 노출
if (import.meta.env.DEV) {
  void Promise.all([
    import('@figcad/core'),
    import('./interop/ifcClient'),
    import('./ai/sketchCapture'),
  ]).then(([{ lint }, ifc, sketch]) => {
    (window as unknown as Record<string, unknown>)['__figcad'] = {
      store,
      ydoc,
      seed,
      engine,
      rig,
      lint,
      ifc, // { downloadIfc, parseIfc } — web-ifc는 호출 시에만 로드
      sketch, // { rasterizeSketch, hasSketch, clearSketch, getStrokes } — E2E용
      ui: useUiStore,
    };
  });
}
