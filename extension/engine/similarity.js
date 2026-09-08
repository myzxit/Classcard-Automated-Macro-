/**
 * 파이썬 `difflib.SequenceMatcher(None, a, b).ratio()` 이식.
 *
 * Test.py / Matching.py 의 `_ratio` 가 0.6 임계값으로 유사도 폴백을 판단하므로,
 * 값이 원본과 같아야 동작이 같아진다. difflib 과 동일하게
 * "재귀적 최장 일치 블록의 총 길이 M" 으로 `2M / (len(a)+len(b))` 를 계산한다.
 */

export function ratio(a, b) {
  if (!a || !b) return 0.0;
  const matches = matchCount(a, b, 0, a.length, 0, b.length);
  return (2.0 * matches) / (a.length + b.length);
}

/** difflib 의 get_matching_blocks 와 같은 재귀 분할로 일치 문자 수를 센다. */
function matchCount(a, b, alo, ahi, blo, bhi) {
  const [i, j, k] = findLongestMatch(a, b, alo, ahi, blo, bhi);
  if (k === 0) return 0;
  let total = k;
  if (alo < i && blo < j) total += matchCount(a, b, alo, i, blo, j);
  if (i + k < ahi && j + k < bhi) total += matchCount(a, b, i + k, ahi, j + k, bhi);
  return total;
}

/** difflib.SequenceMatcher.find_longest_match 이식. 반환: [i, j, size] */
function findLongestMatch(a, b, alo, ahi, blo, bhi) {
  const b2j = new Map();
  for (let idx = blo; idx < bhi; idx++) {
    const ch = b[idx];
    if (!b2j.has(ch)) b2j.set(ch, []);
    b2j.get(ch).push(idx);
  }

  let bestI = alo;
  let bestJ = blo;
  let bestSize = 0;
  let j2len = new Map();

  for (let i = alo; i < ahi; i++) {
    const newJ2Len = new Map();
    const positions = b2j.get(a[i]) || [];
    for (const j of positions) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) || 0) + 1;
      newJ2Len.set(j, k);
      if (k > bestSize) {
        bestI = i - k + 1;
        bestJ = j - k + 1;
        bestSize = k;
      }
    }
    j2len = newJ2Len;
  }

  return [bestI, bestJ, bestSize];
}
