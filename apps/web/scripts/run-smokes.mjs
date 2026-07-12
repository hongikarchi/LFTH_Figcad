/**
 * 스모크 통합 러너 — smoke-manifest.json 기반으로 vite/백엔드 수명주기를 관리하며
 * 스모크 스크립트를 선별 실행한다. 각 스크립트는 기존 규약(실패 시 exit 1) 그대로.
 *
 * 사용:
 *   node apps/web/scripts/run-smokes.mjs --all                # optIn 제외 전부
 *   node apps/web/scripts/run-smokes.mjs --tags paint,section # 태그 교집합 선별
 *   node apps/web/scripts/run-smokes.mjs --scripts walk-smoke.mjs,beam-smoke.mjs
 *   node apps/web/scripts/run-smokes.mjs --list               # 매니페스트 요약
 *   --strict-backend: 외부 백엔드가 요구 kind를 못 채우면 SKIP 대신 FAIL
 *
 * 동작:
 * - 포트는 5173/8787 고정 — 스크립트 다수(browser-e2e·dwg-e2e 등)가 하드코딩이라 가변화 불가.
 * - vite(:5173)·백엔드(:8787)는 이미 떠 있으면 재사용(안 죽임), 아니면 스폰 후 종료 시 트리 킬.
 *   외부 8787 재사용 시 kind 프로브(?op=pull — dev-node=503·miniflare=200)로 판별,
 *   miniflare 요구를 외부 dev-node가 못 채우면 해당 스크립트 SKIP(사유 기록).
 * - backend=node 그룹 실행 후 miniflare 그룹이 있으면 8787을 교체 기동(우리가 스폰한 경우만).
 * - 인프라 기동 실패는 해당 스크립트 FAIL 처리 후 계속 진행(같은 인프라는 재시도 안 함) —
 *   마지막 줄 JSON 요약은 항상 출력된다.
 * - flake 정책: 실패 시 1회 재실행, 2연속 실패만 FAIL.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'smoke-manifest.json'), 'utf8'));

// 포트 고정 — browser-e2e(5173)·dwg-e2e(8787)·config/backend.ts(DEV 8787) 등이 하드코딩.
const VITE_PORT = '5173';
const BACKEND_PORT = '8787';

class SkipInfra extends Error {} // 외부 백엔드가 요구 kind 미충족 — 스크립트 SKIP
class FailInfra extends Error {} // 인프라 기동 실패 — 스크립트 FAIL

// ---------- CLI ----------
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const strictBackend = has('--strict-backend');

if (has('--list')) {
  for (const s of manifest.scripts) {
    console.log(
      `${s.script.padEnd(28)} backend=${s.backend.padEnd(9)} ${s.optIn ? 'optIn ' : ''}tags=${s.tags.join(',')}`,
    );
  }
  for (const e of manifest.excluded) console.log(`${e.script.padEnd(28)} EXCLUDED — ${e.reason}`);
  process.exit(0);
}

let selected;
if (has('--all')) {
  selected = manifest.scripts.filter((s) => !s.optIn);
} else if (opt('--tags')) {
  const tags = opt('--tags').split(',').map((t) => t.trim()).filter(Boolean);
  selected = manifest.scripts.filter((s) => s.tags.some((t) => tags.includes(t)));
} else if (opt('--scripts')) {
  const names = opt('--scripts').split(',').map((t) => t.trim());
  selected = manifest.scripts.filter((s) => names.includes(s.script));
  const known = new Set(selected.map((s) => s.script));
  for (const n of names) if (!known.has(n)) console.warn(`WARN 매니페스트에 없음: ${n}`);
} else {
  console.error('사용법: --all | --tags a,b | --scripts x.mjs,y.mjs | --list [--strict-backend]');
  process.exit(2);
}
if (selected.length === 0) {
  console.error('선택된 스모크 없음');
  process.exit(2);
}

// ---------- 프로세스 정리 ----------
const spawned = []; // {name, proc} — 러너가 스폰한 vite/backend
const runningSmoke = new Set(); // 실행 중 스모크 자식 — 러너 강제종료 시 고아 방지

function killTree(proc, name) {
  if (!proc || proc.exitCode !== null) return;
  proc.killedByRunner = true; // 의도된 종료 — exit 핸들러 WARN 억제
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { stdio: 'ignore' });
      if (r.status !== 0) console.warn(`WARN ${name} taskkill 실패 status=${r.status}`);
    } else {
      proc.kill('SIGTERM');
    }
  } catch (e) {
    console.warn(`WARN ${name} 종료 실패: ${e.message}`);
  }
}

function cleanupAll() {
  for (const s of spawned.splice(0)) killTree(s.proc, s.name);
  for (const p of runningSmoke) killTree(p, 'smoke');
  runningSmoke.clear();
}
process.on('exit', cleanupAll);
process.on('SIGINT', () => {
  cleanupAll();
  process.exit(130);
});

// ---------- 서버 수명주기 ----------
async function alive(port) {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

async function waitAlive(port, name, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await alive(port)) return;
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new FailInfra(`${name}(:${port}) 기동 타임아웃 ${timeoutMs}ms`);
}

function spawnLogged(name, cmdLine, extraEnv = {}) {
  // 단일 커맨드 문자열 + shell — args 배열 + shell:true는 DEP0190(이스케이프 미적용) 경고.
  const proc = spawn(cmdLine, {
    cwd: repoRoot,
    shell: true,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const buf = [];
  const keep = (d) => {
    buf.push(String(d));
    if (buf.length > 200) buf.shift();
  };
  proc.stdout.on('data', keep);
  proc.stderr.on('data', keep);
  proc.on('exit', (code) => {
    // 그룹 중간 사망 시 스테일 상태로 죽은 서버에 계속 실패하지 않도록 상태 리셋.
    // 단 같은 이름의 새 프로세스가 이미 교체 기동됐으면(백엔드 스왑 레이스) 리셋하지 않는다.
    const idx = spawned.findIndex((s) => s.proc === proc);
    if (idx >= 0) {
      spawned.splice(idx, 1);
      const replaced = spawned.some((s) => s.name === name);
      if (name === 'vite' && !replaced) viteUp = false;
      if (name === 'backend' && !replaced) backendKind = null;
      if (code !== null && code !== 0 && !proc.killedByRunner) {
        console.warn(`WARN ${name} 조기 종료 code=${code}\n${buf.slice(-20).join('')}`);
      }
    }
  });
  spawned.push({ name, proc });
  return proc;
}

const infraFailed = new Set(); // 'vite' | 'node' | 'miniflare' — 기동 실패 인프라 재시도 방지

let viteUp = false;
async function ensureVite() {
  if (viteUp) return;
  if (infraFailed.has('vite')) throw new FailInfra('vite 기동 실패(이전 시도) — 스킵');
  if (await alive(VITE_PORT)) {
    console.log(`vite :${VITE_PORT} 재사용 (외부 기동)`);
  } else {
    console.log(`vite :${VITE_PORT} 스폰...`);
    spawnLogged('vite', `corepack pnpm -F @figcad/web dev --port ${VITE_PORT} --strictPort`);
    try {
      await waitAlive(VITE_PORT, 'vite', 90000);
    } catch (e) {
      infraFailed.add('vite');
      throw e;
    }
  }
  viteUp = true;
}

// 'node'|'miniflare'(러너 스폰) | 'external-node'|'external-miniflare'(외부) | null
let backendKind = null;

/** miniflare = node 상위집합(같은 WS 와이어 + ?op=/버전/AI 라우트) — node 요구는 둘 다 충족 */
function satisfies(kind, required) {
  if (required === 'node') return kind !== null;
  return kind === 'miniflare' || kind === 'external-miniflare';
}

/** 외부 8787 kind 판별 — miniflare 전용 라우트 프로브(dev-node=503·miniflare=200·GET이라 무부작용) */
async function probeExternalKind() {
  try {
    const r = await fetch(`http://localhost:${BACKEND_PORT}/parties/doc/__smoke-probe__?op=pull`, {
      signal: AbortSignal.timeout(3000),
    });
    return r.status === 200 ? 'external-miniflare' : 'external-node';
  } catch {
    return 'external-node';
  }
}

async function ensureBackend(required) {
  if (backendKind && satisfies(backendKind, required)) return;
  if (backendKind && backendKind.startsWith('external-')) {
    // 외부 프로세스는 우리가 교체할 수 없다
    throw new SkipInfra(
      `외부 :${BACKEND_PORT} 백엔드(${backendKind})가 ${required} 라우트 미지원 — 외부 서버 종료 후 재실행 필요`,
    );
  }
  if (infraFailed.has(required)) throw new FailInfra(`${required} 백엔드 기동 실패(이전 시도) — 스킵`);
  if (backendKind) {
    // 러너가 스폰한 다른 종류 백엔드 교체
    const idx = spawned.findIndex((s) => s.name === 'backend');
    if (idx >= 0) killTree(spawned[idx].proc, 'backend'); // exit 핸들러가 spawned 정리+상태 리셋
    backendKind = null;
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (await alive(BACKEND_PORT)) {
    backendKind = await probeExternalKind();
    console.log(`백엔드 :${BACKEND_PORT} 재사용 (외부 기동, 판별=${backendKind})`);
    if (satisfies(backendKind, required)) return;
    throw new SkipInfra(
      `외부 :${BACKEND_PORT} 백엔드(${backendKind})가 ${required} 라우트 미지원 — 외부 서버 종료 후 재실행 필요`,
    );
  }
  const entry = required === 'miniflare' ? 'apps/server/dev.mjs' : 'apps/server/dev-node.mjs';
  console.log(`백엔드(${required}) :${BACKEND_PORT} 스폰 — ${entry}`);
  spawnLogged('backend', `node ${entry}`);
  try {
    await waitAlive(BACKEND_PORT, `backend(${required})`, required === 'miniflare' ? 120000 : 30000);
  } catch (e) {
    infraFailed.add(required);
    throw e;
  }
  backendKind = required;
}

// ---------- 스크립트 실행 ----------
function runScript(entry) {
  const scriptPath = path.join(here, entry.script);
  const args = [scriptPath, VITE_PORT, ...(entry.extraArgs ?? []).map((a) => a.replace('{backendPort}', BACKEND_PORT))];
  const timeoutMs = entry.timeoutMs ?? 120000;
  return new Promise((resolve) => {
    const proc = spawn('node', args, {
      cwd: repoRoot, // 일부 스크립트(dwg-underlay·ref-interact)가 repo루트 상대경로로 스크린샷 기록
      shell: false,
      env: { ...process.env, PORT: VITE_PORT },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    runningSmoke.add(proc);
    const out = [];
    proc.stdout.on('data', (d) => out.push(String(d)));
    proc.stderr.on('data', (d) => out.push(String(d)));
    let forceTimer;
    const timer = setTimeout(() => {
      out.push(`\n[runner] 타임아웃 ${timeoutMs}ms — 킬`);
      killTree(proc, entry.script);
      // taskkill 실패(권한 등) 시 exit 이벤트가 영영 안 올 수 있음 — 강제 판정으로 러너 행 방지
      forceTimer = setTimeout(() => {
        runningSmoke.delete(proc);
        resolve({ code: 124, output: out.join('') + '\n[runner] 킬 후에도 미종료 — 강제 FAIL' });
      }, 8000);
    }, timeoutMs);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      runningSmoke.delete(proc);
      resolve({ code: code ?? 1, output: out.join('') });
    });
  });
}

const results = [];
async function execEntry(entry) {
  // 픽스처 확인
  for (const f of entry.fixtures ?? []) {
    if (!fs.existsSync(path.join(repoRoot, f))) {
      console.log(`SKIP  ${entry.script} — 픽스처 없음: ${f}`);
      results.push({ script: entry.script, status: 'SKIP', reason: `fixture ${f}` });
      return;
    }
  }
  // 인프라 준비 — 실패해도 러너는 계속(요약 JSON 계약 유지)
  try {
    if (entry.vite !== false) await ensureVite();
    if (entry.backend !== 'none') await ensureBackend(entry.backend);
  } catch (e) {
    const skip = e instanceof SkipInfra && !strictBackend;
    console.log(`${skip ? 'SKIP' : 'FAIL'}  ${entry.script} — ${e.message}`);
    results.push({ script: entry.script, status: skip ? 'SKIP' : 'FAIL', reason: e.message });
    return;
  }

  const t0 = Date.now();
  let attempt = 1;
  let r = await runScript(entry);
  if (r.code !== 0) {
    console.log(`RETRY ${entry.script} (1차 실패 code=${r.code} — flake 재시도)`);
    attempt = 2;
    r = await runScript(entry);
  }
  const ms = Date.now() - t0;
  if (r.code === 0) {
    console.log(`PASS  ${entry.script} ${(ms / 1000).toFixed(1)}s${attempt > 1 ? ' (flaky)' : ''}`);
    results.push({ script: entry.script, status: attempt > 1 ? 'FLAKY' : 'PASS', ms });
  } else {
    console.log(`FAIL  ${entry.script} ${(ms / 1000).toFixed(1)}s — 출력 tail:`);
    console.log(r.output.split('\n').slice(-25).join('\n'));
    results.push({ script: entry.script, status: 'FAIL', ms });
  }
}

// backend 요구 순서로 정렬: none/vite-only → node → miniflare (8787 교체 최소화)
const order = { none: 0, node: 1, miniflare: 2 };
selected.sort((a, b) => order[a.backend] - order[b.backend]);

console.log(`실행 대상 ${selected.length}종: ${selected.map((s) => s.script).join(', ')}`);
const tAll = Date.now();
for (const entry of selected) {
  try {
    await execEntry(entry);
  } catch (e) {
    // 예상 밖 러너 내부 오류 — 해당 스크립트 FAIL 기록 후 계속 (요약은 항상 출력)
    console.log(`FAIL  ${entry.script} — 러너 내부 오류: ${e.message}`);
    results.push({ script: entry.script, status: 'FAIL', reason: `runner: ${e.message}` });
  }
}

cleanupAll();
const summary = {
  pass: results.filter((r) => r.status === 'PASS').length,
  flaky: results.filter((r) => r.status === 'FLAKY').map((r) => r.script),
  fail: results.filter((r) => r.status === 'FAIL').map((r) => r.script),
  skip: results.filter((r) => r.status === 'SKIP').map((r) => r.script),
  totalMs: Date.now() - tAll,
};
console.log(JSON.stringify(summary));
process.exit(summary.fail.length > 0 ? 1 : 0);
