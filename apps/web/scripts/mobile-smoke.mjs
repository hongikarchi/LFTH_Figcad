/**
 * 모바일 리뷰/뷰어 스모크 (v2) — 아이폰 에뮬(390×844, touch). 사전: vite dev.
 * 사용: node apps/web/scripts/mobile-smoke.mjs [vite 포트=5173]
 * 검증: device-phone + review 고정 · 모드탭 없음 · 기능버튼 · 사이드레일 숨김 · 풀블리드 ·
 *       시트가 화면 안 가림(≤60vh대) · 모델/코멘트/검사 컴팩트 시트 · 탭=선택 · 드래그=카메라 · 콘솔0.
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
  await page.emulate(KnownDevices['iPhone 13']); // 390×844, touch → pointer:coarse
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errs.push('PE:' + e.message.slice(0, 140)));
  page.on('dialog', (d) => d.accept('모바일'));
  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.ui, { timeout: 12000 });
  await wait(400);

  // device-phone + review 고정
  const dev = await page.evaluate(() => ({ body: document.body.classList.contains('device-phone'), store: window.__figcad.ui.getState().device, mode: window.__figcad.ui.getState().activeMode }));
  ok(dev.body && dev.store === 'phone', `device-phone 판정 (store=${dev.store})`);
  ok(dev.mode === 'review', `리뷰/뷰어 모드 고정 (mode=${dev.mode})`);

  // 방(벽4) — store API(모드 무관)
  await page.evaluate(() => {
    const { store, seed, ui } = window.__figcad;
    const L = seed.levelId, T = seed.wallTypeIds[0];
    store.createWall({ levelId: L, typeId: T, a: [-2000, -1500], b: [2000, -1500] });
    store.createWall({ levelId: L, typeId: T, a: [2000, -1500], b: [2000, 1500] });
    store.createWall({ levelId: L, typeId: T, a: [2000, 1500], b: [-2000, 1500] });
    store.createWall({ levelId: L, typeId: T, a: [-2000, 1500], b: [-2000, -1500] });
    ui.getState().setViewMode('plan');
  });
  await wait(600);

  // 레이아웃: 모드탭 없음 + 기능버튼 ≥3 + 사이드레일 숨김
  const layout = await page.evaluate(() => {
    const railGone = (s) => { const e = document.querySelector(s); return !e || getComputedStyle(e).display === 'none' || e.getBoundingClientRect().width === 0; };
    return {
      modeTabsInBar: !!document.querySelector('.bottom-bar .mode-tabs'),
      btnCount: document.querySelectorAll('.bottom-bar .bottom-bar-btn').length,
      rail: railGone('.work-rail'), insp: railGone('.inspector'),
    };
  });
  ok(!layout.modeTabsInBar, `모드탭 없음 (하단바)`);
  ok(layout.btnCount >= 3, `기능버튼 ${layout.btnCount}개 (모델·코멘트·AI)`);
  ok(layout.rail && layout.insp, `사이드 레일 비표시`);

  // 모델 시트 — 컴팩트 + 화면 안 가림(높이 ≤ 62vh) + 층 행
  await page.evaluate(() => window.__figcad.ui.getState().setPhoneSheet('models'));
  await wait(400);
  const models = await page.evaluate(() => {
    const sh = document.querySelector('.bottom-sheet'); if (!sh) return null;
    const r = sh.getBoundingClientRect();
    return { h: Math.round(r.height), vh: window.innerHeight, content: !!document.querySelector('.phone-sheet-content'), rows: document.querySelectorAll('.phone-row-main').length, title: document.querySelector('.bottom-sheet-title')?.textContent };
  });
  ok(models && models.content, `모델 시트 = 컴팩트 콘텐츠 (title=${models?.title})`);
  ok(models && models.h <= models.vh * 0.62, `시트가 화면 안 가림 (h=${models?.h} ≤ ${Math.round((models?.vh ?? 0) * 0.62)})`);
  ok(models && models.rows >= 1, `모델 시트 행(층/도면) ${models?.rows}개`);

  // 코멘트 시트
  await page.evaluate(() => window.__figcad.ui.getState().setPhoneSheet('comment'));
  await wait(300);
  ok(await page.evaluate(() => { const t = document.querySelector('.bottom-sheet-title')?.textContent; return t === '코멘트' && !!document.querySelector('.bottom-sheet-body .cmt-list, .bottom-sheet-body .rail-section'); }), '코멘트 시트 렌더');
  await page.evaluate(() => document.querySelector('.bottom-sheet-backdrop')?.click());
  await wait(250);

  // 탭 = 선택 (북벽 중점)
  const wallPx = await page.evaluate(() => {
    const cam = window.__figcad.rig.active;
    const V = cam.matrixWorldInverse.elements, P = cam.projectionMatrix.elements;
    const mul = (M, v) => [0, 1, 2, 3].map((r) => M[r] * v[0] + M[r + 4] * v[1] + M[r + 8] * v[2] + M[r + 12] * v[3]);
    const c = mul(P, mul(V, [0, 0, -1.5, 1]));
    return { x: Math.round(((c[0] / c[3] + 1) / 2) * innerWidth), y: Math.round(((1 - c[1] / c[3]) / 2) * innerHeight) };
  });
  await page.touchscreen.tap(wallPx.x, wallPx.y);
  await wait(250);
  const sel = await page.evaluate(() => window.__figcad.ui.getState().selection.length);
  ok(sel > 0, `탭=선택 (selection=${sel})`);

  // 선택 시 검사 버튼 등장 + 검사 시트
  ok(await page.evaluate(() => [...document.querySelectorAll('.bottom-bar-btn')].some((b) => b.textContent.includes('검사'))), '선택 시 검사 버튼 등장');
  await page.evaluate(() => window.__figcad.ui.getState().setPhoneSheet('inspect'));
  await wait(300);
  ok(await page.evaluate(() => document.querySelector('.bottom-sheet-title')?.textContent === '검사'), '검사 시트 렌더');
  await page.evaluate(() => document.querySelector('.bottom-sheet-backdrop')?.click());
  await wait(250);

  // 뷰포인트 시트 — 수신 UI("N번 단면 봐주세요"): 채널의 저장 뷰포인트가 목록에 뜨고 탭=점프
  await page.evaluate(() => {
    const F = window.__figcad;
    F.store.addViewpoint({
      camera: { target: [1, 0, 2], distance: 42, theta: 1.1, phi: 0.9 },
      viewMode: '3d', clip: null, author: '데스크톱동료',
    });
    F.ui.getState().setPhoneSheet('viewpoint');
  });
  await wait(300);
  ok(await page.evaluate(() =>
    document.querySelector('.bottom-sheet-title')?.textContent === '뷰포인트' &&
    document.querySelectorAll('.bottom-sheet-body .vp-item').length === 1,
  ), '뷰포인트 시트 렌더 (공유 항목 1)');
  await page.evaluate(() => document.querySelector('.vp-item .vp-open')?.click());
  await wait(300);
  const vpPose = await page.evaluate(() => window.__figcad.rig.getPose());
  ok(Math.abs(vpPose.distance - 42) < 1e-6 && Math.abs(vpPose.theta - 1.1) < 1e-6, `뷰포인트 탭=점프 (distance=${vpPose.distance})`);
  await page.evaluate(() => document.querySelector('.bottom-sheet-backdrop')?.click());
  await wait(250);

  // 드래그 = 카메라 (요소 안 늘어남)
  const before = await page.evaluate(() => window.__figcad.store.listElements().length);
  await page.touchscreen.touchStart(120, 300);
  await page.touchscreen.touchMove(240, 420);
  await page.touchscreen.touchMove(300, 500);
  await page.touchscreen.touchEnd();
  await wait(250);
  ok(await page.evaluate(() => window.__figcad.store.listElements().length) === before, `드래그=카메라 (요소 ${before} 불변)`);

  ok(errs.length === 0, `콘솔 에러 0 (${errs.length}${errs.length ? ' :: ' + errs.join(' | ') : ''})`);

  console.log('\n=== PASS (' + pass.length + ') ===');
  pass.forEach((p) => console.log('  ✓ ' + p));
  if (fail.length) { console.log('=== FAIL (' + fail.length + ') ==='); fail.forEach((f) => console.log('  ✗ ' + f)); process.exitCode = 1; }
  else console.log('\nALL PASS — mobile review/viewer smoke (v2)');
} catch (e) {
  console.error('THREW: ' + e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
