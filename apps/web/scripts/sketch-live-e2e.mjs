/**
 * M9-A 라이브 vision E2E — 실제 Claude 호출(소액 토큰).
 * 로컬 vite(DEV)에서 seed snapshot + 손그림 스케치 래스터 생성 → 배포 /api/agent에 직접 POST.
 * 사용: node scripts/sketch-live-e2e.mjs [vite포트=5173] [배포URL]
 */
import puppeteer from 'puppeteer-core';

const port = process.argv[2] ?? '5173';
const base = process.argv[3] ?? 'https://lfthfigcad-production.up.railway.app';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

let payload;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`http://localhost:${port}/?p=live-${Math.random().toString(36).slice(2, 7)}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.sketch, { timeout: 10000 });
  await page.evaluate(() => window.__figcad.ui.getState().setTool('sketch')); // plan+북향
  await new Promise((r) => setTimeout(r, 400));

  // 닫힌 사각형 방 손그림 (4변)
  const seg = async (x1, y1, x2, y2) => {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(x1 + ((x2 - x1) * i) / 6, y1 + ((y2 - y1) * i) / 6);
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 40));
  };
  await seg(450, 300, 800, 300);
  await seg(800, 300, 800, 560);
  await seg(800, 560, 450, 560);
  await seg(450, 560, 450, 300);

  payload = await page.evaluate(() => ({
    snapshot: window.__figcad.store.snapshot(),
    sketch: window.__figcad.sketch.rasterizeSketch(),
  }));
} finally {
  await browser.close();
}

if (!payload?.sketch) throw new Error('스케치 생성 실패');
const frame = payload.sketch.frame;
console.log(`스케치 프레임 ${frame.x1 - frame.x0}×${frame.y1 - frame.y0}mm, PNG ${Math.round(payload.sketch.dataB64.length / 1024)}KB → 배포 /api/agent 호출…`);

const res = await fetch(`${base}/api/agent`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    snapshot: payload.snapshot,
    transcript: [{ role: 'user', text: '이 스케치대로 방을 만들어줘. 벽 높이는 기본값.' }],
    sketch: payload.sketch,
  }),
});
if (!res.ok) {
  console.error(`FAIL  /api/agent ${res.status}: ${await res.text()}`);
  process.exit(1);
}

// SSE 파싱
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '';
let text = '';
const ops = [];
let done = null;
const handle = (line) => {
  if (!line.startsWith('data: ')) return;
  const ev = JSON.parse(line.slice(6));
  if (ev.type === 'text') text += ev.text;
  else if (ev.type === 'op') ops.push(ev.summary || ev.op);
  else if (ev.type === 'done') done = ev;
  else if (ev.type === 'error') throw new Error('agent error: ' + ev.error);
};
for (;;) {
  const { done: d, value } = await reader.read();
  if (d) break;
  buf += dec.decode(value, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    handle(buf.slice(0, i).trim());
    buf = buf.slice(i + 2);
  }
}
if (buf.trim()) handle(buf.trim());

console.log('\n--- AI 응답 ---\n' + text.trim().slice(0, 500));
console.log('\n--- opLog (' + (done?.opLog?.length ?? 0) + '개) ---');
for (const s of ops) console.log('· ' + s);

const log = done?.opLog ?? [];
const walls = log.filter((e) => e.op === 'create_wall');
if (walls.length < 3) {
  console.error(`\nFAIL  방을 이루는 벽이 부족 (create_wall ${walls.length}개, ≥3 기대)`);
  process.exit(1);
}
// 벽 끝점이 공유되는지(닫힌 방 = 마이터) — 좌표 수집
const pts = walls.flatMap((w) => [JSON.stringify(w.args.a), JSON.stringify(w.args.b)]);
const shared = pts.filter((p, i) => pts.indexOf(p) !== i).length;
console.log(`\nPASS  벽 ${walls.length}개 생성, 공유 끝점 ${shared}쌍 (닫힌 방 신호)`);
console.log('라이브 vision E2E 통과 — 스케치→실Claude→opLog(벽)');
