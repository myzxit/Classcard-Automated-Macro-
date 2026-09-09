/**
 * AutoAll.py 이식 — 단어장 전체 자동화 / 한 세트 자동화.
 *
 * 페이지 이동이 잦지만 이 코드는 백그라운드(서비스 워커)에서 돌기 때문에
 * 탭이 이동해도 상태가 살아 있다. (콘텐츠 스크립트에 넣으면 안 되는 이유)
 */

import { StopFlag } from '../driver.js';
import * as Basic from './basic.js';
import * as Sentence from './sentence.js';
import * as Games from './games.js';

const SET_ITEM_SELECTOR = '.set-item';
const SET_NAME_LINK_SELECTOR = '.set-item a.set-name-a';
const MEMORIZE_BTN_SELECTOR = '.btn-summary[onclick*="/Memorize/"]';
const RECALL_BTN_SELECTOR = '.btn-summary[onclick*="/Recall/"]';
const MATCH_BTN_SELECTOR = '.btn-summary[onclick*="/Match/"]';
const SPELL_BTN_SELECTOR = '.btn-summary[onclick*="/Spell/"]';
const TEST_BTN_SELECTOR = '.btn-start-speedquiz';

const TEST_NEXT_BTN_SELECTOR = '.btn-condition-next';
const TEST_START_BTN_SELECTOR = '.btn-quiz-start';
const TEST_OK_BTN_SELECTOR = '.modal-content .btn-ok';
const VIEW_TYPE_TOGGLE_SELECTOR = 'a[data-toggle="dropdown"] .str_view_type';
const START_LEARNING_BTN_SELECTOR = '.btn-opt-start';
const FULL_CARDS_DATA_IDX = '6';
const FULL_CARDS_LABEL = '전체 카드 학습';

/** 완료로 간주하는 기준 점수 — 원본 상수 그대로. */
export const PASS = {
  test: 90,          // TEST_PASS_SCORE
  sentenceTest: 90,  // SENTENCE_TEST_PASS_SCORE
  // 목표 점수(8500)보다 낮게 두어, 7000 이상 받아 둔 set 은 다시 돌리지 않는다.
  match: 7000,       // 단어 매칭 완료 기준
  scramble: 7000,    // 문장 스크램블 완료 기준
};

export function isSentenceSet(setName) {
  return String(setName || '').trim().endsWith('(예문)');
}

/** 매칭/스크램블 버튼 텍스트로 문장 set 판별 (이름의 '(예문)' 보다 확실). */
async function isSentenceSetDetail(d) {
  return d.evalBool(`
    var btn = document.querySelector(${JSON.stringify(MATCH_BTN_SELECTOR)});
    if (!btn) return false;
    return (btn.textContent || '').indexOf('스크램블') >= 0;`);
}

async function getSetItems(d) {
  const arr = await d.eval(`
    var anchors = document.querySelectorAll(${JSON.stringify(SET_NAME_LINK_SELECTOR)});
    var out = [];
    for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        var n = a.firstChild;
        var name = (n ? (n.textContent || '') : '').trim();
        if (!name) name = ((a.textContent || '').split('\\n')[0] || '').trim();
        var si = a.closest('.set-item');
        var sentence = si ? !!si.querySelector('.set-icon.sentence') : false;
        out.push({ idx: a.getAttribute('data-idx'), name: name, sentence: sentence });
    }
    return out;`);
  return Array.isArray(arr) ? arr.filter((s) => s && s.idx) : [];
}

const waitForSetDetail = (d, t, stop) => d.waitForSelector('.btn-summary', t, stop);
const waitForSetList = (d, t, stop) => d.waitForSelector(SET_ITEM_SELECTOR, t, stop);
const waitForTestPage = (d, t, stop) => d.waitForSelector('.flip-card', t, stop);

/** '진행 중인 테스트' 확인 모달(응시 -> 새로 시작)을 최대 3번까지 눌러 준다. */
async function handleTestRestartModals(d, stop, maxClicks = 3, appearTimeoutMs = 2500) {
  for (let i = 0; i < maxClicks; i++) {
    if (!(await d.waitForVisible(TEST_OK_BTN_SELECTOR, appearTimeoutMs, stop))) break;
    if (stop.isSet) return;
    await d.clickFirstVisible(TEST_OK_BTN_SELECTOR);
    d.log('[전체] 테스트 확인 모달 처리 (.btn-ok 클릭)');
    if (await stop.await(700)) return;
  }
}

/** data-rate (학습 완료율) >= 100 이면 완료. */
async function isModeCompleted(d, btnSelector) {
  return d.evalBool(`
    var btn = document.querySelector(${JSON.stringify(btnSelector)});
    if (!btn) return false;
    var el = btn.querySelector('[data-rate]');
    if (!el) return false;
    var rate = parseInt(el.getAttribute('data-rate'), 10);
    if (isNaN(rate)) return false;
    return rate >= 100;`);
}

async function isTestDone(d, passScore) {
  const score = await d.evalIntOrNull(`
    var btn = document.querySelector(${JSON.stringify(TEST_BTN_SELECTOR)});
    if (!btn) return null;
    var m = (btn.textContent || '').match(/(\\d+)\\s*점/);
    return m ? parseInt(m[1], 10) : null;`);
  return score !== null && score >= passScore;
}

async function isMatchDone(d, passScore) {
  const score = await d.evalIntOrNull(`
    var btn = document.querySelector(${JSON.stringify(MATCH_BTN_SELECTOR)});
    if (!btn) return null;
    var m = (btn.textContent || '').match(/([\\d,]+)\\s*점/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;`);
  return score !== null && score >= passScore;
}

/** 스펠이 선생님 지정 '필수'인지 (자율이면 건너뜀). */
async function isSpellRequired(d) {
  return d.evalBool(`
    var btn = document.querySelector(${JSON.stringify(SPELL_BTN_SELECTOR)});
    if (!btn) return false;
    return btn.classList.contains('required');`);
}

async function isFullCardsMode(d) {
  return d.evalBool(`
    var active = document.querySelector('.sel-show-type.active');
    if (!active) return false;
    return active.getAttribute('data-idx') === ${JSON.stringify(FULL_CARDS_DATA_IDX)};`);
}

/** 학습 구간 드롭다운을 '전체 카드 학습'으로 설정. */
async function ensureFullCardsMode(d, stop) {
  if (await isFullCardsMode(d)) return true;

  const toggled = await d.evalBool(`
    var label = document.querySelector(${JSON.stringify(VIEW_TYPE_TOGGLE_SELECTOR)});
    if (!label) return false;
    var a = label.closest('a[data-toggle="dropdown"]');
    if (!a) return false;
    a.click();
    return true;`);
  if (!toggled) {
    d.log('[전체] 학습구간 드롭다운을 찾지 못했습니다.', 'warn');
    return false;
  }

  if (await stop.await(500)) return false;

  const clicked = await d.evalBool(`
    var opt = document.querySelector('.sel-show-type[data-idx="${FULL_CARDS_DATA_IDX}"]');
    if (!opt) {
        var els = document.querySelectorAll('.sel-show-type');
        for (var i = 0; i < els.length; i++) {
            if ((els[i].textContent || '').trim() === ${JSON.stringify(FULL_CARDS_LABEL)}) {
                opt = els[i];
                break;
            }
        }
    }
    if (!opt) return false;
    opt.click();
    return true;`);
  if (!clicked) {
    d.log(`[전체] '${FULL_CARDS_LABEL}' 옵션을 찾지 못했습니다.`, 'warn');
    return false;
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await isFullCardsMode(d)) {
      d.log(`[전체] 학습구간 -> '${FULL_CARDS_LABEL}'`);
      return true;
    }
    if (await stop.await(200)) return false;
  }
  d.log('[전체] 학습구간 변경 확인 실패.', 'warn');
  return false;
}

async function clickStartLearning(d, stop) {
  if (!(await d.waitForVisible(START_LEARNING_BTN_SELECTOR, 10000, stop))) {
    d.log(`[전체] 시작 버튼(${START_LEARNING_BTN_SELECTOR})을 찾지 못했습니다.`, 'warn');
    return false;
  }
  if (stop.isSet) return false;
  return d.clickFirstVisible(START_LEARNING_BTN_SELECTOR);
}

/**
 * 모드 함수에는 자식 StopFlag 를 넘겨 모드 종료 시의 stop 이 전체 자동화로
 * 전파되지 않게 격리한다 (원본 run_mode_isolated).
 */
async function runModeIsolated(d, modeFn, answerDict, parentStop) {
  const modeStop = new StopFlag(parentStop);
  try {
    await modeFn(d, answerDict, modeStop);
  } finally {
    modeStop.set();
  }
}

/**
 * 현재 set 상세(셋홈)에서 그 set 의 전체 모드를 순서대로 수행.
 * 순서: 암기 -> 리콜 -> (단어·필수면)스펠 -> 매칭/스크램블 -> 테스트.
 */
async function processSetDetail(d, sentenceMode, stop) {
  const testPass = sentenceMode ? PASS.sentenceTest : PASS.test;
  const spellRequired = !sentenceMode && (await isSpellRequired(d));

  const memorizeDone = await isModeCompleted(d, MEMORIZE_BTN_SELECTOR);
  const recallDone = await isModeCompleted(d, RECALL_BTN_SELECTOR);
  const testDone = await isTestDone(d, testPass);
  const gameDone = sentenceMode
    ? await isMatchDone(d, PASS.scramble)
    : await isMatchDone(d, PASS.match);
  const spellDone = !spellRequired || (await isModeCompleted(d, SPELL_BTN_SELECTOR));

  if (memorizeDone && recallDone && testDone && gameDone && spellDone) {
    d.log('[전체] 모든 모드 완료 — set 스킵');
    return;
  }

  await ensureFullCardsMode(d, stop);
  if (await stop.await(500)) return;
  if (stop.isSet) return;

  const data = await Basic.getData(d);
  if (!data || !data.length) {
    d.log('[전체] 단어장 추출 실패.', 'error');
    return;
  }
  const answerDict = Basic.dictFromCards(data);
  if (!answerDict || !answerDict.size) {
    d.log('[전체] 단어장 생성 실패.', 'error');
    return;
  }

  const steps = [
    ['암기', MEMORIZE_BTN_SELECTOR, sentenceMode ? Sentence.memorizeSentence : Basic.memorize],
    ['리콜', RECALL_BTN_SELECTOR, sentenceMode ? Sentence.recallSentence : Basic.recall],
  ];
  if (sentenceMode) {
    steps.push(['스크램블', MATCH_BTN_SELECTOR, Games.scramble]);
  } else {
    if (spellRequired) steps.push(['스펠', SPELL_BTN_SELECTOR, Basic.spell]);
    steps.push(['매칭', MATCH_BTN_SELECTOR, Games.matching]);
  }
  steps.push(['테스트', TEST_BTN_SELECTOR, sentenceMode ? Games.testSentence : Games.test]);

  for (const [label, btnSelector, modeFn] of steps) {
    if (stop.isSet) break;

    let alreadyDone;
    if (label === '테스트') alreadyDone = await isTestDone(d, testPass);
    else if (label === '매칭') alreadyDone = await isMatchDone(d, PASS.match);
    else if (label === '스크램블') alreadyDone = await isMatchDone(d, PASS.scramble);
    else alreadyDone = await isModeCompleted(d, btnSelector);

    if (alreadyDone) {
      d.log(`[전체] ${label} 이미 완료 — 스킵.`);
      continue;
    }

    if (!(await d.clickFirst(btnSelector))) {
      d.log(`[전체] ${label} 버튼 클릭 실패. 스킵.`, 'warn');
      continue;
    }

    if (await stop.await(1000)) break;

    if (label === '테스트') {
      // 1) '다음'
      if (!(await d.waitForVisible(TEST_NEXT_BTN_SELECTOR, 5000, stop)) ||
          !(await d.clickFirstVisible(TEST_NEXT_BTN_SELECTOR))) {
        d.log("[전체] 테스트 '다음' 버튼 클릭 실패", 'warn');
        continue;
      }
      d.log("[전체] 테스트 '다음' 버튼 클릭 완료");

      if (await stop.await(800)) break;

      // 2) '테스트 시작'
      if (!(await d.waitForVisible(TEST_START_BTN_SELECTOR, 5000, stop)) ||
          !(await d.clickFirstVisible(TEST_START_BTN_SELECTOR))) {
        d.log("[전체] '테스트 시작' 버튼 클릭 실패", 'warn');
        continue;
      }
      d.log("[전체] '테스트 시작' 버튼 클릭 완료");

      // 2.5) 확인 모달
      await handleTestRestartModals(d, stop);
      if (stop.isSet) break;

      // 3) 문제 화면 진입 대기
      if (!(await waitForTestPage(d, 10000, stop))) {
        d.log('[전체] 테스트 페이지 진입 실패. 스킵.', 'warn');
        continue;
      }
    } else if (!(await clickStartLearning(d, stop))) {
      d.log(`[전체] ${label} 시작 버튼 클릭 실패. 스킵.`, 'warn');
      continue;
    }

    if (await stop.await(1000)) break;

    await runModeIsolated(d, modeFn, answerDict, stop);

    if (stop.isSet) break;

    if (!(await waitForSetDetail(d, 15000, stop))) {
      d.log(`[전체] ${label} 후 set 페이지 복귀 실패.`, 'warn');
      break;
    }
  }
}

/** 현재 열려 있는 셋홈의 그 set 만 전체 모드 수행 후 종료. */
export async function runSingleSet(d, stop) {
  d.log('[한세트] 시작 ([중지]로 멈춤)');
  if (!(await waitForSetDetail(d, 3000, stop))) {
    d.log('[한세트] set 상세(셋홈) 페이지에서 실행하세요.', 'warn');
    return;
  }
  try {
    const sentenceMode = await isSentenceSetDetail(d);
    const setName = (await d.title()).trim();
    d.log(`[한세트] [${sentenceMode ? '문장' : '단어'}] ${setName}`);
    await processSetDetail(d, sentenceMode, stop);
  } catch (e) {
    if (!stop.isSet) d.log(`[한세트] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[한세트] 종료');
  }
}

/** 단어장 목록 페이지에서 맨 아래 set 부터 위로 순차 처리. */
export async function runFullAutomation(d, stop) {
  d.log('[전체] 시작 ([중지]로 멈춤)');

  if (!(await waitForSetList(d, 3000, stop))) {
    d.log('[전체] .set-item을 찾을 수 없습니다. 단어장 목록 페이지에서 시작하세요.', 'warn');
    return;
  }

  // set 목록 URL 저장 (테스트 '나가기' 등으로 히스토리가 오염돼도 확실히 복귀)
  const setListUrl = await d.currentUrl();

  async function backToSetList(timeoutMs = 10000) {
    await d.loadUrl(setListUrl);
    return waitForSetList(d, timeoutMs, stop);
  }

  const processed = new Set();

  try {
    while (!stop.isSet) {
      const sets = await getSetItems(d);
      if (!sets.length) {
        d.log('[전체] set 목록이 비어있습니다. 종료.', 'warn');
        break;
      }

      let target = null;
      for (let i = sets.length - 1; i >= 0; i--) {
        if (!processed.has(sets[i].idx)) {
          target = sets[i];
          break;
        }
      }
      if (!target) {
        d.log('[전체] 모든 set 처리 완료.', 'success');
        break;
      }

      let sentenceMode = target.sentence || isSentenceSet(target.name);

      const clicked = await d.evalBool(`
        var a = document.querySelector(
            '.set-item a.set-name-a[data-idx=' + JSON.stringify(${JSON.stringify(target.idx)}) + ']');
        if (!a) return false;
        a.click();
        return true;`);
      if (!clicked) {
        d.log(`[전체] set 클릭 실패: ${target.name}`, 'warn');
        processed.add(target.idx);
        continue;
      }

      if (!(await waitForSetDetail(d, 10000, stop))) {
        d.log('[전체] set 상세 페이지 진입 실패. 다음 set로 이동.', 'warn');
        processed.add(target.idx);
        await backToSetList(5000);
        continue;
      }

      if (stop.isSet) break;

      sentenceMode = sentenceMode || (await isSentenceSetDetail(d));
      d.log(`[전체] [${sentenceMode ? '문장' : '단어'}] ${target.name}`);

      await processSetDetail(d, sentenceMode, stop);

      if (stop.isSet) break;

      processed.add(target.idx);

      if (!(await backToSetList(10000))) {
        d.log('[전체] 단어장 목록 페이지 복귀 실패. 종료.', 'warn');
        break;
      }

      if (await stop.await(1000)) break;
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[전체] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[전체] 종료');
  }
}
