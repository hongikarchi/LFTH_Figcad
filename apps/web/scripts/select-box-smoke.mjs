/**
 * M8-B 드래그 박스 선택 스모크 — Rhino window(좌→우, 완전포함) vs crossing(우→좌, 닿음).
 * 실제 마우스 PointerEvent 경로(InputManager→SelectTool). 사전: vite dev.
 * 사용: node scripts/select-box-smoke.mjs [vite 포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `e2e-box-${Math.random().toString(36).slice(2, 8)}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('dialog', (d) => d.accept('박스테스터'));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE.ERR:', m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.ui, { timeout: 10000 });

  // 평면 뷰 + 원점 중심 방(벽4) — 기본 카메라 타깃이 원점이라 화면 중앙에 보임
  await page.evaluate(() => {
    const { store, seed, ui } = window.__figcad;
    const L = seed.levelId;
    const T = seed.wallTypeIds[0];
    store.createWall({ levelId: L, typeId: T, a: [-2000, -1500], b: [2000, -1500] });
    store.createWall({ levelId: L, typeId: T, a: [2000, -1500], b: [2000, 1500] });
    store.createWall({ levelId: L, typeId: T, a: [2000, 1500], b: [-2000, 1500] });
    store.createWall({ levelId: L, typeId: T, a: [-2000, 1500], b: [-2000, -1500] });
    ui.getState().setViewMode('plan');
    ui.getState().setTool('select');
  });
  await new Promise((r) => setTimeout(r, 400)); // 평면 전환 트윈

  const sel = () => page.evaluate(() => window.__figcad.ui.getState().selection.length);
  const clear = () =>
    page.evaluate(() => {
      window.__figcad.ui.getState().setSelection([]);
    });

  // 드래그 헬퍼 (실제 마우스 = pointerType 'mouse' button 0)
  const drag = async (x1, y1, x2, y2) => {
    await page.mouse.move(x1, y1, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 8 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 120));
  };

  // iter-2 레이아웃: 상단 TopBar(y<46) · 좌 .work-rail(x 14~202) · 우 .inspector(x 1034~1266).
  // pointerdown은 반드시 캔버스(#viewport) 위에서 시작해야 InputManager→SelectTool 박스선택이 돈다.
  // 방(원점)은 평면 투영에서 화면 px x 576~704, y 352~448 (정사영 카메라 기본 줌, 1280×800 검증).
  // 드래그 시작점은 x>=450, y>=160로 좌패널·상단바를 피하고, 끝점은 포인터 캡처로 패널 위여도 무방.

  // 1) 큰 박스 window(좌→우) — 방 4벽 완전포함 → 4
  await clear();
  await drag(450, 250, 1120, 720); // 시작=캔버스, 박스 450~1120 × 250~720 ⊇ 방 576~704 × 352~448
  const whole = await sel();
  if (whole !== 4) throw new Error(`전체 window 선택 ${whole} (4 기대)`);
  console.log(`PASS  큰 window → 벽 ${whole}개 (완전포함)`);

  // 2) 좌측 절반 박스: 같은 사각형을 window(좌→우) vs crossing(우→좌)
  // 끝선 x=640이 방을 세로로 자름(서벽576<640<동벽704) — 서벽 완전포함, 남/북벽 부분 걸침, 동벽 밖
  await clear();
  await drag(450, 250, 640, 720); // 좌→우 = window
  const winPartial = await sel();
  await clear();
  await drag(640, 250, 450, 720); // 우→좌 = crossing (시작 640도 캔버스)
  const crossPartial = await sel();
  console.log(`PASS  좌측 절반 — window ${winPartial}개 vs crossing ${crossPartial}개`);
  if (!(crossPartial > winPartial)) throw new Error('crossing이 window보다 많지 않음 (의미론 위반)');
  if (winPartial >= 4) throw new Error('부분 window가 전체를 잡음 (완전포함 규칙 위반)');

  // 3) 빈 구석 작은 박스 — 0 (방 576~704 × 352~448의 좌상단 바깥 빈 캔버스)
  await clear();
  await drag(460, 170, 540, 230);
  const empty = await sel();
  if (empty !== 0) throw new Error(`빈 영역 선택 ${empty} (0 기대)`);
  console.log('PASS  빈 영역 박스 → 0개');

  console.log('\n드래그 박스 선택 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
