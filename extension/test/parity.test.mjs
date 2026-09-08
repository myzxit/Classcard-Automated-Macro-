/**
 * 이식 정확성 회귀 테스트 (확장프로그램판).
 *
 * `reference.json` 은 **원본 파이썬 구현을 그대로 실행해서** 만든 기준값이다
 * (생성기: android/tools/gen_reference.py — 안드로이드판과 같은 파일을 쓴다).
 * 같은 입력을 JS 이식본에 넣어 출력이 한 글자도 다르지 않은지 확인한다.
 *
 * 실행:  node extension/test/parity.test.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as N from '../engine/norm.js';
import { ratio } from '../engine/similarity.js';
import { findAnswer } from '../engine/modules/basic.js';
import {
  findSubsequenceEnd,
  findMatchingSentences,
  findSentenceByCandidates,
} from '../engine/modules/sentence.js';
import {
  buildLookups, solve, buildMaps, matchEnglish,
  findPair, alignIndex, findNextIndex, planWrongIndices,
} from '../engine/modules/games.js';

const here = dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(
  readFileSync(join(here, '../../android/app/src/test/resources/reference.json'), 'utf8'),
);

let passed = 0;
let failed = 0;

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL ${label}\n       기대: ${e}\n       실제: ${a}`);
  }
}

function group(name, fn) {
  console.log(`\n== ${name}`);
  const before = failed;
  fn();
  console.log(before === failed ? '   전부 일치' : '   불일치 있음');
}

// ------------------------------------------------------------------ 정규화

group('정규화', () => {
  for (const [input, expected] of ref.mnorm) eq(`mnorm('${input}')`, N.mnorm(input), expected);
  for (const [input, expected] of ref.matching_mnorm) eq(`mnormHtml('${input}')`, N.mnormHtml(input), expected);
  for (const [i, e] of ref.knorm) eq(`knorm('${i}')`, N.knorm(i), e);
  for (const [i, e] of ref.wnorm) eq(`wnorm('${i}')`, N.wnorm(i), e);
  for (const [i, e] of ref.norm_en) eq(`normEn('${i}')`, N.normEn(i), e);
  for (const [i, e] of ref.normalize_kor) eq(`normalizeKor('${i}')`, N.normalizeKor(i), e);
  for (const [i, e] of ref.normalize_text) eq(`normalizeText('${i}')`, N.normalizeText(i), e);
  for (const [i, e] of ref.strip_parens_simple) eq(`stripParensSimple('${i}')`, N.stripParensSimple(i), e);
  for (const [i, e] of ref.strip_parens) eq(`stripParens('${i}')`, N.stripParens(i), e);
  for (const [i, e] of ref.normalize_unicode) eq(`normalizeUnicode('${i}')`, N.normalizeUnicode(i), e);
  for (const [i, e] of ref.wkey) eq(`wkey('${i}')`, N.wkey(i), e);
  for (const [i, e] of ref.scramble_mnorm) eq(`scrambleNorm('${i}')`, N.scrambleNorm(i), e);
});

// ------------------------------------------------------------------ 토큰화

group('토큰화', () => {
  for (const [i, e] of ref.tokenize) eq(`tokenize('${i}')`, N.tokenize(i), e);
  for (const [i, e] of ref.tokenize_loose) eq(`tokenizeLoose('${i}')`, N.tokenizeLoose(i), e);
  for (const [i, e] of ref.parse_english_words) eq(`parseEnglishWords('${i}')`, N.parseEnglishWords(i), e);
  for (const [i, e] of ref.split_target_words) eq(`splitTargetWords('${i}')`, N.splitTargetWords(i), e);
  for (const [i, e] of ref.split_subtokens) eq(`splitSubtokens('${i}')`, N.splitSubtokens(i), e);
});

// ------------------------------------------------------------------ difflib

group('difflib ratio', () => {
  for (const [a, b, expected] of ref.ratio) {
    const actual = ratio(a, b);
    if (Math.abs(actual - expected) < 1e-12) passed++;
    else {
      failed++;
      console.error(`  FAIL ratio('${a}','${b}') 기대 ${expected} 실제 ${actual}`);
    }
  }
});

// ------------------------------------------------------------------ 스크램블

group('스크램블 정렬/다음 단어', () => {
  for (const c of ref.scramble) {
    const words = N.splitTargetWords(c.target);
    eq(`splitTargetWords('${c.target}')`, words, c.words);
    eq(`alignIndex('${c.target}')`, alignIndex(words, c.placed), c.align);
    const [idx, need] = findNextIndex(words, c.placed, c.cands);
    eq(`findNextIndex idx ('${c.target}')`, idx, c.idx);
    eq(`findNextIndex need ('${c.target}')`, need, c.need);
  }
});

// ------------------------------------------------------------------ 문장 리콜

const SENTENCES = [
  'I can live without it.',
  'I can live with it.',
  'She went to the park yesterday.',
  'He is a well-known writer.',
];

group('문장 리콜 매칭', () => {
  for (const c of ref.recall_matching) {
    eq(
      `findMatchingSentences(${JSON.stringify(c.prefix)})`,
      findMatchingSentences(c.prefix, SENTENCES, N.tokenize),
      c.matches,
    );
    SENTENCES.forEach((s, i) => {
      eq(
        `findSubsequenceEnd(${JSON.stringify(c.prefix)}, '${s}')`,
        findSubsequenceEnd(c.prefix, N.tokenize(s)),
        c.subseq[i],
      );
    });
    eq(`isPrefixPunctSplit(${JSON.stringify(c.prefix)})`, N.isPrefixPunctSplit(c.prefix), c.punct_split);
  }
  for (const c of ref.recall_by_candidates) {
    eq(
      `findSentenceByCandidates(${JSON.stringify(c.cands)})`,
      findSentenceByCandidates(c.cands, SENTENCES, N.tokenize),
      c.result,
    );
  }
});

// ------------------------------------------------------------------ 스펠 / 문장 테스트

group('스펠 · 문장 테스트', () => {
  const spellDict = new Map([
    ['사과', 'apple'],
    ['달리다', 'run'],
    ['1. 켜다 2. 자극하다', 'turn on'],
  ]);
  for (const [prompt, expected] of ref.spell_find_answer) {
    eq(`findAnswer('${prompt}')`, findAnswer(spellDict, prompt), expected);
  }

  const tsDict = new Map([
    ['나는 그것 없이 살 수 있다.', 'I can live without it.'],
    ['그녀는 (어제) 공원에 갔다.', 'She went to the park yesterday.'],
  ]);
  const maps = buildMaps(tsDict);
  for (const [prompt, expected] of ref.test_sentence_match) {
    eq(`matchEnglish('${prompt}')`, matchEnglish(prompt, maps), expected);
  }
});

// ------------------------------------------------------------------ 단어 테스트 / 매칭

group('단어 테스트 · 매칭', () => {
  const testDict = new Map([
    ['사과', 'apple'],
    ['달리다', 'run'],
    ['1. 끌어서 떼어내다, 제거하다', 'pull off'],
  ]);
  const lk = buildLookups(testDict);
  for (const c of ref.test_solve) {
    const options = c.options.map(([num, raw]) => ({ num, raw, norm: N.mnorm(raw) }));
    const [num, answer] = solve(c.prompt, options, lk);
    eq(`solve('${c.prompt}') num`, num, c.num);
    eq(`solve('${c.prompt}') answer`, answer, c.answer);
  }

  const cards = [
    ['apple', '사과'],
    ['run', '달리다'],
    ['pull off', '1. 끌어서 떼어내다, 제거하다'],
  ];
  const fwd = new Map();
  const bwd = new Map();
  for (const [front, back] of cards) {
    fwd.set(N.mnormHtml(front), back);
    bwd.set(N.mnormHtml(back), front);
  }
  const expected = ref.matching_pair;
  const lefts = expected.left.map((t, i) => ({ index: i, raw: t, norm: N.mnormHtml(t) }));
  const rights = expected.right.map((t, i) => ({ index: i, raw: t, norm: N.mnormHtml(t) }));
  const pair = findPair(lefts, rights, { fwd, bwd });
  eq('findPair li', pair.li, expected.li);
  eq('findPair ri', pair.ri, expected.ri);
  eq('findPair lraw', pair.lraw, expected.lraw);
  eq('findPair rraw', pair.rraw, expected.rraw);
});

// ------------------------------------------------------------------ 오답 주입

group('의도적 오답 개수', () => {
  for (const [total, target, expectedCount] of ref.plan_wrong_counts) {
    const planned = planWrongIndices(total, target);
    eq(`planWrongIndices(${total}, ${target}) 개수`, planned.size, expectedCount);
    for (const idx of planned) {
      if (idx < 1 || idx > total) {
        failed++;
        console.error(`  FAIL 순번 ${idx} 이 1..${total} 범위를 벗어남`);
      } else passed++;
    }
    if (total > 0) {
      const score = ((total - planned.size) * 100) / total;
      if (score >= target) passed++;
      else {
        failed++;
        console.error(`  FAIL 총 ${total} 문항에서 점수 ${score} 가 목표 ${target} 미만`);
      }
    }
  }
});

console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
process.exit(failed ? 1 : 0);
