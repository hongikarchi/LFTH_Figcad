// Figcad(로컬 8788) 렌더 스크린샷 — Rhino MCP capture_viewport와 병치 비교용(갭 진단).
// 용도: Rhino MCP로 룸 push + capture_viewport(라이노 샷) → 이 스크립트로 Figcad 샷 → 나란히 본다.
// 전부 로컬(8788), 배포 0. puppeteer-core(playwright 미설치 — 기능 동일).
// 사용: ROOM=cmp PORT=8788 node apps/web/scripts/figcad-vs-rhino.mjs
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT ?? '8788';
const ROOM = process.env.ROOM ?? 'cmp';
const OUT = process.env.OUT ?? `apps/web/scripts/_figcad-${ROOM}.png`;
const url = `http://localhost:${PORT}/?p=${ROOM}`;

const b = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1600,1000'],
});
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1600, height: 1000 });
  p.on('dialog', (d) => d.accept('비교'));
  await p.goto(url, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 6000)); // boot + sync
  await p.keyboard.press('f'); // 전체맞춤
  await new Promise((r) => setTimeout(r, 2500));
  await p.screenshot({ path: OUT });
  console.log(`Figcad 샷 → ${OUT}`);
} finally {
  await b.close();
}
