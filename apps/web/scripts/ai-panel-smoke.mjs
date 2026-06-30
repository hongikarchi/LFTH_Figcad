/**
 * AI 패널 스모크 — AI dock 토글 → 메시지 전송 → 응답 표면화 → (키 있으면) 계획 승인까지.
 * iter-2 UI 반영: AI는 탭이 아닌 앰비언트 dock(.ai-toggle, PresenceStrip), 패널은 항상 mount(.ai-hidden 토글),
 *   모델 선택(.ai-model)·자동적용(.ai-auto) 컨트롤. .ai-input엔 숨김 file input이 먼저라 텍스트 입력은
 *   input:not([type=file])로 골라야 한다.
 * 사용: node scripts/ai-panel-smoke.mjs [포트 | 전체 origin URL]
 *   로컬 dev: node scripts/ai-panel-smoke.mjs 5196   (사전: vite dev + 백엔드 8787)
 *   프로덕션: node scripts/ai-panel-smoke.mjs https://lfthfigcad-production.up.railway.app
 */
import puppeteer from 'puppeteer-core';

const target = process.argv[2] ?? '8787';
const origin = target.startsWith('http') ? target : `http://localhost:${target}`;
const room = `e2e-ai-${Math.random().toString(36).slice(2, 8)}`;
const url = `${origin}/?p=${room}`;
const PROMPT = '3m x 3m 방 하나';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('dialog', (d) => d.accept('AI테스터'));
  await page.goto(url, { waitUntil: 'load' });

  // 앱 로드 신호 = 항상-on 상단 프레임의 AI dock 토글(iter-2: 구 .quick-options/.qo-ai 대체)
  await page.waitForSelector('.ai-toggle', { timeout: 10000 });

  // AI 토글 → 패널 표시 (패널은 항상 mount → .ai-hidden 해제로 검증, 단순 존재로는 불충분)
  await page.click('.ai-toggle');
  await page.waitForSelector('.ai-panel:not(.ai-hidden)', { timeout: 5000 });
  console.log('PASS  AI 토글 → dock 표시 (.ai-panel 비-hidden)');

  // iter-2 컨트롤 존재 검증 — 모델 선택(3옵션)·자동적용. 이게 구 스모크를 깨뜨린 재설계 UI.
  const controls = await page.evaluate(() => {
    const model = document.querySelector('.ai-panel .ai-model');
    const auto = document.querySelector('.ai-panel .ai-auto input[type=checkbox]');
    const sendBtn = document.querySelector('.ai-panel .ai-input button:not(.ai-icon-btn)');
    return {
      modelOpts: model ? model.querySelectorAll('option').length : 0,
      hasAuto: !!auto,
      sendLabel: sendBtn ? sendBtn.textContent.trim() : null,
    };
  });
  if (controls.modelOpts < 3) throw new Error(`모델 선택 옵션 ${controls.modelOpts} (3 기대)`);
  if (!controls.hasAuto) throw new Error('자동적용 체크박스(.ai-auto) 없음');
  if (!controls.sendLabel) throw new Error('전송 버튼 없음');
  console.log(
    `PASS  iter-2 컨트롤 — 모델 ${controls.modelOpts}옵션 · 자동적용 · 전송("${controls.sendLabel}")`,
  );

  // 메시지 입력 → 전송. .ai-input의 첫 input은 숨김 file input이라 :not([type=file])로 텍스트칸 지정.
  const TEXT = '.ai-panel .ai-input input:not([type=file])';
  const SEND = '.ai-panel .ai-input button:not(.ai-icon-btn)';
  await page.type(TEXT, PROMPT);
  await page.waitForSelector(`${SEND}:not([disabled])`, { timeout: 5000 });
  await page.click(SEND);

  // 빠른 양성 확인 — 클라 send 경로가 실제로 발화했는지(잘못된 셀렉터를 120s 타임아웃으로 오판 방지).
  await page.waitForFunction(
    (txt) => [...document.querySelectorAll('.ai-msg.user')].some((m) => m.textContent.includes(txt)),
    { timeout: 5000 },
    PROMPT,
  );
  console.log('PASS  메시지 전송 → user 버블 표시 (send 경로 발화)');

  // 서버 응답 표면화 — 키 미설정/연결오류면 '오류' notice, 키 설정 시 스트리밍 어시스턴트 텍스트
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

  // 실행 완료 대기 — running 동안 텍스트 입력이 disabled, 끝나면 풀림 (file input은 항상 풀려있어 제외)
  await page.waitForSelector(`${TEXT}:not([disabled])`, { timeout: 180000 });

  // 계획 카드까지 왔으면 (키 설정 시) 승인 → 적용 + 문서 요소 증가 확인
  // 프로덕션 빌드엔 window.__figcad 없음(데브 전용) → '✓ N개 작업 적용됨' notice로 검증
  const hasPlan = await page.$('.ai-plan');
  if (hasPlan) {
    const before = await page.evaluate(() => window.__figcad?.store.listElements().length);
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
    const after = await page.evaluate(() => window.__figcad?.store.listElements().length);
    if (before !== undefined && after !== undefined) {
      if (after <= before) throw new Error(`적용 후 요소 미증가 (${before} → ${after})`);
      console.log(`PASS  문서 요소 ${before} → ${after}개 증가 (데브 빌드 — 실제 적용 확인)`);
    }
  } else {
    console.log(
      'SKIP  계획 카드 없음 — API 키 미설정/백엔드 연결오류면 정상. 오류 표면화까지가 이 스모크의 범위' +
        ' (sketch→Claude→opLog 해피패스는 sketch-live-e2e가 별도 검증).',
    );
  }

  console.log('\nAI 패널 스모크 통과');
} catch (err) {
  console.error('FAIL ', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
