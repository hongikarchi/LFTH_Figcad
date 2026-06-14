/**
 * M11 라벨 스모크 — 라이브 observe→upsert→derive→updateLabels 경로가 *타깃 변경 시*
 * 라벨을 재파생하는지 검증 (gate: 단위 키-폴드만으론 SceneManager 재파생을 증명 못 함).
 * 사전: vite dev. 사용: node scripts/label-smoke.mjs [vite 포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `e2e-label-${Math.random().toString(36).slice(2, 8)}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('dialog', (d) => d.accept('라벨노트')); // promptText(custom) 입력
  const errors = [];
  const ignore = (t) => /WebSocket|ERR_CONNECTION_REFUSED|parties\/doc/.test(t);
  page.on('pageerror', (e) => { if (!ignore(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !ignore(m.text())) errors.push(m.text().slice(0, 200)); });

  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.sceneManager, { timeout: 10000 });

  // 1) 존(4×3=12㎡) + area 라벨(존 타깃, leader) — 3D 렌더 경로
  const lid = await page.evaluate(() => {
    const { store, seed, ui } = window.__figcad;
    ui.getState().setViewMode('3d');
    const zid = store.createZone({
      levelId: seed.levelId,
      boundary: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]],
      name: '거실',
    });
    const id = store.createLabel({ levelId: seed.levelId, at: [5000, 5000], targetId: zid, template: 'area', leader: true });
    window.__zid = zid;
    return id;
  });
  await new Promise((r) => setTimeout(r, 300));

  // 2) 라이브 파생 라벨 = 12.0㎡ (SceneManager가 만든 키)
  const k1 = await page.evaluate((id) => window.__figcad.sceneManager.debugLabelKey(id), lid);
  if (!k1 || !k1.includes('12.0㎡')) throw new Error(`초기 라벨 키 불일치: ${k1}`);
  console.log(`PASS  라이브 라벨 파생 = ${k1}`);

  // 3) *타깃* 존을 키움(4×6=24㎡) — 라벨은 안 건드림. 재파생되어야 24.0㎡.
  await page.evaluate(() => {
    const { store } = window.__figcad;
    store.updateElement(window.__zid, { boundary: [[0, 0], [4000, 0], [4000, 6000], [0, 6000]] });
  });
  await new Promise((r) => setTimeout(r, 300));
  const k2 = await page.evaluate((id) => window.__figcad.sceneManager.debugLabelKey(id), lid);
  if (!k2 || !k2.includes('24.0㎡')) throw new Error(`타깃 변경 후 라벨 미추종: ${k2}`);
  console.log(`PASS  타깃 변경 추종 (SceneManager 재파생) = ${k2}`);

  // 3b) 평면 전환 시 라벨 픽프록시가 투명 유지(고스팅이 솔리드 박스로 안 덮음 — 리뷰 MAJOR 회귀가드)
  await page.evaluate(() => {
    const { ui, seed } = window.__figcad;
    ui.getState().setActiveLevel(seed.levelId);
    ui.getState().setViewMode('plan');
  });
  await new Promise((r) => setTimeout(r, 250));
  const op = await page.evaluate((id) => {
    let o = null;
    window.__figcad.engine.scene.traverse((m) => {
      if (m.userData && m.userData.elementId === id && m.material) o = m.material.opacity;
    });
    return o;
  }, lid);
  if (op === null || op > 0.1) throw new Error(`평면에서 라벨 프록시 불투명(솔리드 박스): opacity=${op}`);
  console.log(`PASS  평면 전환 후 라벨 프록시 투명 유지 (opacity ${op})`);
  await page.evaluate(() => window.__figcad.ui.getState().setViewMode('3d'));

  // 4) 타깃 삭제 → 라벨 보존 + fallback (연쇄삭제 X)
  await page.evaluate(() => window.__figcad.store.deleteElements([window.__zid]));
  await new Promise((r) => setTimeout(r, 200));
  const survived = await page.evaluate((id) => !!window.__figcad.store.getElement(id), lid);
  if (!survived) throw new Error('타깃 삭제 시 라벨이 연쇄삭제됨 (보존 위반)');
  const k3 = await page.evaluate((id) => window.__figcad.sceneManager.debugLabelKey(id), lid);
  if (!k3 || !k3.includes('—')) throw new Error(`고아 fallback 불일치: ${k3}`);
  console.log(`PASS  타깃 삭제 → 라벨 보존 + fallback = ${k3}`);

  // 5) 평면 도면에 라벨 텍스트 렌더 (deriveDrawing 경유) — custom 라벨 추가 후 캔버스 확인
  await page.evaluate(() => {
    const { store, seed, ui } = window.__figcad;
    store.createLabel({ levelId: seed.levelId, at: [1000, 1000], template: 'custom', customText: 'TEST-LBL' });
    const id = store.createView({ name: '평면', type: 'plan', levelId: seed.levelId, cutHeight: 1200 });
    ui.getState().setActiveViewId(id);
    ui.getState().setDrawingOpen(true);
  });
  await page.waitForSelector('canvas[data-drawing]', { timeout: 4000 });
  await new Promise((r) => setTimeout(r, 400));
  const dark = await page.evaluate(() => {
    const c = document.querySelector('canvas[data-drawing]');
    const ctx = c.getContext('2d');
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let d = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 200) d++;
    return d;
  });
  if (dark < 50) throw new Error(`평면 도면 캔버스 비어있음 (${dark})`);
  console.log(`PASS  평면 도면 라벨 렌더 (그려진 픽셀 ${dark})`);

  if (errors.length) throw new Error(`콘솔/페이지 에러: ${errors.slice(0, 3).join(' | ')}`);
  console.log('\n라벨 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
