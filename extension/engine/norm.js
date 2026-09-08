/**
 * 파이썬 모듈들에 흩어져 있던 정규화/토큰화 함수를 한곳에 모아 1:1 이식한 것.
 * (안드로이드판 core/Norm.kt 와 같은 내용 — 두 버전이 같은 결과를 내야 한다.)
 */

/** `unicodedata.normalize('NFKC', s)` */
export function nfkc(text) {
  if (!text) return '';
  return String(text).normalize('NFKC');
}

// Test.py / Matching.py 의 `_NON_MATCH`, Scramble.py 의 `_NON_KO`
const NON_MATCH = /[^가-힣a-zA-Z]/g;
// Scramble.py 의 `_NON_WORD`
const NON_WORD = /[^a-zA-Z0-9]/g;
// Matching.py / Scramble.py 의 `_TAG`
const TAG = /<[^>]+>/g;
// MemorizeSentence.py 의 제로폭 문자 + TestSentence.py 의 `_WS`
const WS_ZERO_WIDTH = /[\s​‌‍‎‏﻿]/g;
const ZERO_WIDTH = /[​‌‍‎‏﻿]/g;

/** `html.unescape` 의 실사용 범위 대응. */
function unescapeHtml(text) {
  if (!text.includes('&')) return text;
  let out = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  out = out.replace(/&#(x?)([0-9a-fA-F]+);/g, (m, hex, code) => {
    const n = parseInt(code, hex ? 16 : 10);
    return Number.isNaN(n) ? m : String.fromCodePoint(n);
  });
  return out;
}

/** Matching.py / Scramble.py 의 `_strip_tags` */
export function stripTags(text) {
  return unescapeHtml(String(text || '').replace(TAG, ' '));
}

/**
 * Test.py 의 `mnorm` — NFKC + 한글/영문만.
 * 주의: Test.py 는 HTML 태그를 제거하지 **않는다**(Matching.py 와 다른 점).
 */
export function mnorm(text) {
  return nfkc(text).replace(NON_MATCH, '');
}

/** Matching.py 의 `mnorm` — 태그 제거까지 한다. */
export function mnormHtml(text) {
  return nfkc(stripTags(text)).replace(NON_MATCH, '');
}

/** Scramble.py 의 `knorm` */
export function knorm(text) {
  return nfkc(stripTags(text)).replace(NON_MATCH, '');
}

/** Scramble.py 의 `wnorm` */
export function wnorm(word) {
  return nfkc(word).replace(NON_WORD, '').toLowerCase();
}

/** TestSentence.py 의 `norm_en` */
export function normEn(token) {
  return String(token || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** TestSentence.py 의 `normalize_kor` */
export function normalizeKor(text) {
  return nfkc(text).replace(WS_ZERO_WIDTH, '');
}

/** MemorizeSentence.py 의 `normalize_text` */
export function normalizeText(text) {
  return nfkc(text).replace(ZERO_WIDTH, '').split(/\s+/).filter(Boolean).join('');
}

/** TestSentence.py / RecallSentence.py 의 `strip_parens` (괄호만 제거) */
export function stripParensSimple(text) {
  return String(text || '').replace(/\([^)]*\)/g, '');
}

/** RecallSentence.py 의 `strip_parens` (괄호 제거 + 공백 정리) */
export function stripParens(text) {
  return String(text || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** RecallSentence.py 의 `_UNICODE_NORMALIZE` / `normalize_unicode` */
const UNICODE_MAP = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '–': '-', '—': '-', '−': '-',
  '…': '...',
};

export function normalizeUnicode(text) {
  let out = String(text);
  for (const [from, to] of Object.entries(UNICODE_MAP)) out = out.split(from).join(to);
  return out;
}

/** RecallSentence.py 의 `_wkey` */
export function wkey(token) {
  return normalizeUnicode(token).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Scramble.py 의 `_mnorm` — 구두점은 유지하고 따옴표/대시만 통일 */
export function scrambleNorm(s) {
  let out = nfkc(s);
  const map = {
    '’': "'", '‘': "'", '‚': "'",
    '“': '"', '”': '"',
    '–': '-', '—': '-', '−': '-',
  };
  for (const [from, to] of Object.entries(map)) out = out.split(from).join(to);
  return out.replace(/\s+/g, '').toLowerCase();
}

// ------------------------------------------------------------------ 토큰화

/** 파이썬 `re.split(r'(?<=\S)(?=\()', word)` 대응 */
function splitBeforeParen(word) {
  const parts = [];
  let start = 0;
  for (let i = 1; i < word.length; i++) {
    if (word[i] === '(' && !/\s/.test(word[i - 1])) {
      parts.push(word.slice(start, i));
      start = i;
    }
  }
  parts.push(word.slice(start));
  return parts;
}

/** RecallSentence.py 의 `tokenize` */
export function tokenize(text) {
  const tokens = [];
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    tokens.push(...splitBeforeParen(word).filter(Boolean));
  }
  return tokens;
}

/** 파이썬 `re.split(r"(...)", s)` 처럼 구분자를 결과에 남기는 분리 */
function splitKeepingDelimiters(text, delimiter) {
  const out = [];
  let last = 0;
  const re = new RegExp(delimiter.source, delimiter.flags.includes('g') ? delimiter.flags : delimiter.flags + 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(text.slice(last, m.index));
    out.push(m[0]);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  out.push(text.slice(last));
  return out;
}

/** RecallSentence.py 의 `tokenize_loose` */
export function tokenizeLoose(text) {
  const result = [];
  for (const t of tokenize(text)) {
    for (const piece of splitKeepingDelimiters(t, /[-–—'"]/g)) {
      if (!piece) continue;
      const m = /^(.+?)([,.!?;:]+)$/.exec(piece);
      if (m && /\w/.test(m[1])) {
        result.push(m[1]);
        result.push(m[2]);
      } else {
        result.push(piece);
      }
    }
  }
  return result;
}

/** MemorizeSentence.py / TestSentence.py 의 `parse_english_words` */
export function parseEnglishWords(sentence) {
  return String(sentence || '').match(/\([^)]*\)|\S+/g) || [];
}

/** RecallSentence.py 의 `is_prefix_punct_split` */
export function isPrefixPunctSplit(prefixTokens) {
  return prefixTokens.some((t) => isPunctOnly(t));
}

/** 단독 구두점/하이픈/따옴표 토큰인지 */
export function isPunctOnly(token) {
  return /^[,.!?;:\-–—'"]+$/.test(token);
}

/** Scramble.py 의 순수 문장부호 판별 `re.fullmatch(r'[^\w]+', tok)` */
export function isNonWordOnly(token) {
  return /^[^\w]+$/.test(token);
}

/** Scramble.py 의 `split_target_words` */
export function splitTargetWords(target) {
  const words = [];
  for (const w of String(target || '').split(/\s+/).filter(Boolean)) {
    const m = /^(.+?)([^\w]+)$/.exec(w);
    if (m) {
      words.push(m[1]);
      words.push(m[2]);
    } else {
      words.push(w);
    }
  }
  return words;
}

/** TestSentence.py 의 `_split_subtokens` */
export function splitSubtokens(token) {
  if (token.includes('(') && token.includes(')')) {
    const subs = [];
    for (const part of splitKeepingDelimiters(token, /\([^)]*\)/g)) {
      const cleaned = part.replace(/^[()]+|[()]+$/g, '');
      subs.push(...cleaned.split(/\s+/).filter(Boolean));
    }
    return subs;
  }
  if (/[-–—]/.test(token)) {
    return token.split(/[-–—]/).filter(Boolean);
  }
  return [];
}

/** MemorizeSentence.py 의 하이픈 분리 폴백 */
export function splitByDash(token) {
  return splitKeepingDelimiters(token, /[-–—]/g).filter(Boolean);
}

/** MemorizeSentence.py 의 괄호 분리 폴백 */
export function splitByParenGroup(token) {
  return splitKeepingDelimiters(token, /\([^)]*\)/g).filter(Boolean);
}

/** 공백 전부 제거 (`''.join(text.split())`) */
export function squeeze(text) {
  return String(text).split(/\s+/).filter(Boolean).join('');
}
