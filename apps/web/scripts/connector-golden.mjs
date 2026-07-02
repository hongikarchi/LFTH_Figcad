/**
 * 커넥터 골든 씬 검증 — TestHarness(GoldenPush, Rhino MCP) 결과를 서버 스냅샷으로 단언.
 * 사용:
 *   node connector-golden.mjs seed   <room> [vite포트=5173]   — DEV 앱 1회 오픈(기본 레벨+타입 시드)
 *   node connector-golden.mjs assert <room> [서버포트=8787]    — ?op=pull vs golden/rhino-golden.expected.json
 * 흐름: seed → (Rhino MCP: Figcad.TestHarness.GoldenPush ×2회 push 포함) → assert.
 * assert의 kind별 EXACT 카운트가 2회 push dedup(중복 0)까지 겸함.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const mode = process.argv[2];
const room = process.argv[3];
if (!mode || !room) {
  console.error('사용: node connector-golden.mjs seed|assert <room> [포트]');
  process.exit(1);
}

if (mode === 'seed') {
  const vitePort = process.argv[4] ?? '5173';
  const { default: puppeteer } = await import('puppeteer-core');
  const chrome = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    page.on('dialog', (d) => d.accept('골든'));
    await page.goto(`http://localhost:${vitePort}/?p=${room}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__figcad?.store && window.__figcad?.seed, { timeout: 15000 });
    const info = await page.evaluate(() => {
      const s = window.__figcad.seed;
      return { levelId: s.levelId, stair: !!s.stairTypeId, railing: !!s.railingTypeId, slab: !!s.slabTypeId };
    });
    // 서버 동기 = 폴링(고정 슬립은 콜드 스타트서 레이스 → 이후 골든 전체가 인프라 플레이크로 전멸)
    const srv = `http://localhost:${process.env.SRV_PORT ?? '8787'}`;
    let synced = false;
    for (let i = 0; i < 40 && !synced; i++) {
      try {
        const snap = await fetch(`${srv}/parties/doc/${room}?op=pull`).then((r) => (r.ok ? r.json() : null));
        const kinds = new Set((snap?.types ?? []).map((t) => t.kind));
        synced = (snap?.levels?.length ?? 0) >= 1 && kinds.has('stair') && kinds.has('railing') && kinds.has('slab');
      } catch {}
      if (!synced) await new Promise((r) => setTimeout(r, 400));
    }
    console.log('SEEDED', room, JSON.stringify(info), synced ? '(서버 동기 확인)' : '');
    if (!info.stair || !info.railing || !info.slab || !synced) {
      console.error('FAIL  시드 미완(타입 누락 또는 서버 미동기)');
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
} else if (mode === 'assert') {
  const srv = `http://localhost:${process.argv[4] ?? '8787'}`;
  const here = dirname(fileURLToPath(import.meta.url));
  const exp = JSON.parse(readFileSync(join(here, 'golden', 'rhino-golden.expected.json'), 'utf8'));
  const res = await fetch(`${srv}/parties/doc/${room}?op=pull`);
  if (!res.ok) {
    console.error(`FAIL  ?op=pull ${res.status} — 서버/룸 확인 (${srv}, ${room})`);
    process.exit(1);
  }
  const snap = await res.json();
  if (!Array.isArray(snap.elements) || !Array.isArray(snap.types)) {
    console.error(`FAIL  스냅샷 형식 이상: ${JSON.stringify(snap).slice(0, 200)}`);
    process.exit(1);
  }

  let fails = 0;
  const ok = (cond, label, detail = '') => {
    if (cond) console.log(`PASS  ${label}`);
    else { console.error(`FAIL  ${label}${detail ? ' — ' + detail : ''}`); fails++; }
  };
  const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
  const nearPt = (p, q, tol = 2) => near(p[0], q[0], tol) && near(p[1], q[1], tol);
  // 순서 보존 비교 — dims = [width, depth] 그대로. 정렬 비교는 폭/춤 전치 회귀(프레임 축 스왑)를 면제시킴.
  const dimsMatch = (a, b) => a.length === b.length && a.every((v, i) => near(v, b[i]));
  const typeOf = (el) => snap.types.find((t) => t.id === el.typeId);
  const els = snap.elements ?? [];
  const byKind = (k) => els.filter((e) => e.kind === k);

  // 레벨
  ok(snap.levels?.length >= 1 && near(snap.levels[0].elevation ?? 0, exp.levelElevation), '레벨 elevation 0', JSON.stringify(snap.levels?.[0]));

  // kind별 EXACT 카운트 (2회 push dedup 겸용)
  for (const [k, n] of Object.entries(exp.kindCounts))
    ok(byKind(k).length === n, `${k} 개수 = ${n}`, `실제 ${byKind(k).length}`);

  // 섹션 매처
  const secMatch = (sec, expSec) => {
    if (!sec || sec.shape !== expSec.shape) return false;
    if (expSec.shape === 'rect') return dimsMatch([sec.width, sec.depth], expSec.dims);
    if (expSec.shape === 'circle') return near(sec.diameter, expSec.d);
    if (expSec.shape === 'hsection')
      return dimsMatch([sec.width, sec.depth], expSec.dims) && near(sec.web, expSec.web, 1) && near(sec.flange, expSec.flange, 1);
    if (expSec.shape === 'polygon') return (sec.points?.length ?? 0) === expSec.points;
    return false;
  };

  // 기둥 — 기대 각각이 정확히 1개 매치
  for (const c of exp.columns) {
    const m = byKind('column').filter((e) => {
      const t = typeOf(e);
      if (!t || !secMatch(t.section, c.section)) return false;
      if (!near(e.height, c.height)) return false;
      if (c.at) return nearPt(e.at, c.at);
      const [x0, y0, x1, y1] = c.atBox;
      return e.at[0] >= x0 && e.at[0] <= x1 && e.at[1] >= y0 && e.at[1] <= y1;
    });
    ok(m.length === 1, `기둥 ${c.name}`, `매치 ${m.length}개 · 후보 ${JSON.stringify(byKind('column').map((e) => ({ at: e.at, h: e.height, sec: typeOf(e)?.section })))}`);
  }

  // 보 — a/b 순서 무관, zOffset·섹션
  for (const b of exp.beams) {
    const m = byKind('beam').filter((e) => {
      const t = typeOf(e);
      if (!t || !secMatch(t.section, b.section)) return false;
      if (!near(e.zOffset ?? 0, b.zOffset)) return false;
      const fwd = nearPt(e.a, b.ab[0]) && nearPt(e.b, b.ab[1]);
      const rev = nearPt(e.a, b.ab[1]) && nearPt(e.b, b.ab[0]);
      return fwd || rev;
    });
    ok(m.length === 1, `보 ${b.name}`, `매치 ${m.length}개 · 후보 ${JSON.stringify(byKind('beam').map((e) => ({ a: e.a, b: e.b, z: e.zOffset, sec: typeOf(e)?.section })))}`);
  }

  // 벽
  for (const w of exp.walls) {
    const m = byKind('wall').filter((e) => {
      const t = typeOf(e);
      if (!t || !near(t.thickness, w.thickness)) return false;
      if (!near(e.height, w.height)) return false;
      const fwd = nearPt(e.a, w.ab[0]) && nearPt(e.b, w.ab[1]);
      const rev = nearPt(e.a, w.ab[1]) && nearPt(e.b, w.ab[0]);
      return fwd || rev;
    });
    ok(m.length === 1, `벽 ${w.name}`, `매치 ${m.length}개 · 후보 ${JSON.stringify(byKind('wall').map((e) => ({ a: e.a, b: e.b, h: e.height, t: typeOf(e)?.thickness })))}`);
  }

  // 슬라브 — boundary bbox + 점수
  for (const s of exp.slabs) {
    const m = byKind('slab').filter((e) => {
      const pts = e.boundary ?? [];
      if (pts.length !== s.points) return false;
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const [x0, y0, x1, y1] = s.boundaryBox;
      return near(Math.min(...xs), x0) && near(Math.min(...ys), y0) && near(Math.max(...xs), x1) && near(Math.max(...ys), y1);
    });
    ok(m.length === 1, `슬라브 ${s.name}`, `매치 ${m.length}개 · 후보 ${JSON.stringify(byKind('slab').map((e) => e.boundary))}`);
  }

  // 계단/난간 — a/b가 기대 bbox 내(현행 bbox 근사 → 파라메트릭 전환 후에도 유효)
  const abInBox = (e, box) => {
    const [x0, y0, x1, y1] = box;
    const inb = (p) => p[0] >= x0 - 2 && p[0] <= x1 + 2 && p[1] >= y0 - 2 && p[1] <= y1 + 2;
    return inb(e.a) && inb(e.b);
  };
  for (const s of exp.stairs)
    ok(byKind('stair').filter((e) => abInBox(e, s.abBox)).length === 1, `계단 ${s.name}`, JSON.stringify(byKind('stair').map((e) => ({ a: e.a, b: e.b }))));
  for (const r of exp.railings)
    ok(byKind('railing').filter((e) => abInBox(e, r.abBox)).length === 1, `난간 ${r.name}`, JSON.stringify(byKind('railing').map((e) => ({ a: e.a, b: e.b }))));

  // Lane-2 잔여 → federation 소스
  ok((snap.federation?.length ?? 0) >= exp.federationMin, `federation 잔여 소스 ≥ ${exp.federationMin}`, `실제 ${snap.federation?.length ?? 0}`);

  console.log(fails === 0 ? '\n골든 단언 전부 통과' : `\n골든 단언 실패 ${fails}건`);
  process.exitCode = fails === 0 ? 0 : 1;
} else {
  console.error(`알 수 없는 모드: ${mode}`);
  process.exit(1);
}
