/**
 * M8-D1 기둥 스모크 — 도구 배치 + SceneManager 렌더 + 박스 선택 + lint + IFC export.
 * 단위 테스트가 못 잡는 앱 경로(ColumnTool→InputManager, 제네릭 upsert 렌더,
 * 풋프린트 투영, dev IFC 훅)를 실기동으로 확인. 사전: vite dev.
 * 사용: node scripts/column-smoke.mjs [vite 포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `e2e-col-${Math.random().toString(36).slice(2, 8)}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('dialog', (d) => d.accept('기둥테스터'));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.ui, { timeout: 10000 });

  // 평면 뷰 + 기둥 도구
  await page.evaluate(() => {
    const { ui } = window.__figcad;
    ui.getState().setViewMode('plan');
    ui.getState().setTool('column');
  });
  await new Promise((r) => setTimeout(r, 400));

  const cols = () =>
    page.evaluate(() => window.__figcad.store.listElements().filter((e) => e.kind === 'column').length);

  // 1) 도구로 클릭 배치 (InputManager→ColumnTool→createColumn)
  await page.mouse.click(640, 400);
  await new Promise((r) => setTimeout(r, 150));
  const placed = await cols();
  if (placed !== 1) throw new Error(`기둥 클릭 배치 ${placed} (1 기대)`);
  console.log(`PASS  기둥 도구 클릭 배치 → ${placed}개`);

  // 2) 제네릭 upsert 렌더 — store로 직접 추가 후 콘솔 에러 없음
  await page.evaluate(() => {
    const { store, seed } = window.__figcad;
    store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [3000, 0] });
    store.createColumn({ levelId: seed.levelId, typeId: seed.columnTypeId, at: [-3000, 0] });
  });
  await new Promise((r) => setTimeout(r, 150));
  if (await cols() !== 3) throw new Error('store 직접 추가 실패');
  console.log('PASS  SceneManager 제네릭 렌더 (콘솔 에러 없음)');

  // 3) lint 클린 (서로 다른 자리 = 중복 아님)
  const findings = await page.evaluate(() => window.__figcad.lint(window.__figcad.store).length);
  if (findings !== 0) throw new Error(`lint 경고 ${findings}건 (0 기대)`);
  console.log('PASS  lint 클린');

  // 4) 박스 선택(window) — 가운데 기둥(원점)을 화면 중앙 박스로 잡기 (풋프린트 투영 경로)
  await page.evaluate(() => window.__figcad.ui.getState().setTool('select'));
  await new Promise((r) => setTimeout(r, 100));
  await page.mouse.move(540, 320, { steps: 3 });
  await page.mouse.down();
  await page.mouse.move(740, 480, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 150));
  const selKinds = await page.evaluate(() => {
    const ids = window.__figcad.ui.getState().selection;
    return ids.map((id) => window.__figcad.store.getElement(id)?.kind);
  });
  if (!selKinds.includes('column')) throw new Error(`박스 선택에 기둥 없음 (${selKinds.join(',')})`);
  console.log(`PASS  박스 선택 풋프린트 → ${selKinds.join(',')}`);

  // 5) IFC export — 기둥 포함 (실제 web-ifc WASM 경로)
  const hasCol = await page.evaluate(async () => {
    const bytes = await window.__figcad.ifc.exportIfcBytes(window.__figcad.store.snapshot());
    return new TextDecoder().decode(bytes).includes('IFCCOLUMN');
  });
  if (!hasCol) throw new Error('IFC에 IFCCOLUMN 없음');
  console.log('PASS  IFC export에 IFCCOLUMN 포함');

  if (errors.length) throw new Error(`콘솔/페이지 에러: ${errors.slice(0, 3).join(' | ')}`);
  console.log('\n기둥 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
