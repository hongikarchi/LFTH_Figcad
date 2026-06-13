/**
 * PWA 아이콘 생성 — public/icon.svg를 puppeteer로 렌더해 PNG 3종 생성.
 * (sharp 등 네이티브 의존성 없이 기존 puppeteer-core 재사용)
 * 사용: node scripts/gen-icons.mjs   (아이콘 디자인 변경 시에만 재실행)
 */
import puppeteer from 'puppeteer-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '../public');
const svg = await readFile(path.join(pub, 'icon.svg'), 'utf8');
await mkdir(path.join(pub, 'icons'), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});

try {
  const page = await browser.newPage();
  for (const size of [180, 192, 512]) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(
      `<style>*{margin:0}</style><div style="width:${size}px;height:${size}px">${svg.replace(
        /width="512" height="512"/,
        `width="${size}" height="${size}"`,
      )}</div>`,
    );
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: size, height: size } });
    const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
    await writeFile(path.join(pub, 'icons', name), png);
    console.log(`생성: icons/${name}`);
  }
} finally {
  await browser.close();
}
