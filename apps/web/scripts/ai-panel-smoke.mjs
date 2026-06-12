/**
 * AI 패널 스모크 — AI 토글 → 메시지 전송 → 응답 표면화 → (키 있으면) 계획 승인까지.
 * 사용: node scripts/ai-panel-smoke.mjs [포트 | 전체 origin URL]
 *   로컬: node scripts/ai-panel-smoke.mjs 8787   (사전: apps/server에서 node dev.mjs)
 *   프로덕션: node scripts/ai-panel-smoke.mjs https://figcad.archivibe.workers.dev
 */
import puppeteer from 'puppeteer-core';

const target = process.argv[2] ?? '8787';
const origin = target.startsWith('http') ? target : `http://localhost:${target}`;
const room = `e2e-ai-${Math.random().toString(36).slice(2, 8)}`;
const url = `${origin}/?p=${room}`;

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

  // 실행 완료 대기 — running 동안 입력이 disabled, 끝나면 풀림
  await page.waitForSelector('.ai-input input:not([disabled])', { timeout: 180000 });

  // 계획 카드까지 왔으면 (키 설정 시) 승인 → 적용 확인
  // 프로덕션 빌드엔 window.__figcad 없음(데브 전용) → '✓ N개 작업 적용됨' notice로 검증
  const hasPlan = await page.$('.ai-plan');
  if (hasPlan) {
    const planItems = await page.evaluate(
      () => document.querySelectorAll('.ai-plan ol li').length,
    );
    console.log(`PASS  계획 카드 표시 — 작업 ${planItems}개`);
    await page.click('.ai-approve');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.ai-msg.notice')].some((m) =>
          m.textContent.includes('적용됨'),
        ),
      { timeout: 10000 },
    );
    const notice = await page.evaluate(
      () =>
        [...document.querySelectorAll('.ai-msg.notice')].find((m) =>
          m.textContent.includes('적용됨'),
        )?.textContent,
    );
    console.log(`PASS  승인 → ${notice}`);
    const devCount = await page.evaluate(() => window.__figcad?.store.listElements().length);
    if (devCount !== undefined) console.log(`PASS  문서 요소 ${devCount}개 (데브 빌드 확인)`);
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
