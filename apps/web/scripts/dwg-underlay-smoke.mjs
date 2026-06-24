// DWG 언더레이 브라우저 스모크 — 실제 브라우저에서 libredwg WASM 로드 + 파싱 + flat-2D 렌더 검증.
// 전제: vite dev 실행 + apps/web/public/__dwgtest.dwg 존재.
// 사용: PORT=5174 node apps/web/scripts/dwg-underlay-smoke.mjs
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT ?? '5174';
const url = `http://localhost:${PORT}/?p=dwgsmoke`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1600,1100'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1100 });
  const errs = [];
  page.on('console', (m) => { const t = m.text(); if (/error|fail|wasm|dwg|underlay|libredwg/i.test(t)) console.log('[page]', t); });
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.dwg?.parseDwgUnderlay && window.__figcad?.referenceLayer, { timeout: 20000 });

  // 브라우저 경로로 파싱 + 렌더 (WASM 로드 포함)
  const result = await page.evaluate(async () => {
    const t0 = performance.now();
    const res = await fetch('/__dwgtest.dwg');
    const buf = await res.arrayBuffer();
    const F = window.__figcad;
    const u = await F.dwg.parseDwgUnderlay(buf, 'dwg');
    const tParse = performance.now() - t0;

    // 무필터 denseCenter는 메가시트에서 교통 베이스맵을 집을 수 있다 → 건물레이어(REF/교통 제외)만으로
    // dense center 재계산해 실제 평면을 원점에 센터링(slice③ 레이어필터의 자동버전 프리뷰).
    const isRef = (l) => /^REF-|교통|주변|표지판|신호등|현황/.test(l);
    const win = 50000, bins = new Map();
    let best = '', bestN = 0, bldSegs = 0;
    for (let i = 0; i < u.segments.length; i += 4) {
      if (isRef(u.layers[u.segLayer[i / 4]])) continue;
      bldSegs++;
      const mx = (u.segments[i] + u.segments[i + 2]) / 2, my = (u.segments[i + 1] + u.segments[i + 3]) / 2;
      const k = `${Math.floor(mx / win)},${Math.floor(my / win)}`;
      const c = bins.get(k) ?? { n: 0, sx: 0, sy: 0 }; c.n++; c.sx += mx; c.sy += my; bins.set(k, c);
      if (c.n > bestN) { bestN = c.n; best = k; }
    }
    const c = bins.get(best);
    const dx = c ? c.sx / c.n : 0, dy = c ? c.sy / c.n : 0;
    F.referenceLayer.addUnderlay('smoke', u, { origin: [-dx, -dy], rotation: 0, scale: 1 }, 0);
    return {
      tParse: Math.round(tParse),
      segments: u.segments.length / 4,
      buildingSegments: bldSegs,
      labels: u.labels.length,
      layers: u.layers.length,
      skipped: u.skipped,
      buildingDenseCenter: [Math.round(dx), Math.round(dy)],
      refList: F.referenceLayer.list(),
    };
  });

  // 3/4 perspective 줌인 한 장
  await page.evaluate(() => {
    const F = window.__figcad;
    F.rig?.fitBounds?.({ x: -35, y: -3, z: -35 }, { x: 35, y: 3, z: 35 });
    F.engine?.requestRender?.();
  });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: 'apps/web/scripts/dwg-underlay-persp.png' });

  // plan(top-down ortho) 뷰 — 빽도면 본연의 모습. setMode 트윈 대기.
  await page.evaluate(() => {
    const F = window.__figcad;
    F.rig?.setMode?.('plan');
    F.engine?.requestRender?.();
  });
  await new Promise((r) => setTimeout(r, 1800));
  await page.evaluate(() => {
    const F = window.__figcad;
    F.rig?.fitBounds?.({ x: -35, y: -3, z: -35 }, { x: 35, y: 3, z: 35 });
    F.engine?.requestRender?.();
  });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: 'apps/web/scripts/dwg-underlay-smoke.png' });

  console.log(JSON.stringify({ ...result, pageErrors: errs }, null, 2));
  console.log('screenshot → apps/web/scripts/dwg-underlay-smoke.png');
} finally {
  await browser.close();
}
