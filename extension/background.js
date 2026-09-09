/**
 * 백그라운드 오케스트레이터.
 *
 * 파이썬 main.py 의 컨트롤러 역할:
 *  - 계정 목록 관리(.env 대체)
 *  - 버튼 하나로 선택한 계정 전부 실행 (계정 사이 간격/시작 지연 적용)
 *  - 자동화 루프는 여기서 돌고, DOM 조작만 탭으로 내려보낸다(페이지 이동에 강함)
 */

import { Driver, StopFlag } from './engine/driver.js';
import * as Basic from './engine/modules/basic.js';
import * as Sentence from './engine/modules/sentence.js';
import * as Games from './engine/modules/games.js';
import * as Grammar from './engine/modules/grammar.js';
import * as AutoAll from './engine/modules/autoall.js';

const LOGIN_URL = 'https://www.classcard.net/Login';
const MAX_LOG_LINES = 3000;

// ------------------------------------------------------------------ 상태

/** 계정 아이디 -> { account, tabId, driver, state, detail, stop, running } */
const sessions = new Map();

/** 화면에 보여줄 로그 (날짜 -> 줄 배열). */
let logsByDate = {};
let currentRun = null; // { queue, index, modeId, stopped }

const DEFAULT_SETTINGS = {
  darkMode: true,
  autoLogin: true,
  keepTab: true,
  sequential: true,
  startDelaySec: 0,
  accountGapSec: 0,
};

// ------------------------------------------------------------------ 저장소

async function getAccounts() {
  const { accounts } = await chrome.storage.local.get('accounts');
  return Array.isArray(accounts) ? accounts : [];
}

async function setAccounts(accounts) {
  await chrome.storage.local.set({ accounts });
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function setSettings(patch) {
  const settings = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings });
  return settings;
}

async function loadLogs() {
  const { logs } = await chrome.storage.local.get('logs');
  logsByDate = logs && typeof logs === 'object' ? logs : {};
}

let saveLogsTimer = null;
function scheduleSaveLogs() {
  if (saveLogsTimer) return;
  saveLogsTimer = setTimeout(() => {
    saveLogsTimer = null;
    chrome.storage.local.set({ logs: logsByDate }).catch(() => {});
  }, 1000);
}

// ------------------------------------------------------------------ 로그

function todayString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function guessLevel(message) {
  if (message.includes('[!]') || message.includes('오류') ||
      message.includes('실패') || message.includes('Error')) return 'error';
  if (message.includes('[O]') || message.includes('성공') || message.includes('완료')) return 'success';
  if (message.includes('스킵') || message.includes('건너')) return 'warn';
  return 'info';
}

function log(message, level) {
  const date = todayString();
  const line = { time: timeString(), message, level: level || guessLevel(message) };
  if (!logsByDate[date]) logsByDate[date] = [];
  logsByDate[date].push(line);
  if (logsByDate[date].length > MAX_LOG_LINES) {
    logsByDate[date] = logsByDate[date].slice(-MAX_LOG_LINES);
  }
  scheduleSaveLogs();
  // 팝업이 열려 있으면 실시간으로 전달 (닫혀 있으면 조용히 무시된다)
  chrome.runtime.sendMessage({ type: 'log', date, line }).catch(() => {});
}

// ------------------------------------------------------------------ 세션

function sessionSummary() {
  return Array.from(sessions.values()).map((s) => ({
    id: s.account.id,
    state: s.state,
    detail: s.detail,
    tabId: s.tabId,
  }));
}

function notifyState() {
  chrome.runtime.sendMessage({
    type: 'state',
    sessions: sessionSummary(),
    running: runningCount(),
  }).catch(() => {});
}

function runningCount() {
  return Array.from(sessions.values()).filter((s) => s.running).length;
}

function setSessionState(session, state, detail = '') {
  session.state = state;
  session.detail = detail;
  notifyState();
}

/** 탭이 살아 있는지 확인. */
async function tabAlive(tabId) {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 계정용 탭을 연다(이미 있으면 재사용).
 * 크롬은 프로필 하나에 쿠키가 공유되므로, 계정이 바뀌면 쿠키를 지우고 다시 로그인한다.
 */
async function openTabForAccount(account, { forceLogin }) {
  let session = sessions.get(account.id);

  if (session && !(await tabAlive(session.tabId))) {
    sessions.delete(account.id);
    session = null;
  }

  if (!session) {
    const tab = await chrome.tabs.create({ url: LOGIN_URL, active: false });
    const driver = new Driver(tab.id, `[${account.id}]`, log);
    session = {
      account,
      tabId: tab.id,
      driver,
      state: 'opening',
      detail: '탭 여는 중',
      running: false,
      stop: null,
    };
    sessions.set(account.id, session);
    notifyState();
    await driver.waitForLoad();
  }

  const settings = await getSettings();
  if (forceLogin || settings.autoLogin) {
    await autoLogin(session);
  }
  if (session.state !== 'error') setSessionState(session, 'ready', '탭 열림');
  return session;
}

/** 다른 계정으로 갈아타기 위해 classcard.net 쿠키를 지운다. */
async function clearClasscardCookies() {
  const domains = ['https://www.classcard.net', 'https://classcard.net'];
  for (const url of domains) {
    try {
      const cookies = await chrome.cookies.getAll({ url });
      for (const c of cookies) {
        await chrome.cookies.remove({ url, name: c.name }).catch(() => {});
      }
    } catch (e) {
      // 권한 문제 등은 무시하고 계속
    }
  }
}

/** main.py 의 auto_login 이식. */
async function autoLogin(session) {
  const d = session.driver;
  const { id, pw } = session.account;
  if (!id || !pw) {
    d.log('[!] 아이디/비밀번호가 없습니다. 수동 로그인하세요.', 'warn');
    return;
  }

  // 이미 로그인되어 있으면 그대로 둔다.
  const url = await d.currentUrl();
  if (!url.includes('/Login')) {
    const loggedIn = await d.evalBool(
      "return !!document.querySelector('.btn-top-menu, .set-item, .btn-summary');",
    );
    if (loggedIn) {
      d.log('이미 로그인되어 있습니다.');
      return;
    }
  }

  await d.loadUrl(LOGIN_URL);

  const idSelector =
    "input[type='text'][name*='id' i], input[type='text'][name*='Id' i], " +
    "input#userId, input[placeholder*='아이디']";

  if (!(await d.waitForSelector(idSelector, 10000))) {
    d.log('[!] 자동 로그인 실패: 로그인 폼을 찾지 못했습니다. 수동으로 로그인해 주세요.', 'error');
    return;
  }

  const filled = await d.evalBool(`
    function setValue(el, v) {
        var setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
    }
    var idInput = document.querySelector(${JSON.stringify(idSelector)});
    var pwInput = document.querySelector("input[type='password']");
    if (!idInput || !pwInput) return false;
    setValue(idInput, ${JSON.stringify(id)});
    setValue(pwInput, ${JSON.stringify(pw)});
    return true;`);
  if (!filled) {
    d.log('[!] 자동 로그인 실패: 입력창을 찾지 못했습니다. 수동으로 로그인해 주세요.', 'error');
    return;
  }

  const beforeUrl = await d.currentUrl();
  const clicked = await d.evalBool(`
    var btn = document.querySelector('a.btn-login');
    if (!btn) return false;
    btn.click();
    return true;`);
  if (!clicked) {
    d.log('[!] 자동 로그인 실패: 로그인 버튼을 찾지 못했습니다. 수동으로 로그인해 주세요.', 'error');
    return;
  }

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if ((await d.currentUrl()) !== beforeUrl) {
      await d.waitForLoad();
      d.log('[O] 로그인 성공', 'success');
      return;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  d.log('[!] 자동 로그인 실패(시간 초과). 수동으로 로그인해 주세요.', 'error');
}

async function closeSession(accountId) {
  const session = sessions.get(accountId);
  if (!session) return;
  session.stop?.set();
  await session.driver.detachDebugger();
  try {
    await chrome.tabs.remove(session.tabId);
  } catch (e) {
    // 이미 닫혔으면 무시
  }
  sessions.delete(accountId);
  log(`[${accountId}] 탭을 닫았습니다.`);
  notifyState();
}

// ------------------------------------------------------------------ 모드

const MODES = {
  auto_all: { label: '전체 자동화', flow: AutoAll.runFullAutomation },
  one_set: { label: '한 세트 자동화', flow: AutoAll.runSingleSet },
  // noDict: 단어장 없이도 (화면·페이지 데이터만으로) 풀 수 있는 모드.
  // 단어장이 있으면 그대로 넘겨 주고, 없으면 없는 채로 실행한다.
  memorize: { label: '암기', fn: Basic.memorize, noDict: true },          // 정답이 필요 없다
  recall: { label: '리콜', fn: Basic.recall, noDict: true },              // 정답이 필요 없다
  spell: { label: '스펠', fn: Basic.spell },                              // 단어장 필수
  // 문장 암기는 화면에서 정답 문장을 직접 읽는다 (단어장은 폴백).
  memorize_sentence: { label: '문장 암기', fn: Sentence.memorizeSentence, noDict: true },
  // 문장 리콜은 페이지가 로그하는 정답을 캡처한다.
  recall_sentence: { label: '문장 리콜', fn: Sentence.recallSentence, noDict: true },
  test: { label: '단어 테스트', fn: Games.test },                          // 단어장 필수
  // 문장 테스트는 페이지 카드 목록(study_data)에서 정답을 읽으므로 단어장이 없어도 된다.
  test_sentence: { label: '문장 테스트', fn: Games.testSentence, noDict: true },
  matching: { label: '단어 매칭', fn: Games.matching, noDict: true },      // card_list 폴백
  scramble: { label: '문장 스크램블', fn: Games.scramble, noDict: true },   // 페이지 데이터 폴백
  // 문법훈련은 단어장 없이도 (보기를 확인해 가며) 풀 수 있다.
  grammar: { label: '문법', fn: Grammar.grammar, noDict: true },
};

/** 현재 페이지에서 단어장을 뽑아 세션에 저장 (Ctrl+M 대응). */
async function fetchAnswerDict(session) {
  const data = await Basic.getData(session.driver);
  const dict = Basic.dictFromCards(data);
  if (dict && dict.size) {
    session.answerDict = dict;
    session.driver.log(`단어장 갱신 완료 (${dict.size}개)`, 'success');
    return dict;
  }
  session.driver.log('단어장 추출 실패 (학습 페이지가 맞는지 확인)', 'warn');
  return null;
}

async function runModeOnSession(session, modeId) {
  const mode = MODES[modeId];
  if (!mode) return;

  const stop = new StopFlag();
  session.stop = stop;
  session.running = true;
  setSessionState(session, 'running', mode.label);

  // 문장 테스트의 스크램블 버튼은 신뢰된 입력만 받는다 -> CDP 연결
  await session.driver.attachDebugger();

  try {
    if (mode.flow) {
      await mode.flow(session.driver, stop);
    } else {
      let dict = session.answerDict;
      if (!dict) dict = await fetchAnswerDict(session);
      if (!dict && mode.noDict) {
        await mode.fn(session.driver, null, stop);
      } else if (!dict) {
        session.driver.log(
          '[!] 단어장이 없습니다. 학습 페이지로 이동 후 [단어장 가져오기]를 누르세요.',
          'error',
        );
      } else {
        await mode.fn(session.driver, dict, stop);
      }
    }
  } catch (e) {
    if (!stop.isSet) {
      session.driver.log(`자동화 오류: ${e.message}`, 'error');
      setSessionState(session, 'error', '자동화 오류');
    }
  } finally {
    stop.set();
    session.running = false;
    await session.driver.detachDebugger();
    if (session.state !== 'error') setSessionState(session, 'ready', '');
    notifyState();
  }
}

/**
 * 선택한 계정들에 대해 모드를 실행한다.
 *
 * 크롬은 프로필 하나에서 쿠키를 공유하므로 여러 계정을 동시에 로그인해 둘 수 없다.
 * 그래서 다계정은 '순차'로 돌린다: 쿠키 정리 -> 로그인 -> 실행 -> 다음 계정.
 * (계정이 하나면 그냥 바로 실행한다.)
 */
async function startRun(modeId, accountIds) {
  if (currentRun) {
    log('[!] 이미 실행 중입니다. 먼저 중지하세요.', 'warn');
    return;
  }

  const accounts = (await getAccounts()).filter((a) => accountIds.includes(a.id));
  if (!accounts.length) {
    log('[!] 선택된 계정이 없습니다.', 'warn');
    return;
  }

  const settings = await getSettings();
  currentRun = { stopped: false };

  keepAlive(true);

  try {
    if (settings.startDelaySec > 0) {
      log(`시작 지연시간 ${settings.startDelaySec}초 대기…`);
      await new Promise((r) => setTimeout(r, settings.startDelaySec * 1000));
    }

    for (let i = 0; i < accounts.length; i++) {
      if (currentRun.stopped) break;
      const account = accounts[i];

      if (i > 0) {
        if (settings.accountGapSec > 0) {
          log(`계정 간격 ${settings.accountGapSec}초 대기…`);
          await new Promise((r) => setTimeout(r, settings.accountGapSec * 1000));
        }
        // 다음 계정으로 갈아타려면 쿠키를 비워야 한다.
        log(`[${account.id}] 계정 전환을 위해 클래스카드 쿠키를 정리합니다.`);
        await clearClasscardCookies();
      }

      const session = await openTabForAccount(account, { forceLogin: i > 0 });
      if (currentRun.stopped) break;

      await runModeOnSession(session, modeId);

      if (!settings.keepTab) await closeSession(account.id);
    }
  } catch (e) {
    log(`[!] 실행 오류: ${e.message}`, 'error');
  } finally {
    currentRun = null;
    keepAlive(false);
    notifyState();
    log('실행이 끝났습니다.');
  }
}

function stopAll() {
  log('[중지] 모든 계정 자동화를 중지합니다...');
  if (currentRun) currentRun.stopped = true;
  let any = false;
  for (const session of sessions.values()) {
    if (session.running) {
      any = true;
      session.stop?.set();
    }
  }
  if (!any) log('    현재 실행 중인 자동화가 없습니다.', 'dim');
  notifyState();
}

/**
 * MV3 서비스 워커는 쉬면 종료된다.
 * 자동화 루프가 계속 chrome.* API 를 호출해 사실상 깨어 있지만,
 * 대기 구간(계정 간격 등)을 대비해 알람으로도 한 번 더 붙잡아 둔다.
 */
function keepAlive(on) {
  if (on) {
    chrome.alarms.create('cc-keepalive', { periodInMinutes: 0.5 });
  } else {
    chrome.alarms.clear('cc-keepalive');
  }
}

chrome.alarms.onAlarm.addListener(() => {
  // 아무것도 하지 않아도 워커가 깨어난다.
});

// 탭이 닫히면 세션도 정리
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [id, session] of sessions) {
    if (session.tabId === tabId) {
      session.stop?.set();
      sessions.delete(id);
      notifyState();
    }
  }
});

// ------------------------------------------------------------------ 메시지

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'getState': {
        await loadLogs();
        sendResponse({
          accounts: await getAccounts(),
          settings: await getSettings(),
          sessions: sessionSummary(),
          running: runningCount(),
          logs: logsByDate,
          today: todayString(),
        });
        break;
      }
      case 'setAccounts':
        await setAccounts(msg.accounts);
        sendResponse({ ok: true });
        break;
      case 'setSettings':
        sendResponse({ settings: await setSettings(msg.patch) });
        break;
      case 'openTabs': {
        const accounts = (await getAccounts()).filter((a) => msg.accountIds.includes(a.id));
        if (!accounts.length) {
          log('[!] 선택된 계정이 없습니다.', 'warn');
        } else if (accounts.length > 1) {
          log(
            '[!] 크롬은 프로필 하나에서 쿠키를 공유합니다. 여러 계정은 순차로 실행되며, ' +
              '지금은 첫 번째 계정만 로그인해 둡니다.',
            'warn',
          );
          await openTabForAccount(accounts[0], { forceLogin: false });
        } else {
          await openTabForAccount(accounts[0], { forceLogin: false });
        }
        sendResponse({ ok: true });
        break;
      }
      case 'closeTabs':
        for (const id of msg.accountIds) await closeSession(id);
        sendResponse({ ok: true });
        break;
      case 'run':
        startRun(msg.modeId, msg.accountIds);
        sendResponse({ ok: true });
        break;
      case 'stop':
        stopAll();
        sendResponse({ ok: true });
        break;
      case 'fetchDict': {
        const accounts = (await getAccounts()).filter((a) => msg.accountIds.includes(a.id));
        for (const account of accounts) {
          const session = sessions.get(account.id);
          if (session) await fetchAnswerDict(session);
          else log(`[${account.id}] 탭이 열려 있지 않습니다.`, 'warn');
        }
        sendResponse({ ok: true });
        break;
      }
      case 'clearLog':
        delete logsByDate[msg.date];
        await chrome.storage.local.set({ logs: logsByDate });
        sendResponse({ ok: true });
        break;
      case 'useActiveTab': {
        // 지금 보고 있는 클래스카드 탭을 이 계정의 세션으로 삼는다.
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !/classcard\.net/.test(tab.url || '')) {
          log('[!] 현재 탭이 클래스카드 페이지가 아닙니다.', 'warn');
          sendResponse({ ok: false });
          break;
        }
        const accounts = await getAccounts();
        const account = accounts.find((a) => a.id === msg.accountId) ||
          { id: msg.accountId || '현재 탭', pw: '' };
        const driver = new Driver(tab.id, `[${account.id}]`, log);
        sessions.set(account.id, {
          account, tabId: tab.id, driver, state: 'ready', detail: '현재 탭 사용', running: false, stop: null,
        });
        log(`[${account.id}] 현재 탭을 사용합니다.`);
        notifyState();
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
  })();
  return true; // 비동기 응답
});

loadLogs();
log('클래스카드 자동화 확장프로그램이 준비되었습니다.');
