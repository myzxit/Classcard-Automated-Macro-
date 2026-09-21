/**
 * PC(exe) 버전 — Electron 메인 프로세스.
 *
 * 확장의 background.js(오케스트레이터)를 Electron 으로 옮긴 것. 역할은 같다:
 *  - 계정 목록/설정/로그 보관 (chrome.storage 대신 사용자 폴더의 JSON 파일)
 *  - 계정마다 창을 하나씩 열고 자동화 루프를 돌린다
 *  - 조작 창(확장 팝업과 같은 화면)과 IPC 로 명령·로그를 주고받는다
 *
 * 크롬과 달리 **계정마다 쿠키 저장소(partition)를 따로 쓰므로 여러 계정을 동시에** 돌릴 수 있다
 * (안드로이드 앱과 같다). '다계정 순차 실행' 설정을 끄면 동시에 돈다.
 */
import { app, BrowserWindow, ipcMain, session, protocol, net, shell } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

import electronUpdater from 'electron-updater';
import { ElectronDriver, StopFlag } from './driver.js';
import { checkForUpdate } from './app/engine/update.js';
import * as Basic from './app/engine/modules/basic.js';
import * as Sentence from './app/engine/modules/sentence.js';
import * as Speaking from './app/engine/modules/speaking.js';
import * as Games from './app/engine/modules/games.js';
import * as Grammar from './app/engine/modules/grammar.js';
import * as AutoAll from './app/engine/modules/autoall.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));
const LOGIN_URL = 'https://www.classcard.net/Login';
const MAX_LOG_LINES = 3000;

// 모의 검증 모드는 사용자의 저장 파일(계정·설정·로그)을 건드리면 안 된다 → 별도 폴더를 쓴다.
if (process.env.CC_SMOKE_MOCK) app.setPath('userData', join(tmpdir(), 'classcard-automation-smoke'));

// 사이트에는 보통 크롬처럼 보이게 한다. Electron 기본 UA 에는 앱 이름(한글)과 'Electron/..' 이 붙는데,
// 한글이 든 UA 는 헤더 규격(ISO-8859-1)에 어긋나 일부 경로에서 요청 자체가 깨진다.
app.userAgentFallback =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${process.versions.chrome} Safari/537.36`;
// 개념 톡 해설 소리가 사용자 제스처 없이도 재생되게 (확장은 사용자가 탭을 눌러 둔 상태라 필요 없었다)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ------------------------------------------------------------------ 저장소

let store = { accounts: [], settings: {}, logs: {} };

function storePath() {
  return join(app.getPath('userData'), 'state.json');
}

function loadStore() {
  try {
    if (existsSync(storePath())) {
      const parsed = JSON.parse(readFileSync(storePath(), 'utf8'));
      store = { accounts: [], settings: {}, logs: {}, ...parsed };
    }
  } catch (e) {
    store = { accounts: [], settings: {}, logs: {} };
  }
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dirname(storePath()), { recursive: true });
      writeFileSync(storePath(), JSON.stringify(store));
    } catch (e) { /* 디스크 문제는 다음 저장 때 다시 */ }
  }, 800);
}

const DEFAULT_SETTINGS = {
  darkMode: true,
  autoUpdate: true,
  autoDict: true,     // 학습 페이지에 들어가면 그 페이지의 단어장을 알아서 가져온다
  autoLogin: true,
  keepTab: true,
  sequential: true,
  startDelaySec: 0,
  accountGapSec: 0,
};

const getAccounts = () => (Array.isArray(store.accounts) ? store.accounts : []);
const setAccounts = (accounts) => { store.accounts = accounts; scheduleSave(); };
const getSettings = () => ({ ...DEFAULT_SETTINGS, ...(store.settings || {}) });
function setSettings(patch) {
  store.settings = { ...getSettings(), ...patch };
  scheduleSave();
  return store.settings;
}

// ------------------------------------------------------------------ 로그

const pad = (n) => String(n).padStart(2, '0');
function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function timeString() {
  const d = new Date();
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
  if (!store.logs[date]) store.logs[date] = [];
  store.logs[date].push(line);
  if (store.logs[date].length > MAX_LOG_LINES) store.logs[date] = store.logs[date].slice(-MAX_LOG_LINES);
  scheduleSave();
  toUi({ type: 'log', date, line });
  if (process.env.CC_SMOKE_MOCK) process.stdout.write(`[${line.time}] ${message}\n`);
}

// ------------------------------------------------------------------ 창

/** @type {BrowserWindow|null} */
let controlWin = null;
/** 계정 아이디 -> { account, win, driver, state, detail, stop, running, answerDict } */
const sessions = new Map();
let currentRun = null;
let lastFocusedAccountWin = null;

function toUi(message) {
  if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send('msg', message);
}

function createControlWindow() {
  controlWin = new BrowserWindow({
    width: 820,
    height: 660,
    minWidth: 640,
    minHeight: 480,
    title: `클래스카드 자동화 v${PKG.version}`,
    icon: join(HERE, 'app/icons/icon128.png'),
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(HERE, 'preload-ui.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  controlWin.loadFile(join(HERE, 'app/ui/popup.html'));
  // 조작 창을 닫으면 앱을 끝낸다 (계정 창만 남으면 다시 열 방법이 없다). 맥은 독에서 다시 연다.
  controlWin.on('closed', () => {
    controlWin = null;
    if (process.platform !== 'darwin') app.quit();
  });
  // 검증용: CC_UI_SHOT=<png 경로> 면 조작 창을 찍고 끝낸다
  if (process.env.CC_UI_SHOT) {
    controlWin.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 3) process.stdout.write(`UI 콘솔: ${e.message}\n`);
    });
    controlWin.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1200));
      const img = await controlWin.webContents.capturePage();
      writeFileSync(process.env.CC_UI_SHOT, img.toPNG());
      app.exit(0);
    });
  }
}

function partitionFor(accountId) {
  return `persist:cc-${encodeURIComponent(accountId)}`;
}

/** 계정용 창을 새로 연다. 계정마다 쿠키가 분리되므로 동시에 여러 계정을 로그인해 둘 수 있다. */
function createAccountWindow(account) {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    title: `[${account.id}] 클래스카드`,
    icon: join(HERE, 'app/icons/icon128.png'),
    autoHideMenuBar: true,
    show: !process.env.CC_SMOKE_MOCK,
    webPreferences: {
      partition: partitionFor(account.id),
      // 이탈 감지 우회 + 문장 리콜 정답 캡처. 페이지 스크립트보다 먼저 페이지 전역에서 돌아야
      // 해서 격리 없이 넣는다(확장의 world: MAIN 콘텐츠 스크립트와 같은 시점).
      preload: join(HERE, 'app/page-preload.cjs'),
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  // 페이지가 새 창(window.open)을 열려 하면 같은 창에서 연다
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/classcard\.net/.test(url)) win.loadURL(url);
    else shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('focus', () => { lastFocusedAccountWin = win; });
  // 학습 페이지에 들어가면 단어장을 알아서 가져온다
  win.webContents.on('did-finish-load', () => maybeAutoDict(win, win.webContents.getURL()));
  // 창이 닫히면 그 창을 쓰던 세션을 전부 정리한다 ('현재 창 사용'으로 다른 계정이 같은 창을 잡았어도).
  win.on('closed', () => {
    for (const [id, s] of sessions) {
      if (s.win === win) {
        s.stop?.set();
        sessions.delete(id);
      }
    }
    notifyState();
  });
  return win;
}

const winAlive = (win) => !!win && !win.isDestroyed();

// ------------------------------------------------------------------ 학습 페이지 자동 단어장 (확장과 같은 규칙)
const STUDY_PATH_RE = /classcard\.net\/(Memorize|Recall|Spell|Test|SetTest|Match|Scramble|Quiz|Learn)[A-Za-z]*\//i;
const autoDictLast = new Map();   // win.id -> 마지막으로 가져온 주소

async function maybeAutoDict(win, url) {
  if (!winAlive(win) || !STUDY_PATH_RE.test(url || '')) return;
  if (getSettings().autoDict === false) return;
  const s = Array.from(sessions.values()).find((x) => x.win === win);
  if (!s || s.running) return;
  if (autoDictLast.get(win.id) === url) return;
  autoDictLast.set(win.id, url);
  // 카드 목록이 실릴 시간을 준다 (시작 화면이어도 preload 가 챙긴 __cc_study_data 는 있다)
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (!winAlive(win)) return;
    const hasCards = await s.driver.evalBool(
      "return !!(window.__cc_study_data && window.__cc_study_data.length) || (typeof study_data !== 'undefined' && !!study_data) || " +
      "!!document.querySelector('.CardItem, .flip-card, [name=\"card_idx[]\"], .speed_quiz_row');",
    );
    if (hasCards) break;
    if (i === 5) { autoDictLast.delete(win.id); return; }
  }
  const data = await Basic.getData(s.driver, { quiet: true });
  const dict = Basic.dictFromCards(data);
  if (dict && dict.size) {
    s.answerDict = dict;
    s.driver.log(`학습 페이지 감지 — 단어장을 자동으로 가져왔습니다 (${dict.size}개)`, 'success');
  }
}

// ------------------------------------------------------------------ 세션

function sessionSummary() {
  return Array.from(sessions.values()).filter((s) => winAlive(s.win)).map((s) => ({
    id: s.account.id, state: s.state, detail: s.detail, tabId: s.win.id,
    running: !!s.running, paused: !!(s.stop && s.stop.isPaused), modeId: s.modeId || null, progress: s.progress || null,
  }));
}

// ------------------------------------------------------------------ 진행률 · 일시정지 · 진행 위치 저장 (확장 background.js 와 같은 규칙)

let lastResumeSaveAt = 0;
const getResumeAll = () => store.resume || {};

async function saveResume(s, { explicit = false } = {}) {
  if (!s || !s.modeId) return null;
  if (!explicit && Date.now() - lastResumeSaveAt < 5000) return null;
  lastResumeSaveAt = Date.now();
  let url = '';
  try { url = await s.driver.currentUrl(); } catch (e) { url = ''; }
  store.resume = store.resume || {};
  const entry = { modeId: s.modeId, url, progress: s.progress || null, savedAt: Date.now() };
  store.resume[s.account.id] = entry;
  scheduleSave();
  if (explicit) {
    const p = s.progress;
    s.driver.log(`진행 위치를 저장했습니다 — ${MODES[s.modeId]?.label || s.modeId}${p ? ` ${p.current}/${p.total}` : ''} · ${url.replace('https://www.classcard.net', '')}`, 'success');
  }
  return entry;
}

function clearResume(accountId) {
  if (store.resume && store.resume[accountId]) { delete store.resume[accountId]; scheduleSave(); }
}

function hookProgress(s) {
  s.driver.onProgress = (p) => { s.progress = p; notifyState(); saveResume(s).catch(() => {}); };
}

function pauseAll() {
  let any = false;
  for (const s of sessions.values()) {
    if (s.running && s.stop && !s.stop.isPaused) { s.stop.pause(); any = true; s.driver.log('일시정지 — 재개를 누를 때까지 멈춥니다.', 'warn'); }
  }
  if (!any) log('    일시정지할 자동화가 없습니다.', 'dim');
  notifyState();
}

function resumeAll() {
  let any = false;
  for (const s of sessions.values()) {
    if (s.running && s.stop && s.stop.isPaused) { s.stop.resume(); any = true; s.driver.log('재개합니다.', 'success'); }
  }
  if (!any) log('    재개할 자동화가 없습니다.', 'dim');
  notifyState();
}

async function resumeRun(accountIds) {
  const all = getResumeAll();
  const ids = (accountIds || []).filter((id) => all[id]);
  if (!ids.length) { log('[이어하기] 저장된 진행 위치가 없습니다. 먼저 [진행 위치 저장]을 누르거나 자동화를 한 번 돌리세요.', 'warn'); return; }
  for (const id of ids) {
    const entry = all[id];
    const account = getAccounts().find((a) => a.id === id) || { id, pw: '' };
    let s = sessions.get(id);
    if (!s || !winAlive(s.win)) s = await openWindowForAccount(account, { forceLogin: false });
    if (entry.url && s) {
      const cur = await s.driver.currentUrl();
      if (cur !== entry.url) { await s.driver.loadUrl(entry.url); await s.driver.waitForLoad(); }
    }
    log(`[${id}] 저장된 위치에서 이어합니다 — ${MODES[entry.modeId]?.label || entry.modeId}${entry.progress ? ` (${entry.progress.current}/${entry.progress.total})` : ''}`);
    await startRun(entry.modeId, [id]);
  }
}

const runningCount = () => Array.from(sessions.values()).filter((s) => s.running).length;

function notifyState() {
  toUi({ type: 'state', sessions: sessionSummary(), running: runningCount() });
}

function setSessionState(s, state, detail = '') {
  s.state = state;
  s.detail = detail;
  notifyState();
}

async function openWindowForAccount(account, { forceLogin }) {
  let s = sessions.get(account.id);
  if (s && !winAlive(s.win)) {
    sessions.delete(account.id);
    s = null;
  }
  // '현재 창 사용'으로 잡은 창은 이미 로그인된 창이다. 로그인 화면일 때만 로그인한다(학습 화면에서 튕기지 않게).
  if (s && s.manual) {
    const url = await s.driver.currentUrl();
    if (/\/Login/.test(url)) await autoLogin(s);
    if (s.state !== 'error') setSessionState(s, 'ready', '현재 창 사용');
    return s;
  }
  if (!s) {
    const win = createAccountWindow(account);
    const driver = new ElectronDriver(win, `[${account.id}]`, log);
    s = { account, win, driver, state: 'opening', detail: '창 여는 중', running: false, stop: null };
    sessions.set(account.id, s);
    hookProgress(s);
    notifyState();
    await driver.loadUrl(process.env.CC_SMOKE_MOCK ? 'https://www.classcard.net/Main' : LOGIN_URL);
  }
  if (forceLogin || getSettings().autoLogin) await autoLogin(s);
  if (s.state !== 'error') setSessionState(s, 'ready', '창 열림');
  return s;
}

/** 확장 background.js 의 autoLogin 과 같은 절차. */
async function autoLogin(s) {
  const d = s.driver;
  const { id, pw } = s.account;
  if (!id || !pw) {
    d.log('[!] 아이디/비밀번호가 없습니다. 수동 로그인하세요.', 'warn');
    return;
  }
  // 클래스카드 주소인데 로그인 입력창이 안 보이면 로그인된 것이다 (사이트는 비로그인이면 로그인 화면으로 보낸다)
  const url = await d.currentUrl();
  if (/classcard\.net/.test(url) && !/\/Login/.test(url)) {
    const loggedIn = await d.evalBool(`
      var ins = document.querySelectorAll('input[name="login_id"], input[name="login_pwd"], #login_id, #login_pwd');
      for (var i = 0; i < ins.length; i++) { var r = ins[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) return false; }
      return true;`);
    if (loggedIn) { d.log('이미 로그인되어 있습니다.'); return; }
  }
  await d.loadUrl(LOGIN_URL);
  const idSelector =
    "input[type='text'][name*='id' i], input[type='text'][name*='Id' i], input#userId, input[placeholder*='아이디']";
  if (!(await d.waitForSelector(idSelector, 10000))) {
    d.log('[!] 자동 로그인 실패: 로그인 폼을 찾지 못했습니다. 수동으로 로그인해 주세요.', 'error');
    return;
  }
  const filled = await d.evalBool(`
    function setValue(el, v) {
      var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
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
    if (!btn) return false; btn.click(); return true;`);
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
  const s = sessions.get(accountId);
  if (!s) return;
  s.stop?.set();
  await s.driver.detachDebugger();
  sessions.delete(accountId);
  if (winAlive(s.win)) s.win.destroy();
  log(`[${accountId}] 창을 닫았습니다.`);
  notifyState();
}

// ------------------------------------------------------------------ 모드 (확장과 같은 표)

const MODES = {
  auto_all: { label: '전체 자동화', flow: AutoAll.runFullAutomation },
  one_set: { label: '한 세트 자동화', flow: AutoAll.runSingleSet },
  memorize: { label: '암기', fn: Basic.memorize, noDict: true },
  recall: { label: '리콜', fn: Basic.recall, noDict: true },
  spell: { label: '스펠', fn: Basic.spell, noDict: true },
  memorize_sentence: { label: '문장 암기', fn: Sentence.memorizeSentence, noDict: true },
  recall_sentence: { label: '문장 리콜', fn: Sentence.recallSentence, noDict: true },
  spell_sentence: { label: '문장 스펠', fn: Sentence.spellSentence, noDict: true },
  test: { label: '단어 테스트', fn: Games.test },
  test_sentence: { label: '문장 테스트', fn: Games.testSentence, noDict: true },
  matching: { label: '단어 매칭', fn: Games.matching, noDict: true },
  scramble: { label: '문장 스크램블', fn: Games.scramble, noDict: true },
  grammar: { label: '문법', fn: Grammar.grammar, noDict: true },
  speaking: {
    label: '스피킹',
    noDict: true,
    fn: (d, dict, stop) => Speaking.speaking(d, dict, stop, {
      includeMic: getSettings().speakingMic === true,
      recordSec: Number(getSettings().speakingRecordSec) > 0 ? Number(getSettings().speakingRecordSec) : 6,
    }),
  },
};

async function fetchAnswerDict(s) {
  const data = await Basic.getData(s.driver);
  const dict = Basic.dictFromCards(data);
  if (dict && dict.size) {
    s.answerDict = dict;
    s.driver.log(`단어장 갱신 완료 (${dict.size}개)`, 'success');
    return dict;
  }
  s.driver.log('단어장 추출 실패 (학습 페이지가 맞는지 확인)', 'warn');
  return null;
}

async function runModeOnSession(s, modeId) {
  const mode = MODES[modeId];
  if (!mode) return;
  const stop = new StopFlag();
  s.stop = stop;
  s.running = true;
  s.modeId = modeId;
  s.progress = null;
  s.driver.progressState = null;
  if (!s.driver.onProgress) hookProgress(s);
  setSessionState(s, 'running', mode.label);
  await s.driver.attachDebugger();
  try {
    if (mode.flow) {
      await mode.flow(s.driver, stop);
    } else {
      let dict = s.answerDict;
      if (!dict) dict = await fetchAnswerDict(s);
      if (!dict && mode.noDict) {
        await mode.fn(s.driver, null, stop);
      } else if (!dict) {
        if (await Basic.startStudyIfNeeded(s.driver, stop)) {
          await stop.await(1200);
          dict = await fetchAnswerDict(s);
        }
        if (dict) await mode.fn(s.driver, dict, stop);
        else s.driver.log('[!] 단어장이 없습니다. 학습 페이지로 이동 후 [단어장 가져오기]를 누르세요.', 'error');
      } else {
        await mode.fn(s.driver, dict, stop);
      }
    }
  } catch (e) {
    if (!stop.isSet) {
      s.driver.log(`자동화 오류: ${e.message}`, 'error');
      setSessionState(s, 'error', '자동화 오류');
    }
  } finally {
    const finished = !!(s.progress && s.progress.total > 0 && s.progress.current >= s.progress.total);
    stop.set();
    s.running = false;
    await s.driver.detachDebugger();
    if (finished) clearResume(s.account.id); else await saveResume(s).catch(() => {});
    if (s.state !== 'error') setSessionState(s, 'ready', '');
    notifyState();
  }
}

/** 순차(기본) 또는 동시 실행. 계정마다 쿠키가 분리돼 있어 쿠키 정리는 필요 없다. */
async function startRun(modeId, accountIds) {
  if (currentRun) { log('[!] 이미 실행 중입니다. 먼저 중지하세요.', 'warn'); return; }
  const accounts = getAccounts().filter((a) => accountIds.includes(a.id));
  if (!accounts.length) { log('[!] 선택된 계정이 없습니다.', 'warn'); return; }
  const settings = getSettings();
  currentRun = { stopped: false };
  try {
    if (settings.startDelaySec > 0) {
      log(`시작 지연시간 ${settings.startDelaySec}초 대기…`);
      await new Promise((r) => setTimeout(r, settings.startDelaySec * 1000));
    }
    const runOne = async (account, i) => {
      if (currentRun.stopped) return;
      if (i > 0 && settings.accountGapSec > 0) {
        // 순차: 앞 계정이 끝난 뒤 간격만큼. 동시: i번째 계정은 i×간격 뒤에 출발해 서로 겹치지 않게.
        const wait = settings.sequential !== false ? settings.accountGapSec : settings.accountGapSec * i;
        log(`[${account.id}] 계정 간격 ${wait}초 대기…`);
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
      const s = await openWindowForAccount(account, { forceLogin: false });
      if (currentRun.stopped) return;
      await runModeOnSession(s, modeId);
      if (!settings.keepTab) await closeSession(account.id);
    };
    if (settings.sequential !== false) {
      for (let i = 0; i < accounts.length; i++) await runOne(accounts[i], i);
    } else {
      await Promise.all(accounts.map((a, i) => runOne(a, i)));
    }
  } catch (e) {
    log(`[!] 실행 오류: ${e.message}`, 'error');
  } finally {
    currentRun = null;
    notifyState();
    log('실행이 끝났습니다.');
  }
}

function stopAll() {
  log('[중지] 모든 계정 자동화를 중지합니다...');
  if (currentRun) currentRun.stopped = true;
  let any = false;
  for (const s of sessions.values()) {
    if (s.running) { any = true; s.stop?.set(); }
  }
  if (!any) log('    현재 실행 중인 자동화가 없습니다.', 'dim');
  notifyState();
}

// ------------------------------------------------------------------ 자동 업데이트
//
// 설치판(setup.exe)은 electron-updater 가 릴리스의 latest.yml 을 보고 새 버전을 **스스로 받아 설치**한다
// (자동화가 돌고 있지 않으면 곧바로 다시 시작해서 설치, 돌고 있으면 앱을 닫을 때 설치).
// 휴대용(portable.exe)은 스스로를 덮어쓸 수 없으므로 새 exe 를 같은 폴더에 받아 그것을 연다.
// 두 경우 모두 version.json / latest.yml 은 CI 가 모든 파일을 올린 뒤 맨 마지막에 올린다.

// autoUpdater 는 처음 손대는 순간 electron 의 app 을 잡는다 — 앱이 준비된 뒤에만 쓴다(느긋하게 꺼낸다)
let _autoUpdater = null;
const getAutoUpdater = () => (_autoUpdater ||= electronUpdater.autoUpdater);
const UPDATE_CHECK_MS = 60 * 60 * 1000;   // 한 시간마다 (새 버전이 나오면 바로 받아 설치한다)
const isPortable = !!process.env.PORTABLE_EXECUTABLE_FILE;
let updateInfo = null;        // { version, url, notes, downloaded, file }
let updaterErrorLogged = false;

function setUpdateInfo(info) {
  updateInfo = info;
  toUi({ type: 'update', update: updateInfo });
}

function installNow() {
  if (!updateInfo || !updateInfo.downloaded) return false;
  if (isPortable) {
    if (updateInfo.file) {
      log(`[업데이트] 새 버전을 엽니다: ${updateInfo.file} — 앞으로는 이 파일을 쓰세요 (예전 파일은 지워도 됩니다).`);
      shell.openPath(updateInfo.file);
      setTimeout(() => app.quit(), 1500);
    }
    return true;
  }
  log('[업데이트] 설치를 위해 앱을 다시 시작합니다…');
  setTimeout(() => getAutoUpdater().quitAndInstall(false, true), 800);
  return true;
}

/** 설치판: electron-updater. */
function setupInstalledUpdater() {
  const autoUpdater = getAutoUpdater();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = true;
  autoUpdater.logger = null;
  autoUpdater.on('update-available', (info) => {
    log(`[업데이트] 새 버전 v${info.version} 이 나왔습니다 — 받는 중…`);
    setUpdateInfo({ version: info.version, url: '', notes: '', downloaded: false });
  });
  autoUpdater.on('update-not-available', () => { if (updateInfo && !updateInfo.downloaded) setUpdateInfo(null); });
  autoUpdater.on('update-downloaded', (info) => {
    setUpdateInfo({ version: info.version, url: '', notes: '', downloaded: true });
    if (runningCount() === 0 && !currentRun) {
      log(`[업데이트] v${info.version} 을 받았습니다 — 바로 다시 시작해서 설치합니다.`);
      setTimeout(installNow, 1500);
    } else {
      log(`[업데이트] v${info.version} 을 받았습니다 — 자동화가 끝나고 앱을 닫으면 설치됩니다 (팝업의 '지금 설치'로 바로 할 수도 있습니다).`);
    }
  });
  autoUpdater.on('error', (e) => {
    if (updaterErrorLogged) return;
    updaterErrorLogged = true;
    log(`[업데이트] 확인 실패: ${String((e && e.message) || e).slice(0, 120)}`, 'warn');
  });
}

/** 휴대용: version.json 을 보고 새 portable.exe 를 같은 폴더에 받는다. */
async function checkPortableUpdate(force) {
  const r = await checkForUpdate(PKG.version);
  if (r.error) { if (force) log(`[업데이트] 새 버전 정보를 받지 못했습니다: ${r.error}`, 'warn'); return; }
  if (!r.available) { if (force) log(`[업데이트] 지금이 최신 버전입니다 (v${PKG.version}).`); return; }
  if (updateInfo && updateInfo.version === r.latest.version) return;
  const dir = dirname(process.env.PORTABLE_EXECUTABLE_FILE);
  const file = join(dir, `classcard-automation-portable-v${r.latest.version}.exe`);
  log(`[업데이트] 새 버전 v${r.latest.version} 이 나왔습니다 — 받는 중…`);
  setUpdateInfo({ version: r.latest.version, url: r.latest.portable, notes: r.latest.notes || '', downloaded: false });
  try {
    const res = await net.fetch(r.latest.portable);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 10 * 1024 * 1024) throw new Error('받은 파일이 너무 작습니다');
    writeFileSync(file, buf);
    setUpdateInfo({ ...updateInfo, downloaded: true, file });
    log(`[업데이트] v${r.latest.version} 을 받았습니다: ${file}`);
    if (runningCount() === 0 && !currentRun) { log('[업데이트] 바로 새 버전을 엽니다.'); setTimeout(installNow, 1500); }
    else log("[업데이트] 자동화가 끝나면 팝업의 '지금 설치'를 누르세요.");
  } catch (e) {
    log(`[업데이트] 받기 실패: ${String((e && e.message) || e).slice(0, 120)}`, 'error');
  }
}

async function runUpdateCheck(force = false) {
  if (!force && getSettings().autoUpdate === false) return;
  if (!app.isPackaged) {
    // 개발 실행(npm start)에서는 설치할 곳이 없다 — 확인만 해 보고 로그로 알린다
    const r = await checkForUpdate(PKG.version);
    if (force) log(r.available ? `[업데이트] 새 버전 v${r.latest.version} (개발 실행이라 설치하지 않습니다)` : `[업데이트] 최신입니다 (v${PKG.version}) ${r.error || ''}`);
    return;
  }
  if (isPortable) return checkPortableUpdate(force);
  try { await getAutoUpdater().checkForUpdates(); } catch (e) { if (force) log(`[업데이트] 확인 실패: ${e.message}`, 'warn'); }
}

// ------------------------------------------------------------------ IPC (확장 메시지와 1:1)

ipcMain.on('manifest', (event) => { event.returnValue = { version: PKG.version, name: PKG.productName }; });
ipcMain.handle('focusWindow', (_e, winId) => {
  const win = BrowserWindow.fromId(winId);
  if (win && !win.isDestroyed()) { win.show(); win.focus(); }
});

ipcMain.handle('msg', async (_event, msg) => {
  switch (msg.type) {
    case 'getState':
      return {
        platform: 'desktop',
        accounts: getAccounts(),
        settings: getSettings(),
        sessions: sessionSummary(),
        running: runningCount(),
        logs: store.logs,
        today: todayString(),
        update: updateInfo,
        resume: getResumeAll(),
      };
    case 'checkUpdate':
      await runUpdateCheck(true);
      return { update: updateInfo };
    case 'downloadUpdate':
      if (updateInfo && updateInfo.downloaded) { installNow(); return { ok: true }; }
      await runUpdateCheck(true);
      return { ok: !!updateInfo };
    case 'setAccounts':
      setAccounts(msg.accounts);
      return { ok: true };
    case 'setSettings':
      return { settings: setSettings(msg.patch) };
    case 'openTabs': {
      const accounts = getAccounts().filter((a) => msg.accountIds.includes(a.id));
      if (!accounts.length) log('[!] 선택된 계정이 없습니다.', 'warn');
      for (const a of accounts) await openWindowForAccount(a, { forceLogin: false });
      return { ok: true };
    }
    case 'closeTabs':
      for (const id of msg.accountIds) await closeSession(id);
      return { ok: true };
    case 'run':
      startRun(msg.modeId, msg.accountIds);
      return { ok: true };
    case 'stop':
      stopAll();
      return { ok: true };
    case 'pause':
      pauseAll();
      return { ok: true };
    case 'resume':
      resumeAll();
      return { ok: true };
    case 'saveProgress': {
      let saved = 0;
      for (const s of sessions.values()) {
        if ((msg.accountIds || []).includes(s.account.id) && s.modeId && (await saveResume(s, { explicit: true }))) saved += 1;
      }
      if (!saved) log('[진행 위치 저장] 저장할 진행 중인(또는 방금 돌린) 자동화가 없습니다.', 'warn');
      return { ok: true, resume: getResumeAll() };
    }
    case 'resumeRun':
      resumeRun(msg.accountIds);
      return { ok: true };
    case 'fetchDict': {
      const accounts = getAccounts().filter((a) => msg.accountIds.includes(a.id));
      for (const a of accounts) {
        const s = sessions.get(a.id);
        if (s) await fetchAnswerDict(s);
        else log(`[${a.id}] 창이 열려 있지 않습니다.`, 'warn');
      }
      return { ok: true };
    }
    case 'clearLog':
      delete store.logs[msg.date];
      scheduleSave();
      return { ok: true };
    case 'useActiveTab': {
      // 마지막으로 앞에 있던 계정 창을 이 계정의 세션으로 삼는다 (확장의 '지금 보는 탭 사용')
      const win = winAlive(lastFocusedAccountWin) ? lastFocusedAccountWin : null;
      if (!win || !/classcard\.net/.test(win.webContents.getURL())) {
        log('[!] 클래스카드 창이 없습니다. 먼저 [창 열기]로 창을 연 뒤 그 창을 한 번 눌러 주세요.', 'warn');
        return { ok: false };
      }
      const account = getAccounts().find((a) => a.id === msg.accountId) || { id: msg.accountId || '현재 창', pw: '' };
      const old = sessions.get(account.id);
      if (old && old.win !== win) old.stop?.set();
      sessions.set(account.id, {
        account, win, driver: new ElectronDriver(win, `[${account.id}]`, log),
        state: 'ready', detail: '현재 창 사용', running: false, stop: null, manual: true,
      });
      maybeAutoDict(win, win.webContents.getURL());
      log(`[${account.id}] 현재 창을 사용합니다.`);
      notifyState();
      return { ok: true };
    }
    default:
      return { ok: false, error: 'unknown message' };
  }
});

// ------------------------------------------------------------------ 검증용(모의 화면) 훅
//
// CC_SMOKE_MOCK=<html 파일>  CC_SMOKE_MODE=<모드>  로 띄우면 classcard.net 요청을 전부 그 파일로
// 대답하고, 계정 하나를 만들어 그 모드를 곧장 돌린 뒤 결과(#stat)를 찍고 끝난다.
// 확장의 모의 회귀 테스트와 같은 화면을 PC 판에도 통과시키기 위한 것이다.

async function runSmoke() {
  const html = readFileSync(process.env.CC_SMOKE_MOCK);
  const mode = process.env.CC_SMOKE_MODE || 'recall';
  const account = { id: 'smoke', pw: 'x', enabled: true };
  const ses = session.fromPartition(partitionFor(account.id));
  ses.protocol.handle('https', (req) => {
    if (/classcard\.net/.test(req.url)) {
      return new Response(new Uint8Array(html), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response(null, { status: 404 });
  });
  setSettings({ autoLogin: false, keepTab: true });
  setAccounts([account]);
  const s = await openWindowForAccount(account, { forceLogin: false });
  await new Promise((r) => setTimeout(r, 600));
  const runP = runModeOnSession(s, mode);
  const deadline = Date.now() + Number(process.env.CC_SMOKE_TIMEOUT || 120000);
  let stat = null;
  while (Date.now() < deadline) {
    stat = await s.driver.eval(`
      var st = document.getElementById('stat');
      var d = document.getElementById('done');
      // 모의 화면은 두 가지 방식으로 '끝'을 알린다: #done 이 보이거나, #stat 에 data-done="1" 이 붙는다
      var doneA = d && getComputedStyle(d).display !== 'none';
      var doneB = st && st.getAttribute('data-done') === '1';
      if (!doneA && !doneB) return null;
      return st ? st.textContent : 'done';`);
    if (stat) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  process.stdout.write(stat ? `결과: ${stat}\n` : '결과: (완주 못함)\n');
  s.stop?.set();
  await Promise.race([runP, new Promise((r) => setTimeout(r, 3000))]);
  app.exit(stat ? 0 : 1);
}

// ------------------------------------------------------------------ 시작

protocol.registerSchemesAsPrivileged([]);

app.whenReady().then(async () => {
  loadStore();
  if (process.env.CC_SMOKE_MOCK) {
    log(`모의 검증 모드: ${process.env.CC_SMOKE_MODE || 'recall'}`);
    await runSmoke();
    return;
  }
  createControlWindow();
  log(`클래스카드 자동화 PC 버전 v${PKG.version} 이 준비되었습니다.`);
  if (app.isPackaged && !isPortable) setupInstalledUpdater();
  setTimeout(() => runUpdateCheck(), 4000);
  setInterval(() => runUpdateCheck(), UPDATE_CHECK_MS);
  app.on('activate', () => { if (!controlWin) createControlWindow(); });
});

app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', () => {
  for (const s of sessions.values()) s.stop?.set();
  if (saveTimer) {
    clearTimeout(saveTimer);
    try { writeFileSync(storePath(), JSON.stringify(store)); } catch (e) { /* 무시 */ }
  }
});

// 아이콘 등 경로 계산에 쓰는 file:// URL (패키징 후에도 같은 규칙)
export const APP_URL = pathToFileURL(resolve(HERE)).href;
