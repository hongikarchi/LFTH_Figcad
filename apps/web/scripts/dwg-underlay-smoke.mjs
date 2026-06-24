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

    // frozen/off 레이어는 extractor가 layerHidden으로 표시 → denseCenter·addUnderlay가 자동 제외.
    const [dx, dy] = F.dwg.underlayDenseCenter(u);
    // XCLIP: 건물 dense center 주변 60m 박스(DWG mm) → 그 안만 렌더(경계서 트림). 나머지 다 잘림.
    const HALF = 12000; // ±12m = 24m 박스 → 건물(~60m)보다 작아 사각 클립 경계가 보임
    const clip = [dx - HALF, dy - HALF, dx + HALF, dy + HALF];
    // 진단: 보이는(non-hidden) 세그 중 클립박스 안에 든 수 + 보이는 콘텐츠 실제 크기
    let visIn = 0, visTot = 0, vminx=1e15,vminy=1e15,vmaxx=-1e15,vmaxy=-1e15;
    for (let i = 0; i < u.segments.length; i += 4) {
      if (u.layerHidden[u.segLayer[i/4]]) continue;
      visTot++;
      const mx=(u.segments[i]+u.segments[i+2])/2, my=(u.segments[i+1]+u.segments[i+3])/2;
      if (mx>=clip[0]&&mx<=clip[2]&&my>=clip[1]&&my<=clip[3]) visIn++;
      vminx=Math.min(vminx,mx);vminy=Math.min(vminy,my);vmaxx=Math.max(vmaxx,mx);vmaxy=Math.max(vmaxy,my);
    }
    F.referenceLayer.addUnderlay('smoke', u, { origin: [-dx, -dy], rotation: 0, scale: 1, clip }, 0);
    // 실제 렌더된 LineSegments 정점 수
    let renderedVerts = 0;
    F.referenceLayer.root.traverse((o) => { if (o.isLineSegments) renderedVerts += o.geometry.attributes.position.count; });
    return {
      segments: u.segments.length / 4,
      visibleSegs: visTot,
      visibleSize_m: [Math.round((vmaxx-vminx)/1000), Math.round((vmaxy-vminy)/1000)],
      segsInsideClip: visIn,
      renderedSegments: renderedVerts / 2,
      denseCenter: [Math.round(dx), Math.round(dy)],
    };
  });

  // 3/4 perspective 줌인 한 장
  await page.evaluate(() => {
    const F = window.__figcad;
    F.rig?.fitBounds?.({ x: -45, y: -3, z: -45 }, { x: 45, y: 3, z: 45 });
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
    F.rig?.fitBounds?.({ x: -45, y: -3, z: -45 }, { x: 45, y: 3, z: 45 });
    F.engine?.requestRender?.();
  });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: 'apps/web/scripts/dwg-underlay-smoke.png' });

  console.log(JSON.stringify({ ...result, pageErrors: errs }, null, 2));
  console.log('screenshot → apps/web/scripts/dwg-underlay-smoke.png');
} finally {
  await browser.close();
}
