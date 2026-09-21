// 클래스카드 사이트 스크립트가 바뀌었는지 본다.
//
// 매크로의 셀렉터·순서는 전부 이 스크립트들에서 확인한 규칙이다. 파일이 바뀌면 규칙도 바뀌었을 수 있으므로
// 자동 점검(Routine)이 이걸 먼저 돌려 '무엇이 바뀌었는지'를 알고 그 부분을 다시 본다.
//
//   node tools/verify/site_scripts.mjs            # 비교만 (바뀐 게 있으면 exit 2)
//   node tools/verify/site_scripts.mjs --update   # 지금 상태를 기준(site-hashes.json)으로 저장
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(HERE, 'site-hashes.json');
const SNAP = resolve(HERE, 'site-snapshots');
const BASE = 'https://www.classcard.net';

/** 매크로가 규칙을 읽어 온 스크립트들 (모듈 상단 주석의 출처와 같다) */
const SCRIPTS = [
  '/scripts/v2/gclass_test.js',       // 문법 문제 화면 (연습·서술형·실전·누적오답)
  '/scripts/v2/grammar_talk.js',      // 개념 톡
  '/scripts/v3/gclass_main_std.js',   // 문법 클래스 페이지 (다음 유닛 이동 등)
  '/scripts/v2/recall.js',
  '/scripts/v2/memorize.js',
  '/scripts/v2/spell.js',
  '/scripts/v2/match.js',
  '/scripts/v2/recall_sentence.js',
];

function fetchText(url) {
  // 이 환경은 브라우저가 프록시를 못 타서 curl 로 받는다 (curl 은 프록시를 탄다)
  return execFileSync('curl', ['-sSL', '--max-time', '40', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0', url],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
}

const update = process.argv.includes('--update');
const oldFile = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
const old = oldFile.scripts || {};
const now = {};
const changed = [];
mkdirSync(SNAP, { recursive: true });
for (const path of SCRIPTS) {
  let text = '';
  try { text = fetchText(BASE + path); } catch (e) { console.log(`받기 실패: ${path} (${String(e.message).slice(0, 60)})`); continue; }
  if (!text || text.length < 200 || /<html/i.test(text.slice(0, 200))) { console.log(`내용이 이상함: ${path} (${text.length} bytes)`); continue; }
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  now[path] = { hash, bytes: text.length };
  const before = old[path];
  if (before && before.hash !== hash) changed.push(`${path}: ${before.bytes} -> ${text.length} bytes`);
  if (!before) changed.push(`${path}: 처음 봄 (${text.length} bytes)`);
  if (update) writeFileSync(resolve(SNAP, path.split('/').pop()), text);
}
if (update) {
  writeFileSync(FILE, JSON.stringify({ checkedAt: new Date().toISOString(), scripts: now }, null, 2) + '\n');
  console.log(`기준 저장: ${Object.keys(now).length}개 스크립트 -> ${FILE}`);
} else if (changed.length) {
  console.log('바뀐 사이트 스크립트:\n  ' + changed.join('\n  '));
  console.log('-> 해당 화면의 규칙을 다시 확인하고, 확인이 끝나면 --update 로 기준을 갱신하세요.');
  process.exit(2);
} else {
  console.log(`사이트 스크립트 변화 없음 (${Object.keys(now).length}개, 기준 ${oldFile.checkedAt || '?'})`);
}
