/**
 * 에이전트 라이브 스모크 — 실 Claude 호출로 /api/agent 계획 루프의 의미 불변식을 검증.
 * 브라우저 불필요(헤드리스): @figcad/core를 esbuild로 즉석 번들해 인프로세스 DocStore로
 * 스냅샷 생성 + opLog 재생(applyOpLog) 검증. SSE 파싱은 sketch-live-e2e.mjs 패턴.
 *
 * 키 없으면(서버 503) 깨끗이 SKIP + exit 0 — CI/키리스 환경에서 안전.
 *
 * 사용: node apps/web/scripts/agent-live-smoke.mjs
 *   AGENT_URL   기본 http://localhost:8787/api/agent (배포 검증 시 override, ?key= 포함 가능)
 *   AGENT_MODEL 기본 claude-haiku-4-5-20251001 ('빠름' 티어 — 토큰 비용 최소. allowlist 내 id만)
 *
 * 시나리오 (각 1회 자동 재시도, 좌표 등 정확값은 단언하지 않음 — 의미 불변식만):
 *   A. 기둥 그리드+보+슬라브 생성 → 재생 후 기둥≥6·보≥1·슬라브≥1, failed=0, critic error 0
 *   B. 후속 턴 "모든 기둥을 400x400" → 재생 후 모든 기둥 타입 단면 rect 400×400, failed=0
 *   C. imports 매니페스트 + "연동 모델에 뭐가 있어?" → 텍스트가 소스/오브젝트명 언급, opLog 비어있음
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..');
const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:8787/api/agent';
const MODEL = process.env.AGENT_MODEL ?? 'claude-haiku-4-5-20251001';
const SCENARIO_TIMEOUT_MS = 300_000;

// ---------------------------------------------------------------------------
// 프리플라이트 — 키 없으면 서버가 body 파싱 전에 503을 준다(agent.ts). 최소 body로 판별.
// 503+키 문구 = SKIP(exit 0). 그 외(400 = body 검증까지 도달 = 키 존재)면 본 시나리오 진행.
// ---------------------------------------------------------------------------
let pre;
try {
  pre = await fetch(AGENT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  });
} catch (e) {
  console.error(`FAIL  프리플라이트 — ${AGENT_URL} 접속 불가 (${e.message}). 백엔드(:8787)가 떠 있는지 확인.`);
  process.exit(1);
}
if (pre.status === 503) {
  const body = await pre.text().catch(() => '');
  if (body.includes('ANTHROPIC_API_KEY') || body.includes('AI 모드 미설정')) {
    console.log('SKIP agent-live: ANTHROPIC_API_KEY 없음 (키 설정 후 재실행)');
    process.exit(0);
  }
  console.error(`FAIL  프리플라이트 — 예상 밖 503 body: ${body.slice(0, 200)}`);
  process.exit(1);
}
if (pre.status === 401) {
  console.error('FAIL  프리플라이트 — 401 invalid key. AGENT_URL에 ?key=<ROOM_KEY>를 붙여 재실행.');
  process.exit(1);
}
// 400(body 검증) 또는 200 = 키 존재 → 라이브 시나리오 진행
console.log(`프리플라이트: 키 감지 (HTTP ${pre.status}) — 라이브 시나리오 시작 (model=${MODEL})`);
await pre.text().catch(() => {}); // 소켓 정리

// ---------------------------------------------------------------------------
// @figcad/core 인프로세스 로드 — core는 TS 소스 export(exports: ./src/index.ts)라
// esbuild(apps/web/node_modules/.bin, vite 경유 항상 존재)로 즉석 셀프컨테인드 번들.
// ---------------------------------------------------------------------------
function loadCore() {
  const outDir = join(tmpdir(), 'figcad-agent-smoke');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `core-bundle-${Date.now()}.mjs`); // 매 실행 신선 번들(소스 변경 반영)
  const bin = join(REPO_ROOT, 'apps', 'web', 'node_modules', '.bin',
    process.platform === 'win32' ? 'esbuild.CMD' : 'esbuild');
  const entry = join(REPO_ROOT, 'packages', 'core', 'src', 'index.ts');
  const r = spawnSync(
    `"${bin}" "${entry}" --bundle --format=esm --platform=node --log-level=warning --outfile="${outFile}"`,
    { shell: true, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`esbuild core 번들 실패: ${r.stderr || r.stdout}`);
  return import(pathToFileURL(outFile).href);
}
const core = await loadCore();
const { DocStore, seedDocument, applyOpLog } = core;

// ---------------------------------------------------------------------------
// SSE POST — sketch-live-e2e.mjs 파싱 패턴. error 이벤트는 수집(시나리오 FAIL 판정용).
// ---------------------------------------------------------------------------
async function postAgent(body) {
  const res = await fetch(AGENT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, model: MODEL }),
    signal: AbortSignal.timeout(SCENARIO_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) throw new Error(`/api/agent HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const out = { text: '', ops: [], lintRounds: 0, done: null, errors: [] };
  const handle = (line) => {
    if (!line.startsWith('data: ')) return;
    const ev = JSON.parse(line.slice(6));
    if (ev.type === 'text') out.text += ev.text;
    else if (ev.type === 'op') out.ops.push(ev.summary || ev.op);
    else if (ev.type === 'lint') out.lintRounds = Math.max(out.lintRounds, ev.round ?? 0);
    else if (ev.type === 'done') out.done = ev;
    else if (ev.type === 'error') out.errors.push(String(ev.error ?? 'agent error'));
  };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
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
  return out;
}

// ---------------------------------------------------------------------------
// 단언 헬퍼 — 의미 불변식만 (좌표·정확값 금지). 실패 = throw → 재시도 1회.
// ---------------------------------------------------------------------------
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
function assertClean(r, name) {
  assert(r.errors.length === 0, `${name}: SSE error 이벤트 — ${r.errors.join(' | ')}`);
  assert(r.done, `${name}: done 이벤트 없이 스트림 종료`);
  assert(Array.isArray(r.done.opLog), `${name}: done.opLog 배열 아님`);
}
/** opLog를 스냅샷 기반 새 스토어에 재생 — failed 0 단언 후 스토어 반환 */
function replay(snapshot, opLog, name) {
  const store = DocStore.fromSnapshot(snapshot);
  const result = applyOpLog(store, opLog);
  assert(
    result.failed.length === 0,
    `${name}: 재생 실패 ${result.failed.length}건 — ${result.failed
      .map((f) => `${f.entry.op}: ${f.error}`)
      .join(' | ')
      .slice(0, 300)}`,
  );
  return store;
}
const countKind = (store, kind) => store.listElements().filter((e) => e.kind === kind).length;

async function runScenario(name, fn) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await fn();
      console.log(`PASS  ${name}`);
      return;
    } catch (e) {
      if (attempt === 1) console.log(`RETRY ${name} — 1차 실패: ${e.message.slice(0, 200)}`);
      else {
        console.error(`FAIL  ${name} — ${e.message}`);
        process.exitCode = 1;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 시나리오 A — 기둥 그리드 + 보 + 슬라브. 시나리오 B가 A의 결과 위에서 이어간다.
// ---------------------------------------------------------------------------
const PROMPT_A = '6m 간격 3×2 기둥 그리드와 그 위 연결 보, 바닥 슬라브 만들어';
let stateAfterA = null; // { snapshot, transcript } — B로 전달

await runScenario('A. 그리드+보+슬라브 생성 (기둥≥6·보≥1·슬라브≥1·failed=0·critic error=0)', async () => {
  const seedStore = new DocStore();
  seedDocument(seedStore);
  const snapshot = seedStore.snapshot();
  const transcript = [{ role: 'user', text: PROMPT_A }];
  const r = await postAgent({ snapshot, transcript });
  assertClean(r, 'A');
  assert(r.done.opLog.length > 0, 'A: opLog 비어있음 (계획 없음)');

  const store = replay(snapshot, r.done.opLog, 'A');
  const cols = countKind(store, 'column');
  const beams = countKind(store, 'beam');
  const slabs = countKind(store, 'slab');
  assert(cols >= 6, `A: 기둥 ${cols}개 (≥6 기대 — 3×2 그리드)`);
  assert(beams >= 1, `A: 보 ${beams}개 (≥1 기대)`);
  assert(slabs >= 1, `A: 슬라브 ${slabs}개 (≥1 기대)`);

  // critic — 라운드 상한(서버 MAX_CRITIC_ROUNDS=2) 내에서 error가 해소됐는지
  assert(r.lintRounds <= 2, `A: critic 라운드 ${r.lintRounds} (≤2 기대)`);
  const lintErrors = (r.done.lintFindings ?? []).filter((f) => f.severity === 'error');
  assert(lintErrors.length === 0, `A: 미해결 lint error ${lintErrors.length}건 — ${lintErrors.map((f) => f.code).join(',')}`);

  console.log(`      기둥 ${cols} · 보 ${beams} · 슬라브 ${slabs} · op ${r.done.opLog.length} · critic ${r.lintRounds}라운드`);
  stateAfterA = {
    snapshot: store.snapshot(),
    transcript: [...transcript, { role: 'assistant', text: r.text.trim() || '완료' }],
  };
});

// ---------------------------------------------------------------------------
// 시나리오 B — 후속 턴: 모든 기둥 400×400. 최종 상태 단언(모델이 create_type+update_element든
// update_element 직접이든 경로 무관 — 이미 400×400이면 무변경 no-op도 정답으로 허용).
// ---------------------------------------------------------------------------
await runScenario('B. 후속 "모든 기둥을 400x400으로 바꿔" (전 기둥 단면 rect 400×400·failed=0)', async () => {
  assert(stateAfterA, 'B: 시나리오 A 실패로 스킵 불가 — 선행 상태 없음');
  const { snapshot, transcript } = stateAfterA;
  const r = await postAgent({
    snapshot,
    transcript: [...transcript, { role: 'user', text: '모든 기둥을 400x400으로 바꿔' }],
  });
  assertClean(r, 'B');

  const store = replay(snapshot, r.done.opLog, 'B');
  const types = new Map(store.listTypes().map((t) => [t.id, t]));
  const cols = store.listElements().filter((e) => e.kind === 'column');
  assert(cols.length > 0, 'B: 기둥 없음 (A 상태 유실?)');
  const bad = cols.filter((c) => {
    const sec = types.get(c.typeId)?.section;
    return !(sec && sec.shape === 'rect' && sec.width === 400 && sec.depth === 400);
  });
  assert(bad.length === 0, `B: 400×400 아닌 기둥 ${bad.length}/${cols.length}개`);
  console.log(
    `      기둥 ${cols.length}개 전부 rect 400×400 · op ${r.done.opLog.length}${
      r.done.opLog.length === 0 ? ' (이미 400×400 — no-op 정답 허용)' : ''
    }`,
  );
});

// ---------------------------------------------------------------------------
// 시나리오 C — imports 매니페스트(읽기전용 연동 모델) 인지. 형태 = importsManifest.ts
// ImportsManifest (sourceType은 FederationSourceSchema enum — '3dm' 등).
// ---------------------------------------------------------------------------
await runScenario('C. 연동 모델 인지 ("뭐가 있어?" → 이름 언급·mutation 0)', async () => {
  const seedStore = new DocStore();
  seedDocument(seedStore);
  const snapshot = seedStore.snapshot();
  const imports = {
    sources: [
      {
        id: 'fed-smoke-1',
        name: '구조동 라이노 모델',
        sourceType: '3dm',
        status: 'ready',
        visible: true,
        bboxMm: { x: [0, 12000], y: [0, 8000], elev: [0, 3500] },
        objectCount: 2,
        objects: [
          { name: '기둥-C1', category: '구조', count: 6 },
          { name: '외벽패널-P1', count: 12 },
        ],
      },
    ],
  };
  const r = await postAgent({
    snapshot,
    transcript: [{ role: 'user', text: '연동 모델에 뭐가 있어?' }],
    imports,
  });
  assertClean(r, 'C');

  const text = r.text;
  const mentionsSource = text.includes('구조동') || text.includes('라이노') || /3dm/i.test(text);
  const mentionsObject = text.includes('기둥-C1') || text.includes('외벽패널-P1') || text.includes('외벽패널');
  assert(mentionsSource, `C: 응답이 소스명 미언급 — "${text.trim().slice(0, 160)}"`);
  assert(mentionsObject, `C: 응답이 오브젝트명 미언급 — "${text.trim().slice(0, 160)}"`);
  // 읽기 질문에 mutation 환각 금지 — 서버 opLog는 mutating op만 기록하므로 0이어야 한다
  assert(r.done.opLog.length === 0, `C: 읽기 질문인데 mutation ${r.done.opLog.length}건 — ${r.ops.join(' | ').slice(0, 200)}`);
  console.log(`      텍스트 ${text.trim().length}자 · 소스/오브젝트 언급 OK · mutation 0`);
});

if (process.exitCode) {
  console.error('\n에이전트 라이브 스모크 실패');
} else {
  console.log('\n에이전트 라이브 스모크 통과');
}
