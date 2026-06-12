import { Engine } from './engine/Engine';
import { CameraRig } from './engine/CameraRig';
import { buildScene } from './engine/buildScene';
import { InputManager } from './input/InputManager';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const modeToggle = document.getElementById('mode-toggle') as HTMLButtonElement;

const rig = new CameraRig(window.innerWidth / window.innerHeight);
const engine = new Engine(canvas, () => rig.active);
engine.addTicker((dt) => rig.tick(dt));

buildScene(engine.scene);

new InputManager(canvas, rig, () => engine.requestRender());

modeToggle.addEventListener('click', () => {
  const mode = rig.toggleMode();
  modeToggle.textContent = mode === '3d' ? '평면' : '3D';
  engine.requestRender();
});

engine.requestRender();
