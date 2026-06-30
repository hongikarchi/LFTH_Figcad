/**
 * 스케치(마크업) 도구 스모크 — iter-3 업그레이드 반영.
 * 스케치는 이제 영속 MARKUP 도구('sketch-pen'). 더 이상 AI 패널을 자동으로 열지 않는다(uiStore: aiOpen 부작용 제거).
 * 검증: 스케치 도구 선택 → 마크업 모드(AI 자동개방 안 함) · 프리핸드 드로잉 → 영속 SketchElement 생성(문서공간 mm) · 평면뷰 = 레벨 바닥(frame 없음) · 삭제.
 * AI 손그림→모델 경로는 별도(sketch-live-e2e). 사전: vite dev. 사용: node scripts/sketch-smoke.mjs [vite 포트=5173]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const room = `e2e-sketch-${Math.random().toString(36).slice(2, 8)}`;
const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EXE, headless: true });

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${port}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.store && window.__figcad?.ui, { timeout: 20000 });

  const sketches = () =>
    page.evaluate(() =>
      window.__figcad.store
        .listElements()
        .filter((e) => e.kind === 'sketch')
        .map((s) => ({ id: s.id, mode: s.mode, frame: !!s.frame, n: s.boundary.length })),
    );

  // 캔버스 중앙(패널 회피) — #viewport 박스 기준
  const box = await (await page.$('#viewport')).boundingBox();
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);
  // 프리핸드 스트로크: 많은 중간점으로 이동(MIN_SEG_MM 데시메이트 통과하도록 넉넉히 큰 경로)
  const stroke = async (pts) => {
    await page.mouse.move(cx + pts[0][0], cy + pts[0][1]);
    await page.mouse.down();
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const N = 8;
      for (let k = 1; k <= N; k++) {
        await page.mouse.move(cx + ax + ((bx - ax) * k) / N, cy + ay + ((by - ay) * k) / N);
      }
    }
    await page.mouse.up();
    await wait(200);
  };

  // 1) 스케치 도구 선택 → 마크업 모드 (AI 패널 자동개방 안 함 — iter-3 회귀 가드)
  await page.evaluate(() => {
    const ui = window.__figcad.ui.getState();
    ui.setMode('model');
    ui.setViewMode('plan'); // 평면뷰 = 레벨 바닥(frame 없음) — MarkupTool은 down() 시점에 viewMode를 읽음
    ui.setSketchMode('line');
    ui.setTool('sketch-pen');
  });
  await wait(200);
  const sel = await page.evaluate(() => {
    const s = window.__figcad.ui.getState();
    return { tool: s.activeTool, aiOpen: s.aiOpen };
  });
  if (sel.tool !== 'sketch-pen') throw new Error(`스케치 도구 미활성: activeTool=${sel.tool}`);
  if (sel.aiOpen) throw new Error('스케치 도구가 AI 패널을 자동으로 열음(iter-3에서 제거된 부작용)');
  console.log('PASS  스케치 도구 → 마크업 모드 (AI 자동개방 안 함)');

  // 2) 프리핸드 사각형 → 영속 SketchElement 1개 생성 (문서공간 mm 경계)
  const before = (await sketches()).length;
  await stroke([
    [-120, -90],
    [120, -90],
    [120, 90],
    [-120, 90],
    [-115, -85],
  ]);
  const after = await sketches();
  if (after.length !== before + 1)
    throw new Error(`영속 스케치 미생성: ${before} → ${after.length}`);
  const sk = after[after.length - 1];
  if (sk.mode !== 'line') throw new Error(`스케치 mode=${sk.mode} (line 기대)`);
  if (sk.n < 2) throw new Error(`경계 정점 ${sk.n} (>=2 기대 — 프리핸드 캡처 실패)`);
  console.log(`PASS  프리핸드 → 영속 SketchElement 생성 (정점 ${sk.n}개, mode=${sk.mode})`);

  // 3) 평면뷰 스케치 = 레벨 바닥 (frame 없음)
  if (sk.frame) throw new Error('평면뷰 스케치인데 frame 설정됨(레벨 바닥이어야 함)');
  console.log('PASS  평면뷰 스케치 = 레벨 바닥 (frame 없음)');

  // 4) 삭제 → 스케치 제거
  await page.evaluate((id) => window.__figcad.store.deleteElements([id]), sk.id);
  await wait(150);
  const remaining = await sketches();
  if (remaining.some((s) => s.id === sk.id)) throw new Error('삭제 후에도 스케치 존재');
  console.log('PASS  스케치 삭제');

  if (errors.length) throw new Error(`콘솔/페이지 에러: ${errors.slice(0, 3).join(' | ')}`);
  console.log('\n스케치(마크업) 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
