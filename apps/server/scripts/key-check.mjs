/**
 * API 키 진단 — .anthropic-key.txt(한 줄)를 읽어 Anthropic에 직접 3종 호출.
 * 키는 절대 출력하지 않는다. 사용: node scripts/key-check.mjs
 *   1) GET /v1/models            — 인증 확인 (무료)
 *   2) POST /v1/messages haiku   — 추론 권한 확인 (~$0.0001)
 *   3) POST /v1/messages opus4.8 — 대상 모델 권한 확인 (~$0.001)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const key = readFileSync(path.join(here, '..', '.anthropic-key.txt'), 'utf8').trim();
if (key.length < 20) {
  console.error('키 파일이 비었거나 너무 짧음');
  process.exit(1);
}
console.log(`키 형식: ${key.slice(0, 14)}…(${key.length}자)`);

const headers = {
  'x-api-key': key,
  'anthropic-version': '2023-06-01',
  'content-type': 'application/json',
};

async function check(label, url, body) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const reqId = res.headers.get('request-id') ?? '-';
  let detail = '';
  if (!res.ok) {
    detail = ' ' + (await res.text()).slice(0, 200);
  } else if (body) {
    const j = await res.json();
    detail = ` (model=${j.model}, out=${j.usage?.output_tokens}tok)`;
  }
  console.log(`${label}: ${res.status}${detail}  [req ${reqId}]`);
}

await check('1 models  ', 'https://api.anthropic.com/v1/models');
await check('2 haiku   ', 'https://api.anthropic.com/v1/messages', {
  model: 'claude-haiku-4-5',
  max_tokens: 16,
  messages: [{ role: 'user', content: 'hi' }],
});
await check('3 opus4.8 ', 'https://api.anthropic.com/v1/messages', {
  model: 'claude-opus-4-8',
  max_tokens: 16,
  messages: [{ role: 'user', content: 'hi' }],
});
