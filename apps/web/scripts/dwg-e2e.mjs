// DWG 업로드 end-to-end — 앱서 실 서버(8787) fed-upload → addFederationSource → reconciler 페치·파싱·렌더.
// __figcad parse 직접호출(스모크)과 달리 서버 blob 라운드트립 + reconciler 전체경로 검증.
import puppeteer from 'puppeteer-core';
const PORT = process.env.PORT ?? '5184';
const BACKEND = 'http://localhost:8787';
const room = 'dwge2e';
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new',
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1400,1000'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  const errs = [];
  page.on('console', (m) => { const t = m.text(); if (/error|fail|federation|underlay|dwg/i.test(t)) console.log('[page]', t); });
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.store && window.__figcad?.federation && window.__figcad?.referenceLayer, { timeout: 20000 });

  // 1) 앱서 DWG bytes → 실 서버 fed-upload → blob URL → addFederationSource(dwg + underlay)
  const up = await page.evaluate(async (BACKEND, room) => {
    const F = window.__figcad;
    const buf = await (await fetch('/__dwgtest.dwg')).arrayBuffer();
    const u = await F.dwg.parseDwgUnderlay(buf, 'dwg');
    const [dx, dy] = F.dwg.underlayDenseCenter(u);
    const res = await fetch(`${BACKEND}/parties/doc/${room}?op=fed-upload&ext=dwg`, { method: 'POST', body: buf });
    if (!res.ok) return { error: `fed-upload ${res.status}` };
    const { url } = await res.json();
    const ref = `${BACKEND}/parties/doc/${room}${url}`;
    const levelId = F.store.listLevels()[0]?.id ?? '';
    const id = F.store.addFederationSource({ name: 'e2e.dwg', sourceType: 'dwg', ref, visible: true, addedBy: 'e2e', underlay: { levelId, origin: [-dx, -dy], rotation: 0, scale: 1 } });
    return { id, ref, blobUrl: url };
  }, BACKEND, room);
  console.log('업로드:', JSON.stringify(up));
  if (up.error) throw new Error(up.error);

  // 2) reconciler가 blob 페치+파싱+렌더 대기 (referenceLayer에 소스 등장)
  await page.waitForFunction((id) => window.__figcad.referenceLayer.list().includes(id), { timeout: 30000 }, up.id).catch(() => {});
  const out = await page.evaluate((id) => {
    const F = window.__figcad;
    let verts = 0; F.referenceLayer.root.traverse((o) => { if (o.isLineSegments) verts += o.geometry.attributes.position.count; });
    return { refList: F.referenceLayer.list(), status: F.federation.statusOf?.(id), error: F.federation.errorOf?.(id), renderedSegments: verts / 2 };
  }, up.id);
  console.log('reconciler 결과:', JSON.stringify(out));
  console.log(out.refList.includes(up.id) && out.renderedSegments > 1000
    ? `✓ E2E 통과 — 서버 업로드→reconciler 페치·파싱·렌더 (${out.renderedSegments.toLocaleString()} 세그)`
    : `✗ E2E 실패 — status=${out.status} err=${out.error}`);
  console.log('pageErrors:', JSON.stringify(errs));
} finally { await browser.close(); }
