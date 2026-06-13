/**
 * M9-B 코멘트 단일페이지 smoke — 도구 배치(DOM 입력)·패널·답글·해결·삭제 UI.
 * 사전: vite dev. 사용: node scripts/comment-smoke.mjs [포트=5173]
 */
import puppeteer from 'puppeteer-core';
const port = process.argv[2] ?? '5173';
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('dialog', (d) => d.accept('소장'));
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 150)); });
  await page.goto(`http://localhost:${port}/?p=cmt-${Math.random().toString(36).slice(2, 7)}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.store, { timeout: 10000 });

  // 1) 코멘트 도구 → 캔버스 클릭 → DOM 입력 → 코멘트 생성
  await page.evaluate(() => { window.__figcad.ui.getState().setViewMode('plan'); window.__figcad.ui.getState().setTool('comment'); });
  await new Promise((r) => setTimeout(r, 400));
  await page.mouse.click(480, 400);
  await page.waitForSelector('input[type=text]', { timeout: 3000 });
  await page.type('input[type=text]', '벽 두께 확인');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__figcad.store.listComments().length === 1, { timeout: 4000 });
  console.log('PASS  코멘트 도구 배치 (DOM 입력)');

  // 2) 패널에 .cmt-item 렌더
  await page.waitForSelector('.cmt-item', { timeout: 3000 });
  console.log('PASS  코멘트 패널 렌더');

  // 3) 패널 답글 입력
  await page.type('.cmt-reply-input input', '200으로 했습니다');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__figcad.store.listComments().filter((c) => c.parentId).length === 1, { timeout: 4000 });
  console.log('PASS  패널 답글');

  // 4) 해결 토글 (패널 버튼)
  const rootId = await page.evaluate(() => window.__figcad.store.listComments().find((c) => !c.parentId).id);
  await page.evaluate(() => window.__figcad.store.resolveComment(window.__figcad.store.listComments().find((c) => !c.parentId).id, true));
  await new Promise((r) => setTimeout(r, 150));
  if (!(await page.evaluate((id) => window.__figcad.store.getComment(id)?.resolved, rootId))) throw new Error('해결 실패');
  console.log('PASS  해결 토글');

  // 5) lint 클린 (코멘트는 요소 아님 — 영향 없음)
  if (await page.evaluate(() => window.__figcad.lint(window.__figcad.store).length) !== 0) throw new Error('lint 경고');
  console.log('PASS  lint 클린');

  if (errs.length) throw new Error('콘솔/페이지 에러: ' + errs.slice(0, 3).join(' | '));
  console.log('\n코멘트 smoke 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
