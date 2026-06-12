/**
 * AI 패널 스모크 — miniflare(빌드된 dist) 페이지에서 AI 토글 → 메시지 전송 →
 * 서버 응답(키 미설정 503 또는 실제 계획)이 패널에 표면화되는지 확인.
 * 사전 조건: apps/server에서 `node dev.mjs` 구동 중 (PORT 기본 8787).
 * 사용: node scripts/ai-panel-smoke.mjs [port]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '8787';
const room = `e2e-ai-${Math.random().toString(36).slice(2, 8)}`;
const url = `http://localhost:${port}/?p=${room}`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept('AI테스터'));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('.quick-options', { timeout: 10000 });

  // AI 토글 → 패널 열림
  await page.click('.qo-ai');
  await page.waitForSelector('.ai-panel', { timeout: 5000 });
  console.log('PASS  AI 토글 → 패널 열림');

  // 메시지 전송 → 서버 응답 표면화 (키 미설정이면 오류 notice, 설정 시 스트리밍 텍스트)
  await page.type('.ai-input input', '3m x 3m 방 하나');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => {
      const msgs = [...document.querySelectorAll('.ai-msg')];
      return msgs.some(
        (m) =>
          (m.classList.contains('notice') && m.textContent.includes('오류')) ||
          // '…'는 진행 플레이스홀더 — 실제 스트리밍 텍스트만 인정
          (m.classList.contains('assistant') && m.textContent.trim().length > 3),
      );
    },
    { timeout: 120000 },
  );
  const surfaced = await page.evaluate(() =>
    [...document.querySelectorAll('.ai-msg')].map((m) => `${m.className}: ${m.textContent.slice(0, 120)}`),
  );
  console.log('PASS  서버 응답이 패널에 표면화:');
  for (const s of surfaced) console.log('      ' + s);

  // 계획 카드까지 왔으면 (키 설정 시) 승인 → 요소 생성 확인
  const hasPlan = await page.$('.ai-plan');
  if (hasPlan) {
    const before = await page.evaluate(() => window.__figcad?.store.listElements().length ?? -1);
    await page.click('.ai-approve');
    await page.waitForFunction(
      (n) => (window.__figcad?.store.listElements().length ?? -1) > n,
      { timeout: 5000 },
      before,
    );
    const after = await page.evaluate(() => window.__figcad.store.listElements().length);
    console.log(`PASS  계획 승인 → 문서 요소 ${before} → ${after}개`);
  } else {
    console.log('SKIP  계획 카드 없음 (API 키 미설정이면 정상 — 오류 표면화까지가 이 스모크의 범위)');
  }

  console.log('\nAI 패널 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
