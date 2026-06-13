/**
 * M9-B 코멘트 E2E — 2클라 실제 동기화(YProvider→8787). 동시 답글 무클로버 증명 + 도구/패널.
 * 사전: vite(5173) + apps/server dev-node.mjs(8787) 구동.
 */
import puppeteer from 'puppeteer-core';

const room = `e2e-cmt-${Math.random().toString(36).slice(2, 8)}`;
const url = `http://localhost:5173/?p=${room}`;
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const A = await browser.newPage();
  const B = await browser.newPage();
  await A.setViewport({ width: 1280, height: 800 });
  await B.setViewport({ width: 1280, height: 800 });
  A.on('dialog', (d) => d.accept('소장'));
  B.on('dialog', (d) => d.accept('실무'));
  const errs = [];
  for (const [p, n] of [[A, 'A'], [B, 'B']]) {
    p.on('pageerror', (e) => errs.push(`${n}:${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(`${n}:${m.text().slice(0, 150)}`); });
  }
  await A.goto(url, { waitUntil: 'load' });
  await B.goto(url, { waitUntil: 'load' });
  await A.waitForFunction(() => window.__figcad?.store, { timeout: 10000 });
  await B.waitForFunction(() => window.__figcad?.store, { timeout: 10000 });

  // 1) A가 코멘트 생성 (ops 경유 — 도구 UI는 단일페이지 smoke가 검증)
  const root = await A.evaluate(() => {
    const { store, seed } = window.__figcad;
    return store.addComment({ levelId: seed.levelId, at: [1000, 1000], author: '소장', text: '여기 벽 두께 확인해주세요' });
  });
  console.log('PASS  코멘트 생성 (ops)');

  // 2) B에 전파 + 패널 표시
  await B.waitForFunction((id) => window.__figcad.store.getComment(id)?.text?.includes('두께'), { timeout: 8000 }, root);
  await B.evaluate(() => window.__figcad.ui.getState().setCommentsOpen(true));
  await B.waitForSelector('.cmt-item', { timeout: 3000 });
  console.log('PASS  A→서버→B 코멘트 전파 + 패널 렌더');

  // 3) 동시 답글 (A·B 거의 동시) → 무클로버
  await Promise.all([
    A.evaluate((id) => window.__figcad.store.replyComment(id, { author: '소장', text: '답글-소장' }), root),
    B.evaluate((id) => window.__figcad.store.replyComment(id, { author: '실무', text: '답글-실무' }), root),
  ]);
  const bothSurvive = async (page) =>
    page.waitForFunction(
      (id) => window.__figcad.store.listComments().filter((c) => c.parentId === id).length === 2,
      { timeout: 8000 },
      root,
    );
  await bothSurvive(A);
  await bothSurvive(B);
  console.log('PASS  동시 답글 2개 양쪽 생존 (무클로버)');

  // 4) 해결 토글 전파
  await A.evaluate((id) => window.__figcad.store.resolveComment(id, true), root);
  await B.waitForFunction((id) => window.__figcad.store.getComment(id)?.resolved === true, { timeout: 8000 }, root);
  console.log('PASS  해결 상태 전파');

  // 5) 삭제 = 답글 연쇄, 양쪽 0
  await A.evaluate((id) => window.__figcad.store.deleteComment(id), root);
  await B.waitForFunction(() => window.__figcad.store.listComments().length === 0, { timeout: 8000 });
  console.log('PASS  루트 삭제 = 답글 연쇄, 양쪽 수렴');

  if (errs.length) throw new Error('콘솔/페이지 에러: ' + errs.slice(0, 3).join(' | '));
  console.log('\n코멘트 E2E 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
