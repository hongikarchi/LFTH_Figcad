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
  ui.setActiveLevel(seed.levelId);
}

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
tools.setActive(useUiStore.getState().activeTool);

// --- 협업: 프로바이더 + presence + 사용자별 undo ---
const { provider } = setupCollab(ydoc);
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
    sceneManager.setSelected(null);
  }
  if (state.viewMode !== prev.viewMode || state.activeLevelId !== prev.activeLevelId) {
    rig.setMode(state.viewMode);
    sceneManager.setViewContext(state.viewMode, state.activeLevelId);
    engine.requestRender();
  }
  if (state.selection !== prev.selection) {
    sceneManager.setSelected(state.selection);
    presence.setSelection(state.selection ? [state.selection] : []);
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
      if (sel) {
        store.deleteElements([sel]);
        useUiStore.getState().setSelection(null);
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
};
createRoot(document.getElementById('ui-root')!).render(
  createElement(App, { store, actions: viewActions }),
);

engine.requestRender();

// 데브 전용: E2E 테스트가 실제 브라우저 경로(프로바이더 포함)로 문서를 조작할 수 있게 노출
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>)['__figcad'] = { store, ydoc, seed };
}
