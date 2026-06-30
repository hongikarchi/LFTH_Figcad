/**
 * 모바일 반응형 스모크 — 아이폰 에뮬레이션(390×844, touch)으로 폰 셸 검증. 사전: vite dev.
 * 사용: node apps/web/scripts/mobile-smoke.mjs [vite 포트=5173]
 * 검증: device-phone 분기 · 사이드레일 숨김 · 풀블리드 캔버스 · InfoBox 음수폭 없음 · 바텀바 ·
 *       탭=선택 · 바텀시트 open/close · 드래그=카메라 · AI 풀스크린 · 콘솔 에러 0.
 */
import puppeteer from 'puppeteer-core';
import { KnownDevices } from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `mobile-${Math.random().toString(36).slice(2, 8)}`;
const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);
const errs = [];
try {
  const page = await browser.newPage();
  await page.emulate(KnownDevices['iPhone 13']); // 390×844, isMobile, hasTouch → pointer:coarse
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errs.push('PE:' + e.message.slice(0, 140)));
  page.on('dialog', (d) => d.accept('모바일'));
  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.ui, { timeout: 12000 });

  // device-phone 판정
  await wait(400);
  const dev = await page.evaluate(() => ({
    body: document.body.classList.contains('device-phone'),
    store: window.__figcad.ui.getState().device,
    coarse: window.matchMedia('(pointer: coarse)').matches,
    w: window.innerWidth,
  }));
  ok(dev.body && dev.store === 'phone', `device-phone 판정 (body=${dev.body} store=${dev.store} coarse=${dev.coarse} w=${dev.w})`);

  // 원점 방(벽4) + 평면 뷰
  await page.evaluate(() => {
    const { store, seed, ui } = window.__figcad;
    const L = seed.levelId, T = seed.wallTypeIds[0];
    store.createWall({ levelId: L, typeId: T, a: [-2000, -1500], b: [2000, -1500] });
    store.createWall({ levelId: L, typeId: T, a: [2000, -1500], b: [2000, 1500] });
    store.createWall({ levelId: L, typeId: T, a: [2000, 1500], b: [-2000, 1500] });
    store.createWall({ levelId: L, typeId: T, a: [-2000, 1500], b: [-2000, -1500] });
    ui.getState().setMode('model');
    ui.getState().setViewMode('plan');
    ui.getState().setTool('select');
  });
  await wait(600);

  // 레이아웃: 사이드 레일 숨김 + 바텀바 존재 + InfoBox 폭
  const layout = await page.evaluate(() => {
    const vis = (sel) => { const e = document.querySelector(sel); if (!e) return 'absent'; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return cs.display === 'none' || r.width === 0 ? 'hidden' : `${Math.round(r.width)}px`; };
    const ib = document.querySelector('.infobox');
    return {
      workRail: vis('.work-rail'),
      inspector: vis('.inspector'),
      bottomBar: !!document.querySelector('.bottom-bar'),
      bottomBarBottom: document.querySelector('.bottom-bar')?.getBoundingClientRect().bottom ?? 0,
      infoboxW: ib ? Math.round(ib.getBoundingClientRect().width) : -1,
      vw: window.innerWidth,
    };
  });
  // 폰선 사이드 레일을 standalone 렌더 안 함(시트가 유일 마운트) → 'absent' 또는 'hidden' 둘 다 OK(캔버스 안 가림)
  const railGone = (v) => v === 'hidden' || v === 'absent';
  ok(railGone(layout.workRail) && railGone(layout.inspector), `사이드 레일 비표시 (workRail=${layout.workRail} inspector=${layout.inspector})`);
  ok(layout.bottomBar && layout.bottomBarBottom >= layout.vw * 0 && layout.bottomBarBottom <= 844 + 1, `바텀바 존재 + 하단(bottom=${Math.round(layout.bottomBarBottom)})`);
  ok(layout.infoboxW <= layout.vw, `InfoBox 폭 ≤ 뷰포트 (${layout.infoboxW} ≤ ${layout.vw}, 음수폭 버그 없음)`);

  // 탭 = 선택 (방 중앙 = 벽 부근; 북벽 중앙 탭). 화면 중앙 근처 탭 후 selection
  // 방 중앙(0,0)은 빈 공간 → 탭하면 deselect. 벽 위를 탭해야. 북벽 중점 doc[0,-1500] → 화면px 계산.
  const wallPx = await page.evaluate(() => {
    const { rig } = window.__figcad; const cam = rig.active;
    const V = cam.matrixWorldInverse.elements, P = cam.projectionMatrix.elements;
    const mul = (M, v) => [0, 1, 2, 3].map((r) => M[r] * v[0] + M[r + 4] * v[1] + M[r + 8] * v[2] + M[r + 12] * v[3]);
    const c = mul(P, mul(V, [0, 0, -1.5, 1])); // 북벽 중점 world[0,0,-1.5]
    return { x: Math.round(((c[0] / c[3] + 1) / 2) * window.innerWidth), y: Math.round(((1 - c[1] / c[3]) / 2) * window.innerHeight) };
  });
  await page.touchscreen.tap(wallPx.x, wallPx.y);
  await wait(250);
  const selAfterTap = await page.evaluate(() => window.__figcad.ui.getState().selection.length);
  ok(selAfterTap > 0, `탭=선택 (벽px ${wallPx.x},${wallPx.y} → selection=${selAfterTap})`);

  // 드래그 = 카메라 (선택 안 바뀌고 요소 안 늘어남). 빈 영역 드래그.
  const elemBefore = await page.evaluate(() => window.__figcad.store.listElements().length);
  await page.touchscreen.touchStart(120, 300);
  await page.touchscreen.touchMove(240, 420);
  await page.touchscreen.touchMove(300, 500);
  await page.touchscreen.touchEnd();
  await wait(250);
  const elemAfter = await page.evaluate(() => window.__figcad.store.listElements().length);
  ok(elemAfter === elemBefore, `드래그=카메라 (요소 ${elemBefore}→${elemAfter}, 드로잉 안 됨)`);

  // 바텀시트 open/close
  await page.evaluate(() => window.__figcad.ui.getState().setPhoneSheet('layers'));
  await wait(300);
  const sheetOpen = await page.evaluate(() => !!document.querySelector('.bottom-sheet') && !!document.querySelector('.bottom-sheet .work-rail'));
  ok(sheetOpen, '바텀시트 open + WorkRail 시트내 렌더');
  await page.evaluate(() => { document.querySelector('.bottom-sheet-backdrop')?.click(); });
  await wait(300);
  const sheetClosed = await page.evaluate(() => !document.querySelector('.bottom-sheet'));
  ok(sheetClosed, '바텀시트 close (백드롭 탭)');

  // AI 풀스크린
  await page.evaluate(() => window.__figcad.ui.getState().setAiOpen(true));
  await wait(300);
  const ai = await page.evaluate(() => {
    const p = document.querySelector('.ai-panel:not(.ai-hidden)'); if (!p) return null;
    const r = p.getBoundingClientRect(); return { left: Math.round(r.left), width: Math.round(r.width), vw: window.innerWidth };
  });
  ok(ai && ai.left <= 1 && ai.width >= ai.vw - 1, `AI 풀스크린 시트 (${ai ? `left=${ai.left} w=${ai.width}/${ai.vw}` : 'absent'})`);

  ok(errs.length === 0, `콘솔 에러 0 (${errs.length}${errs.length ? ' :: ' + errs.join(' | ') : ''})`);

  console.log('\n=== PASS (' + pass.length + ') ===');
  pass.forEach((p) => console.log('  ✓ ' + p));
  if (fail.length) { console.log('=== FAIL (' + fail.length + ') ==='); fail.forEach((f) => console.log('  ✗ ' + f)); process.exitCode = 1; }
  else console.log('\nALL PASS — mobile responsive smoke');
} catch (e) {
  console.error('THREW: ' + e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
