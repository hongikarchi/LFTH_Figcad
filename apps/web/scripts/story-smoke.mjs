/**
 * 레벨 구조화 E2E 스모크 (M4) — 커넥터 2단계 프로토콜을 Rhino 없이 HTTP로 재현.
 *  1) POST-A add_level('2층') → 실 id  2) POST-C 요소(&dedup=1) 두 층 배치
 *  3) 재푸시 프로토콜: pull → elevation 매치 = add_level 스킵 → 요소 전량 dedup·레벨 무증가
 *  4) M2 핵심: 평탄 푸시(1층+baseOffset) 후 층 구조화 재푸시(신규층+0) = 0 적용(절대 z 매칭)
 *  5) 브라우저: ui_set_story 실행기 → activeLevelId+plan 전환 + 타 층 고스팅(0.12)
 * 사전: vite dev + 백엔드 8787(miniflare — ?op= 라우트). 사용: node story-smoke.mjs [vite포트] [서버포트]
 */
import puppeteer from 'puppeteer-core';

const vitePort = process.argv[2] ?? '5173';
const srv = `http://localhost:${process.argv[3] ?? '8787'}`;
const room = `story-smoke-${Math.random().toString(36).slice(2, 8)}`;

let pass = 0;
let fail = 0;
const failures = [];
function check(ok, label, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
  return ok;
}

const apply = (ops, dedup = false) =>
  fetch(`${srv}/parties/doc/${room}?op=apply${dedup ? '&dedup=1' : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ops }),
  }).then((r) => r.json());
const pull = () => fetch(`${srv}/parties/doc/${room}?op=pull`).then((r) => r.json());

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

try {
  const errors = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('dialog', (d) => d.accept('스토리'));
  await page.goto(`http://localhost:${vitePort}/?p=${room}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__figcad?.store && window.__figcad?.seed, { timeout: 20000 });
  const seed = await page.evaluate(() => {
    const s = window.__figcad.seed;
    return { levelId: s.levelId, wallTypeId: s.wallTypeIds[0], colTypeId: s.columnTypeId, slabTypeId: s.slabTypeId };
  });
  // 서버 동기 폴링 (콜드 스타트 레이스 방지 — connector-golden 패턴)
  let synced = false;
  for (let i = 0; i < 40 && !synced; i++) {
    try {
      const s = await pull();
      synced = (s.levels?.length ?? 0) >= 1 && (s.types?.length ?? 0) >= 1;
    } catch {}
    if (!synced) await new Promise((r) => setTimeout(r, 400));
  }
  if (!synced) throw new Error('서버 시드 미동기');

  // ---------- 1) POST-A: 레벨 생성 (요소와 별도 요청 — 커넥터 프로토콜) ----------
  const a1 = await apply([{ op: 'add_level', args: { name: '2층', elevation: 3400, height: 3000, order: 1 } }]);
  const l2 = a1.createdIds?.[0];
  check(a1.applied === 1 && !!l2, `POST-A add_level 2층 → 실 id (${l2})`);

  // ---------- 2) POST-C: 요소 ops (&dedup=1) — 두 층 배치 ----------
  const elementOps = [
    { op: 'create_wall', args: { levelId: seed.levelId, typeId: seed.wallTypeId, a: [0, 0], b: [4200, 0] } },
    { op: 'create_wall', args: { levelId: l2, typeId: seed.wallTypeId, a: [0, 0], b: [4200, 0] } },
    { op: 'create_column', args: { levelId: seed.levelId, typeId: seed.colTypeId, at: [1000, 2000], height: 3000 } },
    { op: 'create_slab', args: { levelId: l2, typeId: seed.slabTypeId, boundary: [[0, 0], [4200, 0], [4200, 3000], [0, 3000]] } },
  ];
  const c1 = await apply(elementOps, true);
  check(c1.applied === 4 && (c1.deduped ?? 0) === 0, `POST-C 요소 4개 적용 (1층 벽·기둥 + 2층 벽·슬라브)`, JSON.stringify(c1));
  const wallL1 = c1.createdIds?.[0];
  const wallL2 = c1.createdIds?.[1];

  // ---------- 3) 재푸시 프로토콜 — pull 매치 = add_level 스킵 + 요소 전량 dedup ----------
  const snap2 = await pull();
  const matched = (snap2.levels ?? []).find((l) => Math.abs(l.elevation - 3400) <= 250);
  check(!!matched && matched.id === l2, '재푸시 pull: elevation ±250 매치 → add_level 스킵 (커넥터 재사용 규약)');
  const c2 = await apply(elementOps, true);
  check(c2.applied === 0 && c2.deduped === 4, `재푸시 요소 전량 dedup (applied ${c2.applied} · deduped ${c2.deduped})`, JSON.stringify(c2));
  const snap3 = await pull();
  check((snap3.levels ?? []).length === 2, `레벨 무증가 (${snap3.levels?.length}개 유지)`);

  // ---------- 4) M2 핵심 — 평탄 푸시 후 층 구조화 재푸시 = 절대 z 매칭 0 적용 ----------
  const flat = await apply(
    [{ op: 'create_wall', args: { levelId: seed.levelId, typeId: seed.wallTypeId, a: [0, 9000], b: [4200, 9000], baseOffset: 6800 } }],
    true,
  );
  check(flat.applied === 1, '평탄 푸시 (1층 + baseOffset 6800 — v0.6 커넥터꼴)');
  const a3 = await apply([{ op: 'add_level', args: { name: '3층', elevation: 6800, height: 3000, order: 2 } }]);
  const l3 = a3.createdIds?.[0];
  const restructured = await apply(
    [{ op: 'create_wall', args: { levelId: l3, typeId: seed.wallTypeId, a: [0, 9000], b: [4200, 9000] } }],
    true,
  );
  check(
    restructured.applied === 0 && restructured.deduped === 1,
    `층 구조화 재푸시 = 절대 z 크로스레벨 dedup (applied ${restructured.applied} · deduped ${restructured.deduped})`,
    JSON.stringify(restructured),
  );

  // ---------- 5) 브라우저 — ui_set_story 실행기 + 고스팅 ----------
  await page.waitForFunction(
    (id) => !!window.__figcad.store.getLevel(id),
    { timeout: 8000 },
    l2,
  );
  const story = await page.evaluate(
    async ({ l2, wallL1, wallL2 }) => {
      const F = window.__figcad;
      const mod = await import('/src/ai/uiActionExecutor.ts');
      // ui_set_story는 actions 미사용(스토어만) — 서버 정규화 payload 형태 그대로
      const res = mod.executeUiAction(
        { action: 'ui_set_story', summary: '2층 평면', params: { levelId: l2, levelName: '2층' } },
        { actions: {}, store: F.store },
      );
      await new Promise((r) => setTimeout(r, 400)); // 고스팅 반영(구독→applyGhosting)
      const ui = F.ui.getState();
      const e1 = F.sceneManager.entries.get(wallL1);
      const e2 = F.sceneManager.entries.get(wallL2);
      return {
        ok: res.ok,
        notice: res.notice,
        activeLevelId: ui.activeLevelId,
        viewMode: ui.viewMode,
        l1Opacity: e1 ? e1.mesh.material.opacity : null,
        l2Opacity: e2 ? e2.mesh.material.opacity : null,
      };
    },
    { l2, wallL1, wallL2 },
  );
  check(story.ok && story.activeLevelId === l2 && story.viewMode === 'plan', `ui_set_story → activeLevel=2층 + plan (${story.notice})`);
  check(story.l1Opacity !== null && story.l1Opacity <= 0.2, `타 층(1층 벽) 고스팅 (opacity ${story.l1Opacity} ≤ 0.2)`);
  check(story.l2Opacity === 1, `활성 층(2층 벽) 불투명 (opacity ${story.l2Opacity})`);

  if (errors.length) check(false, '콘솔/페이지 에러 0건', errors.slice(0, 3).join(' | '));
  else check(true, '콘솔/페이지 에러 0건');
} catch (err) {
  fail++;
  failures.push(String(err.message ?? err));
  console.error('FAIL  (중단)', err.message ?? err);
} finally {
  await browser.close();
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass / ${fail} fail${failures.length ? `\n  실패: ${failures.join('\n  실패: ')}` : ''}`);
process.exitCode = fail === 0 ? 0 : 1;
