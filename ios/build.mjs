// 아이폰용 한 파일 빌드.
//
// 확장(extension/)의 엔진 모듈은 ESM 이라 그대로는 사파리 북마크로 못 쓴다.
// 여기서 모듈을 순서대로 **각자의 IIFE 로 감싸** 한 파일로 묶는다.
// 모듈마다 스코프가 분리되므로 파일끼리 같은 이름을 써도 안 부딪힌다.
//
//   node ios/build.mjs
//     -> ios/dist/classcard-ios.js    (사파리에서 실행할 한 파일)
//     -> ios/dist/bookmarklet.txt     (북마크 주소창에 넣을 javascript: 한 줄)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 의존 순서대로. (norm <- basic <- games <- grammar ...) */
const MODULES = [
  ['norm', 'extension/engine/norm.js'],
  ['similarity', 'extension/engine/similarity.js'],
  ['driver', 'extension/engine/driver.js'],
  ['basic', 'extension/engine/modules/basic.js'],
  ['games', 'extension/engine/modules/games.js'],
  ['sentence', 'extension/engine/modules/sentence.js'],
  ['grammar', 'extension/engine/modules/grammar.js'],
  ['autoall', 'extension/engine/modules/autoall.js'],
];

/** 파일 경로 -> 모듈 이름 (import 경로를 풀 때 쓴다) */
const BY_PATH = new Map([
  ['../norm.js', 'norm'],
  ['../similarity.js', 'similarity'],
  ['../driver.js', 'driver'],
  ['./basic.js', 'basic'],
  ['./games.js', 'games'],
  ['./sentence.js', 'sentence'],
  ['./grammar.js', 'grammar'],
  ['./autoall.js', 'autoall'],
]);

const IMPORT_RE = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm;
const EXPORT_DECL_RE =
  /^export\s+(?:async\s+function|function|class|const|let|var)\s+([A-Za-z0-9_$]+)/gm;

function buildModule(name, relPath) {
  const src = readFileSync(resolve(ROOT, relPath), 'utf8');

  // 1) import 를 걷어내고, 같은 뜻의 지역 선언으로 바꾼다
  const prelude = [];
  const body = src.replace(IMPORT_RE, (_all, clause, from) => {
    const dep = BY_PATH.get(from);
    if (!dep) throw new Error(`${relPath}: 모르는 import 경로 ${from}`);
    const ns = clause.match(/^\*\s+as\s+([A-Za-z0-9_$]+)$/);
    if (ns) {
      prelude.push(`const ${ns[1]} = __mod.${dep};`);
      return '';
    }
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named) {
      for (const raw of named[1].split(',')) {
        const t = raw.trim();
        if (!t) continue;
        const as = t.match(/^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/);
        if (as) prelude.push(`const ${as[2]} = __mod.${dep}.${as[1]};`);
        else prelude.push(`const ${t} = __mod.${dep}.${t};`);
      }
      return '';
    }
    throw new Error(`${relPath}: 다룰 수 없는 import 형태 ${clause}`);
  });

  // 2) export 이름을 모으고 keyword 만 떼어 낸다
  const names = [];
  let m;
  EXPORT_DECL_RE.lastIndex = 0;
  while ((m = EXPORT_DECL_RE.exec(body)) !== null) names.push(m[1]);
  if (!names.length) throw new Error(`${relPath}: export 를 찾지 못했습니다`);
  const stripped = body.replace(/^export\s+/gm, '');

  return [
    `// ======================================================== ${relPath}`,
    `__mod.${name} = (function () {`,
    prelude.map((l) => '  ' + l).join('\n'),
    stripped,
    `  return { ${[...new Set(names)].join(', ')} };`,
    `})();`,
    '',
  ].join('\n');
}

const parts = MODULES.map(([name, p]) => buildModule(name, p));
const shim = readFileSync(resolve(ROOT, 'ios/src/shim.js'), 'utf8');

const out = [
  '/* 클래스카드 자동화 — 아이폰(사파리)용 한 파일 빌드',
  ' * 원본: extension/engine/**  (ios/build.mjs 로 자동 생성 — 직접 고치지 마세요)',
  ' */',
  '(function () {',
  "'use strict';",
  'if (window.__ccIosLoaded) { window.__ccIosShow(); return; }',
  'window.__ccIosLoaded = true;',
  'var __mod = {};',
  ...parts,
  shim,
  '})();',
  '',
].join('\n');

mkdirSync(resolve(ROOT, 'ios/dist'), { recursive: true });
writeFileSync(resolve(ROOT, 'ios/dist/classcard-ios.js'), out);

// 북마클릿은 **불러오기만** 한다.
// 전체를 주소에 담으면 200KB 가 넘어 사파리 북마크에 넣을 수 없다.
// 사이트 CSP 는 Report-Only 라(2026-09 확인) 주입도 외부 fetch 도 막지 않는다.
const RAW =
  process.env.CC_IOS_URL ||
  'https://raw.githubusercontent.com/myzxit/Classcard-Automated-Macro-/' +
    'claude/android-mobile-version-1gj9t2/ios/dist/classcard-ios.js';

const loader = `(function(){
  if (window.__ccIosLoaded) { window.__ccIosShow(); return; }
  var u = ${JSON.stringify(RAW)} + '?t=' + Date.now();
  fetch(u).then(function(r){ return r.text(); }).then(function(t){
    var s = document.createElement('script');
    s.textContent = t;
    document.documentElement.appendChild(s);
    s.remove();
  }).catch(function(e){ alert('불러오지 못했습니다: ' + e); });
})()`.replace(/\n\s*/g, '');

const bookmarklet = 'javascript:' + encodeURIComponent(loader);
writeFileSync(resolve(ROOT, 'ios/dist/bookmarklet.txt'), bookmarklet + '\n');

// 인터넷 없이 쓰고 싶을 때를 위해 통짜 버전도 남겨 둔다(주소창엔 못 넣는다).
writeFileSync(
  resolve(ROOT, 'ios/dist/inline-snippet.js'),
  `var s=document.createElement('script');s.textContent=${JSON.stringify(out)};` +
    `document.documentElement.appendChild(s);s.remove();\n`,
);

console.log(`묶은 모듈 ${MODULES.length}개`);
console.log(`ios/dist/classcard-ios.js  ${(out.length / 1024).toFixed(1)} KB`);
console.log(`ios/dist/bookmarklet.txt   ${bookmarklet.length} 바이트 (불러오기용)`);
