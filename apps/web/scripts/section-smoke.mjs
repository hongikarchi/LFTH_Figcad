/**
 * 실시간 단면 스모크 — 클립 플레인(renderer.clippingPlanes) + CPU 절단선(LineSegments2 굵은선)
 * + poché 채움(computeSectionFill)이 실제 브라우저 경로(ViewportCluster/ClipControl DOM)로 동작하는지.
 *
 * 아키텍처 사실: 절단선/poché는 referenceLayer.sectionMeshes()(임포트 오버레이)만 대상 —
 * 네이티브 벽/슬라브는 GPU 클립만. → 닫힌 솔리드 박스(4×4×3m)를 ReferenceLayer에 직접 주입해 검증.
 *
 * 사전: vite dev(:5173, DEV=__figcad 훅) + 백엔드 :8787. 사용: node apps/web/scripts/section-smoke.mjs [포트=5173]
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

const port = process.argv[2] ?? '5173';
const room = `section-smoke-${Math.random().toString(36).slice(2, 8)}`;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1280,900'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 씬에서 절단선(LineSegments2, 0x1d1d1f)·poché 채움(Mesh, 0x8a909a·renderOrder 2) 찾기 — main.ts가 이름 없이 추가.
const FIND_SECTION_OBJECTS = `(() => {
  const { engine } = window.__figcad;
  let line = null, fill = null;
  engine.scene.traverse((o) => {
    if (o.isLineSegments2 && o.material?.color?.getHex?.() === 0x1d1d1f) line = o;
    if (o.isMesh && o.renderOrder === 2 && o.frustumCulled === false
        && o.material?.transparent && o.material?.color?.getHex?.() === 0x8a909a) fill = o;
  });
  return { line, fill };
})`;

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('dialog', (d) => d.accept());
  const errors = [];
  const ignore = (t) => /WebSocket|ERR_CONNECTION_REFUSED|parties\/doc/.test(t);
  page.on('pageerror', (e) => { if (!ignore(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !ignore(m.text())) errors.push(m.text().slice(0, 200)); });

  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.referenceLayer && window.__figcad?.ui && window.__figcad?.rig, { timeout: 15000 });

  // --- 픽스처: 닫힌 솔리드 박스 4×4×3m (6..10, 0..3, 6..10) → ReferenceLayer 직접 주입(네트워크 픽스처 불요) ---
  const fixture = await page.evaluate(() => {
    const F = window.__figcad;
    const elemsBefore = F.store.listElements().length;
    const q = (a, b, c, d) => [...a, ...b, ...c, ...a, ...c, ...d];
    const mkBox = (x0, y0, z0, x1, y1, z1) => new Float32Array([
      ...q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]), // 바닥
      ...q([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]), // 천장
      ...q([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]), // -z
      ...q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]), // +z
      ...q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]), // -x
      ...q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]), // +x
    ]);
    F.referenceLayer.add('smokebox', { meshes: [{ positions: mkBox(6, 0, 6, 10, 3, 10), name: 'smoke-box' }] });
    const secMeshes = F.referenceLayer.sectionMeshes().length;
    // 카메라: iso로 박스 프레이밍 (트윈 강제완료)
    F.rig.setView('iso');
    F.rig.tick(5);
    F.rig.fitBounds({ x: 6, y: 0, z: 6 }, { x: 10, y: 3, z: 10 });
    F.rig.tick(5);
    F.engine.requestRender();
    return { elemsBefore, elemsAfter: F.store.listElements().length, secMeshes };
  });
  if (fixture.secMeshes < 1) throw new Error(`sectionMeshes()가 주입 박스를 안 봄 (${fixture.secMeshes})`);
  if (fixture.elemsAfter !== fixture.elemsBefore) throw new Error('레퍼런스 주입이 문서를 변경함 (불변① 위반)');
  console.log(`PASS  픽스처 — 닫힌 박스 4×4×3m 주입, sectionMeshes=${fixture.secMeshes}, 문서 불변`);
  await sleep(300);

  // --- 1) 클립 활성 (실제 UI 경로: ViewportCluster '단면' 버튼 → setClipState + actions.setClip) ---
  await page.click('button[title="단면 (클리핑 플레인)"]');
  const clipOn = await page.evaluate(() => {
    const F = window.__figcad;
    const planes = F.engine.renderer.clippingPlanes;
    const p = planes[0];
    return {
      uiClip: F.ui.getState().clip,
      planeCount: planes.length,
      normal: p ? [p.normal.x, p.normal.y, p.normal.z] : null,
      constant: p ? p.constant : null,
    };
  });
  if (clipOn.planeCount !== 1) throw new Error(`clippingPlanes ${clipOn.planeCount}개 (기대 1)`);
  if (!clipOn.uiClip || clipOn.uiClip.axis !== 'y' || clipOn.uiClip.t !== 0.5)
    throw new Error(`uiStore clip 불일치: ${JSON.stringify(clipOn.uiClip)}`);
  // 박스 y 0..3, t=0.5 → pos=1.5. flip=false → normal +y, constant=-1.5
  if (Math.abs(clipOn.normal[1] - 1) > 1e-6 || Math.abs(clipOn.constant + 1.5) > 1e-6)
    throw new Error(`평면 위치 불일치: n=${clipOn.normal} c=${clipOn.constant} (기대 +y, -1.5)`);
  console.log(`PASS  클립 활성 — clippingPlanes=1, 수평(y) t=0.5 → 평면 y=1.5`);

  // flip → 아래쪽 유지(위 절반 클립) → 탑/iso 뷰에서 poché가 가려지지 않음
  await page.waitForSelector('.clip-flip', { timeout: 4000 });
  await page.click('.clip-flip');
  await sleep(600); // 디바운스 130ms + 여유

  // --- 2) 절단선(LineSegments2) + 3) poché 채움 존재·지오메트리 ---
  const contour = await page.evaluate(`(() => {
    const { line, fill } = ${FIND_SECTION_OBJECTS}();
    return {
      hasLine: !!line, lineVisible: line?.visible ?? false,
      segCount: line?.geometry?.attributes?.instanceStart?.count ?? 0,
      y0: line ? line.geometry.attributes.instanceStart.getY(0) + line.position.y : null,
      hasFill: !!fill, fillVisible: fill?.visible ?? false,
      fillVerts: fill?.geometry?.attributes?.position?.count ?? 0,
    };
  })()`);
  if (!contour.hasLine) throw new Error('절단선 LineSegments2(0x1d1d1f)가 씬에 없음');
  if (!contour.lineVisible || contour.segCount < 4)
    throw new Error(`절단선 지오메트리 부실: visible=${contour.lineVisible} seg=${contour.segCount} (박스 수평컷 기대 ≥4)`);
  console.log(`PASS  절단선 — LineSegments2 visible, 세그먼트 ${contour.segCount}개 (y≈${contour.y0?.toFixed(3)})`);
  if (!contour.hasFill) throw new Error('poché 채움 메시(0x8a909a)가 씬에 없음');
  if (!contour.fillVisible || contour.fillVerts < 3)
    throw new Error(`poché 채움 부실: visible=${contour.fillVisible} verts=${contour.fillVerts} (닫힌 박스 = 채워져야)`);
  console.log(`PASS  poché — 채움 메시 visible, 삼각 정점 ${contour.fillVerts}개`);

  // --- 3b) 픽셀 검증: 채움 on/off 스크린샷 비교 (컷 영역 픽셀이 poché 색으로 칠해짐) ---
  // 채움 중심(8,1.5,8)+주변을 스크린 좌표로 투영 (rig.active 카메라, 캔버스 rect 기준)
  const pts = await page.evaluate(() => {
    const F = window.__figcad;
    const cam = F.rig.active;
    cam.updateMatrixWorld();
    const rect = F.engine.renderer.domElement.getBoundingClientRect();
    return [[8, 1.5, 8], [7.2, 1.5, 8], [8, 1.5, 8.8]].map(([x, y, z]) => {
      const v = cam.position.clone().set(x, y, z).project(cam);
      return [Math.round(rect.left + (v.x * 0.5 + 0.5) * rect.width), Math.round(rect.top + (-v.y * 0.5 + 0.5) * rect.height)];
    });
  });
  const shotOn = await page.screenshot({ encoding: 'base64' });
  writeFileSync(join(SCRIPTS_DIR, '_section-smoke-fill-on.png'), Buffer.from(shotOn, 'base64')); // encoding:'base64'는 path 미기록 → 명시 저장
  await page.evaluate(`(() => { const { fill } = ${FIND_SECTION_OBJECTS}(); fill.visible = false; window.__figcad.engine.requestRender(); })()`);
  await sleep(200);
  const shotOff = await page.screenshot({ encoding: 'base64' });
  writeFileSync(join(SCRIPTS_DIR, '_section-smoke-fill-off.png'), Buffer.from(shotOff, 'base64'));
  await page.evaluate(`(() => { const { fill } = ${FIND_SECTION_OBJECTS}(); fill.visible = true; window.__figcad.engine.requestRender(); })()`);
  const px = await page.evaluate(async (b64on, b64off, points) => {
    const load = (b64) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = 'data:image/png;base64,' + b64;
    });
    const [on, off] = await Promise.all([load(b64on), load(b64off)]);
    const c = document.createElement('canvas');
    c.width = on.width; c.height = on.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    const sample = (img, x, y) => { g.drawImage(img, 0, 0); return [...g.getImageData(x, y, 1, 1).data.slice(0, 3)]; };
    return points.map(([x, y]) => {
      const a = sample(on, x, y), b = sample(off, x, y);
      return { at: [x, y], on: a, off: b, delta: a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) };
    });
  }, shotOn, shotOff, pts);
  const painted = px.filter((s) => s.delta > 24);
  if (painted.length < 2)
    throw new Error(`poché 픽셀 미검출 — 채움 on/off 델타 부족: ${JSON.stringify(px)}`);
  console.log(`PASS  poché 픽셀 — 컷 영역 ${painted.length}/3점 채움색 확인 (예: on=rgb(${px[0].on}) off=rgb(${px[0].off}) Δ${px[0].delta})`);

  // --- 4) 컨투어가 클립을 추종: 슬라이더 t 0.5→0.3 → 절단선 y가 1.5→0.9로 이동 ---
  await page.evaluate(() => {
    const el = document.querySelector('.clip-slider');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '0.3');
    el.dispatchEvent(new Event('input', { bubbles: true })); // React onChange(range=input 이벤트) 트리거
  });
  await sleep(600);
  const moved = await page.evaluate(`(() => {
    const { line } = ${FIND_SECTION_OBJECTS}();
    const F = window.__figcad;
    return {
      uiT: F.ui.getState().clip?.t,
      y0: line.geometry.attributes.instanceStart.getY(0) + line.position.y,
      segCount: line.geometry.attributes.instanceStart.count,
      visible: line.visible,
    };
  })()`);
  if (moved.uiT !== 0.3) throw new Error(`슬라이더가 uiStore에 반영 안 됨: t=${moved.uiT}`);
  if (!moved.visible || moved.segCount < 4) throw new Error(`이동 후 절단선 소실: ${JSON.stringify(moved)}`);
  const dy = contour.y0 - moved.y0;
  if (Math.abs(dy - 0.6) > 0.05)
    throw new Error(`절단선이 클립을 미추종: y ${contour.y0?.toFixed(3)}→${moved.y0.toFixed(3)} (기대 Δ≈0.6, 실제 Δ=${dy.toFixed(3)})`);
  console.log(`PASS  클립 추종 — t 0.5→0.3, 절단선 y ${contour.y0.toFixed(3)}→${moved.y0.toFixed(3)} (Δ${dy.toFixed(3)}≈0.6)`);

  // --- 5) 클립 끄기 → 평면·절단선·채움 전부 해제 ---
  await page.click('.clip-off');
  await sleep(300);
  const off = await page.evaluate(`(() => {
    const { line, fill } = ${FIND_SECTION_OBJECTS}();
    const F = window.__figcad;
    return {
      planes: F.engine.renderer.clippingPlanes.length,
      uiClip: F.ui.getState().clip,
      lineVisible: line?.visible ?? false,
      fillVisible: fill?.visible ?? false,
    };
  })()`);
  if (off.planes !== 0) throw new Error(`끈 뒤 clippingPlanes ${off.planes}개 잔존`);
  if (off.uiClip !== null) throw new Error(`끈 뒤 uiStore clip 잔존: ${JSON.stringify(off.uiClip)}`);
  if (off.lineVisible || off.fillVisible)
    throw new Error(`끈 뒤 절단선/채움 잔존: line=${off.lineVisible} fill=${off.fillVisible}`);
  console.log('PASS  클립 끄기 — clippingPlanes=0, 절단선·poché 숨김, uiStore null');

  if (errors.length) throw new Error(`콘솔/페이지 에러: ${errors.slice(0, 3).join(' | ')}`);
  console.log('\n단면 스모크 통과 (클립 + 절단선 + poché)');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
