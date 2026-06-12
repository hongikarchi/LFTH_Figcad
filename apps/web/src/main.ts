import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
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
import { useUiStore } from './state/uiStore';
import { App } from './ui/App';
import type { EditorContext } from './tools/context';

// --- 문서 (M1: 로컬 메모리. M2: Yjs + 서버 동기화로 내부 스왑) ---
const store = new DocStore();
const seed = seedDocument(store);
useUiStore.getState().setActiveWallType(seed.wallTypeIds[0]!);

// --- 렌더 ---
const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const rig = new CameraRig(window.innerWidth / window.innerHeight);
const engine = new Engine(canvas, () => rig.active);
engine.addTicker((dt) => rig.tick(dt));
buildScene(engine.scene);
const sceneManager = new SceneManager(store, engine);
const hud = new HudLayer();

// --- 도구 ---
const ctx: EditorContext = {
  store,
  engine,
  rig,
  scene: sceneManager,
  hud,
  levelId: () => seed.levelId,
  wallTypeId: () => useUiStore.getState().activeWallTypeId ?? seed.wallTypeIds[0]!,
};
const tools = new ToolController();
tools.register('wall', new WallTool(ctx));
tools.register('select', new SelectTool(ctx));
tools.setActive(useUiStore.getState().activeTool);

new InputManager(
  canvas,
  rig,
  tools,
  () => (store.getLevel(seed.levelId)?.elevation ?? 0) / 1000,
  () => engine.requestRender(),
);

// --- UI 상태 → 엔진/도구 동기화 (React는 uiStore만 쓴다) ---
useUiStore.subscribe((state, prev) => {
  if (state.activeTool !== prev.activeTool) {
    tools.setActive(state.activeTool);
    sceneManager.setSelected(null);
  }
  if (state.viewMode !== prev.viewMode) {
    rig.setMode(state.viewMode);
    engine.requestRender();
  }
  if (state.selection !== prev.selection) {
    sceneManager.setSelected(state.selection);
  }
});

// --- 키보드 ---
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.key === 'Escape') {
    tools.cancel();
    engine.requestRender();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    const sel = useUiStore.getState().selection;
    if (sel) {
      store.deleteElements([sel]);
      useUiStore.getState().setSelection(null);
    }
  }
});

// --- React UI (패널만 — 캔버스/HUD는 명령형) ---
createRoot(document.getElementById('ui-root')!).render(createElement(App, { store }));

engine.requestRender();
