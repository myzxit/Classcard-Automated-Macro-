/**
 * HtmlParser.py / Memorize.py / Recall.py / Spell.py 이식.
 * (파이썬 원본의 JS 스니펫과 CSS 셀렉터는 문자 그대로 재사용한다)
 */

import * as N from '../norm.js';

// ============================================================ HtmlParser.py

const STUDY_DATA_RE = /var\s+study_data\s*=\s*(\[[\s\S]*?\]);/;

/** 현재 페이지에서 카드 목록([{front, back}, ...])을 뽑는다. */
export async function getData(d) {
  const direct = await d.eval(
    "return (typeof study_data !== 'undefined' && study_data) ? study_data : null;",
  );
  if (Array.isArray(direct) && direct.length) {
    const cards = toCards(direct);
    if (cards.length) {
      d.log(`데이터 추출 완료! 총 ${cards.length}개 카드`);
      return cards;
    }
  }

  const html = await d.evalStringOrNull('return document.documentElement.outerHTML;');
  if (!html) {
    d.log('[!] 페이지 HTML을 읽지 못했습니다.', 'error');
    return null;
  }
  const match = STUDY_DATA_RE.exec(html);
  if (!match) {
    d.log('[!] study_data를 찾을 수 없습니다. 학습 페이지가 맞는지 확인하세요.', 'error');
    return null;
  }
  try {
    const cards = toCards(JSON.parse(match[1]));
    d.log(`데이터 추출 완료! 총 ${cards.length}개 카드`);
    return cards;
  } catch (e) {
    d.log(`[오류] JSON 파싱 실패: ${e.message}`, 'error');
    return null;
  }
}

function toCards(arr) {
  const out = [];
  for (const card of arr) {
    if (!card) continue;
    out.push({
      front: String(card.front || '').trim(),
      back: String(card.back || '').trim(),
    });
  }
  return out;
}

/** Spell.py 의 `dict_from_cards` — {back: front} 맵. */
export function dictFromCards(cards) {
  if (!cards || !cards.length) return null;
  const dict = new Map();
  for (const c of cards) dict.set(c.back, c.front);
  return dict;
}

// ============================================================ Memorize.py

/**
 * 완료 종료 판단: `.btn-study-end-repeat` visible / `.next-repeat-percent` >= 100 /
 * `#study_end.active` 중 하나.
 */
export async function checkStep2SuccessAndStop(d, stop) {
  const done = await d.evalBool(`
    var btns = document.querySelectorAll(".btn-study-end-repeat");
    for (var i = 0; i < btns.length; i++) {
        if (btns[i].offsetParent !== null) return true;
    }
    var ps = document.querySelectorAll(".next-repeat-percent");
    for (var i = 0; i < ps.length; i++) {
        if (ps[i].offsetParent !== null && parseInt(ps[i].textContent) >= 100) return true;
    }
    return document.querySelectorAll("#study_end.active").length > 0;`);
  if (!done) return false;
  await d.exec('var a = document.querySelectorAll("#study_end.active .study-header a"); if (a.length) a[0].click();');
  await d.exec('var a = document.querySelectorAll(".btn-top-menu a"); if (a.length) a[0].click();');
  await stop.sleep(500);
  await d.exec('var a = document.querySelectorAll(".close_o"); if (a.length) a[0].click();');
  stop.set();
  return true;
}

/** total 밀리초 동안 interval 간격으로 종료 체크하며 대기. */
export async function waitWithCheck(d, stop, total, interval = 200) {
  let elapsed = 0;
  while (elapsed < total) {
    const slice = Math.min(interval, total - elapsed);
    if (await stop.await(slice)) return true;
    elapsed += slice;
    if (await checkStep2SuccessAndStop(d, stop)) return true;
  }
  return false;
}

/** 현재 보이는 카드의 식별자(전환 감지용). data-idx 만 사용한다. */
async function getCardKey(d) {
  return d.evalStringOrNull(`
    var c = document.querySelector('.CardItem.current')
         || document.querySelector('.CardItem.active')
         || document.querySelector('.showing');
    if (!c) return null;
    return c.getAttribute('data-idx') || c.getAttribute('data-card-idx') || null;`);
}

async function waitChangeOrStop(d, stop, prevKey, total, interval = 200) {
  let elapsed = 0;
  while (elapsed < total) {
    const slice = Math.min(interval, total - elapsed);
    if (await stop.await(slice)) return true;
    elapsed += slice;
    if (await checkStep2SuccessAndStop(d, stop)) return true;
    const cur = await getCardKey(d);
    if (cur !== null && cur !== prevKey) return true;
  }
  return false;
}

/** Memorize.py — 단어 암기 자동화 */
export async function memorize(d, answerDict, stop) {
  d.log('[암기] 시작');
  try {
    while (!stop.isSet) {
      if (await checkStep2SuccessAndStop(d, stop)) break;

      const prev = await getCardKey(d);

      if (prev === null) {
        // 카드 식별 불가(페이지 구조 차이) -> 기존 타이머 방식
        await d.pressSpace();
        if (await waitWithCheck(d, stop, 600)) break;
        await d.pressShiftSpace();
        if (await waitWithCheck(d, stop, 1300)) break;
        continue;
      }

      // 카드가 실제로 넘어갈 때까지 SPACE -> SHIFT+SPACE 재시도 (씹힘 대비, 최대 8회)
      for (let i = 0; i < 8; i++) {
        await d.pressSpace();
        if (await waitChangeOrStop(d, stop, prev, 600)) break;
        await d.pressShiftSpace();
        if (await waitChangeOrStop(d, stop, prev, 1300)) break;
      }
      if (stop.isSet) break;
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[암기] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[암기] 종료');
  }
}

// ============================================================ Recall.py

/** `.card-cover.down` 이 사라지길 기다린 뒤 보이는 `.showing` 안의 `.answer` 클릭. */
async function clickAnswer(d, stop) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const covered = await d.evalBool(`
      var els = document.querySelectorAll('.card-cover.down');
      for (var i = 0; i < els.length; i++) {
          if (els[i].offsetParent !== null) return true;
      }
      return false;`);
    if (!covered) break;
    if (await stop.await(200)) return;
  }

  await d.evalBool(`
    var cards = document.querySelectorAll('.showing');
    for (var i = 0; i < cards.length; i++) {
        if (cards[i].offsetParent === null) continue;
        var t = cards[i].querySelector('.answer');
        if (t) { t.click(); return true; }
    }
    return false;`);
}

/** Recall.py — 단어 리콜 자동화 */
export async function recall(d, answerDict, stop) {
  d.log('[리콜] 시작');
  try {
    while (!stop.isSet) {
      if (await checkStep2SuccessAndStop(d, stop)) break;
      await clickAnswer(d, stop);
      if (await waitWithCheck(d, stop, 1500)) break;
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[리콜] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[리콜] 종료');
  }
}

// ============================================================ Spell.py

const INPUT_SELECTOR = 'input[name="input_answer"]';

/**
 * 제시어(prompt)에 해당하는 입력 정답.
 * 기본은 back(의미) -> front(단어). 단어 제시 모드 대비로 front -> back 역방향도 시도.
 */
export function findAnswer(answerDict, prompt) {
  const p = N.squeeze(prompt);
  for (const [back, front] of answerDict) {
    if (p === N.squeeze(back)) return front;
  }
  for (const [back, front] of answerDict) {
    if (p === N.squeeze(front)) return back;
  }
  return null;
}

async function getActiveCard(d) {
  const res = await d.eval(`
    var card = document.querySelector('.CardItem.current');
    if (!card) return null;
    var conts = card.querySelectorAll('.spell-answer .spell-content');
    var prompt = '';
    for (var i = 0; i < conts.length; i++) {
        var t = (conts[i].textContent || '').trim();
        if (t) { prompt = t; break; }
    }
    return {idx: card.getAttribute('data-idx'), prompt: prompt};`);
  if (!res) return { idx: null, prompt: '' };
  return { idx: res.idx ?? null, prompt: res.prompt || '' };
}

/** `#study_end.active` 또는 `.btn-study-end-repeat` 가 보이면 완료. */
async function spellCheckEnd(d, stop) {
  const done = await d.evalBool(`
    var btns = document.querySelectorAll(".btn-study-end-repeat");
    for (var i = 0; i < btns.length; i++) {
        if (btns[i].offsetParent !== null) return true;
    }
    return document.querySelectorAll("#study_end.active").length > 0;`);
  if (!done) return false;
  await d.exec('var a = document.querySelectorAll("#study_end.active .study-header a"); if (a.length) a[0].click();');
  await d.exec('var a = document.querySelectorAll(".btn-top-menu a"); if (a.length) a[0].click();');
  await stop.sleep(500);
  await d.exec('var a = document.querySelectorAll(".close_o"); if (a.length) a[0].click();');
  stop.set();
  return true;
}

async function fillActiveInput(d, text) {
  return d.evalBool(`
    function visibleInput(root) {
        var els = root.querySelectorAll(${JSON.stringify(INPUT_SELECTOR)});
        for (var i = 0; i < els.length; i++) {
            if (els[i].offsetParent !== null) return els[i];
        }
        return null;
    }
    var cur = document.querySelector('.CardItem.current');
    var el = cur ? visibleInput(cur) : null;
    if (!el) el = visibleInput(document);
    if (!el) return false;
    el.focus();
    var setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
    return true;`);
}

async function hasActiveInput(d) {
  return d.evalBool(`
    var els = document.querySelectorAll(${JSON.stringify(INPUT_SELECTOR)});
    for (var i = 0; i < els.length; i++) {
        if (els[i].offsetParent !== null) return true;
    }
    return false;`);
}

/** 'changed' | 'done' | 'stopped' | 'stuck' */
async function waitNextCard(d, stop, prevIdx, timeout = 2500) {
  let elapsed = 0;
  while (elapsed < timeout) {
    if (await stop.await(200)) return 'stopped';
    elapsed += 200;
    if (await spellCheckEnd(d, stop)) return 'done';
    const { idx } = await getActiveCard(d);
    if (idx !== null && idx !== prevIdx) return 'changed';
  }
  return 'stuck';
}

/** Spell.py — 스펠(타이핑) 자동화 */
export async function spell(d, answerDict, stop) {
  d.log('[스펠] 시작');

  if (!answerDict || answerDict.size === 0) {
    d.log('[스펠] 단어장이 없습니다. [단어장 가져오기]로 먼저 가져오세요.', 'error');
    return;
  }

  try {
    while (!stop.isSet) {
      if (await spellCheckEnd(d, stop)) break;

      const { idx, prompt } = await getActiveCard(d);
      if (!prompt) {
        if (await spellCheckEnd(d, stop)) break;
        if (await stop.await(400)) break;
        continue;
      }

      if (!(await hasActiveInput(d))) {
        if (await stop.await(300)) break;
        continue;
      }

      const answer = findAnswer(answerDict, prompt);
      if (answer !== null) {
        if (!(await fillActiveInput(d, answer))) {
          if (await stop.await(300)) break;
          continue;
        }
        if (await stop.await(100)) break;
        await d.pressEnter();
      } else {
        // 정답을 모르면 빈 입력으로 제출 -> 정답 표시 후 다음으로 (무한루프 방지)
        d.log(`[스펠] 매칭 실패(스킵): '${prompt}'`, 'warn');
        await fillActiveInput(d, '');
        await d.pressEnter();
      }

      const status = await waitNextCard(d, stop, idx, 2000);
      if (status === 'stopped' || status === 'done') break;
      if (status === 'stuck') {
        await d.blurActiveElement();
        await d.pressSpace();
        const again = await waitNextCard(d, stop, idx, 2000);
        if (again === 'stopped' || again === 'done') break;
      }
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[스펠] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[스펠] 종료');
  }
}
