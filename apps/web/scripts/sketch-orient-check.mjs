/** 일회용: 비대칭 "ㄱ" 손그림 → 래스터 PNG 덤프. 방위(y-flip) 육안 확인용. */
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const port = process.argv[2] ?? '5173';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`http://localhost:${port}/?p=orient-${Math.random().toString(36).slice(2, 7)}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.sketch, { timeout: 10000 });
  await page.evaluate(() => {
    window.__figcad.ui.getState().setViewMode('plan');
    window.__figcad.ui.getState().setTool('sketch');
  });
  await new Promise((r) => setTimeout(r, 300));
  // "ㄱ": 화면 상단 가로(왼→오) 후 오른쪽 세로(아래로) — 한 스트로크
  await page.mouse.move(480, 320);
  await page.mouse.down();
  for (const [x, y] of [[600, 320], [780, 320], [780, 450], [780, 580]]) await page.mouse.move(x, y);
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 100));
  const dump = await page.evaluate(() => ({
    strokes: window.__figcad.sketch.getStrokes().map((s) => s.map(([x, y]) => [Math.round(x), Math.round(y)])),
    viewMode: window.__figcad.ui.getState().viewMode,
  }));
  console.log('viewMode=' + dump.viewMode);
  console.log('strokes=' + JSON.stringify(dump.strokes));
  const b64 = await page.evaluate(() => window.__figcad.sketch.rasterizeSketch()?.dataB64 ?? '');
  if (!b64) throw new Error('빈 래스터');
  const out = join(here, '_sketch-orient.png');
  writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('WROTE ' + out);
} finally {
  await browser.close();
}
