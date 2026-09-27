/**
 * 팝업 UI — 안드로이드 앱과 같은 화면 구성.
 * 실제 자동화는 background.js 에서 돌고, 여기서는 상태를 보여주고 명령만 보낸다.
 */

// PC(exe) 버전은 Electron 창에 이 화면을 그대로 띄우고, preload 가 `ccBridge` 로 chrome.runtime 을 흉내 낸다.
// (Electron 렌더러에는 자체 `window.chrome` 이 있어 그 이름으로는 덮어쓸 수 없다.)
// 확장에서는 ccBridge 가 없으므로 진짜 chrome 을 쓴다. 모듈 스코프라 이 파일 전체가 이 이름을 본다.
const chrome = globalThis.ccBridge || globalThis.chrome;

const MODES = [
  { id: 'auto_all', label: '⚡ 전체 자동화', help: '단어장 목록 페이지에서 맨 아래 set부터 순서대로 전 과정을 자동 수행합니다.' },
  { id: 'one_set', label: '◎ 한 세트 자동화', help: '셋홈(set 상세) 페이지를 열어둔 상태에서 그 한 세트만 전 과정을 수행합니다.' },
  { id: 'memorize', label: '🗂 암기', help: '암기 학습 화면에 들어간 상태에서 실행하세요.' },
  { id: 'recall', label: '🔁 리콜', help: '리콜 학습 화면에 들어간 상태에서 실행하세요.' },
  { id: 'spell', label: '⌨ 스펠', help: '스펠 학습 화면에서 실행하세요. 단어장이 없으면 자동으로 가져옵니다.' },
  { id: 'memorize_sentence', label: '📖 문장 암기', help: '문장 암기 화면에 들어간 상태에서 실행하세요.' },
  { id: 'recall_sentence', label: '📝 문장 리콜', help: '문장 리콜 화면에서 실행하세요. 정답은 페이지 로그에서 자동으로 캡처합니다.' },
  { id: 'spell_sentence', label: '✍ 문장 스펠', help: '문장 세트의 스펠 학습 화면에서 실행하세요. 어순배열·영작·딕테이션·첫글자 설정 모두 됩니다.' },
  { id: 'test', label: '🃏 단어 테스트', help: '단어 테스트 문제 화면에서 실행하세요. 70점 초과를 보장하며 일부는 일부러 틀립니다.' },
  { id: 'test_sentence', label: '📕 문장 테스트', help: '문장 테스트 문제 화면에서 실행하세요. 신뢰된 클릭이 필요해 디버거가 잠깐 연결됩니다.' },
  { id: 'matching', label: '🎴 단어 매칭', help: '매칭 게임 화면에서 실행하세요. 목표 점수에 도달하면 중도 종료합니다.' },
  { id: 'scramble', label: '✳ 문장 스크램블', help: '스크램블 게임 화면에서 실행하세요. 목표 점수에 도달하면 종료합니다.' },
  { id: 'grammar', label: '📐 문법', help: '문법훈련 클래스 페이지에서 실행하면 유닛의 단계를 순서대로 진행합니다. 문제 화면에서 바로 실행해도 됩니다.' },
  { id: 'speaking', label: '🎤 스피킹', help: '세트의 [스피킹] 화면에서 실행하세요. 입해석·입영작·집중듣기를 끝까지 대신 합니다. 낭독·쉐도잉·녹음은 목소리를 직접 말해야 해서 고급 설정에서 켜야 합니다.' },
  { id: 'fetch', label: '⤵ 단어장 가져오기', help: '현재 열린 학습 페이지에서 단어/뜻 데이터를 추출해 저장합니다.' },
];

const SETTINGS = [
  {
    key: 'darkMode', title: '화면 테마', sub: '밤하늘(다크) / 낮 하늘(화이트)',
    type: 'choice', labelOn: '🌙 밤', labelOff: '☀ 낮',
  },
  { key: 'animeTheme', title: '이세계 테마', sub: '배경 그림과 캐릭터(유메·푸딩) 표시. 끄면 단색 화면', type: 'toggle' },
  { key: 'autoUpdate', title: '자동 업데이트', sub: '새 버전이 올라오면 한 시간 안에 알아서 받음 (PC 앱은 스스로 설치, 안드로이드는 설치 화면까지 자동)', type: 'toggle' },
  { key: 'autoLogin', title: '자동 로그인', sub: '저장된 ID/PW로 탭을 열 때 바로 로그인', type: 'toggle' },
  { key: 'autoDict', title: '학습 페이지 자동 단어장', sub: '학습 페이지에 들어가면 그 페이지의 단어장을 알아서 가져옴', type: 'toggle' },
  { key: 'speakingMic', title: '스피킹 녹음 단계 (시험 중)', sub: '낭독·쉐도잉·녹음까지 진행(직접 말해야 함). 크롬이 배경 작업을 재워 30초쯤에 서는 일이 있어 기본은 꺼짐', type: 'toggle' },
  { key: 'speakingRecordSec', title: '스피킹 녹음 시간 (초)', sub: '카드마다 말할 시간. 이 시간이 지나면 녹음을 멈추고 다음 카드로', type: 'number' },
  { key: 'keepTab', title: '자동화 후 탭 유지', sub: '끄면 자동화가 끝날 때 탭을 닫음', type: 'toggle' },
  { key: 'sequential', title: '다계정 순차 실행', sub: '크롬은 쿠키를 공유하므로 계정을 하나씩 실행 (끌 수 없음)', type: 'toggle', disabled: true, fixed: true },
  { key: 'hotkey', title: '전역 단축키 사용', sub: 'Ctrl+A / Ctrl+I / Ctrl+E … (확장프로그램 미지원)', type: 'toggle', disabled: true, fixed: false },
  { key: 'startDelaySec', title: '시작 지연시간 (초)', sub: '시작 버튼을 누른 뒤 대기할 시간', type: 'number' },
  { key: 'accountGapSec', title: '계정별 실행 간격 (초)', sub: '다계정 순차 실행 시 간격', type: 'number' },
];

/**
 * PC(exe) 버전은 이 화면을 Electron 창에 그대로 띄운다 (desktop/preload-ui.cjs 가 chrome.runtime 을 흉내 낸다).
 * 그때는 창 크기에 맞춰 늘어나야 하고, 계정마다 쿠키가 분리돼 있어 '동시 실행'도 고를 수 있다.
 */
const IS_DESKTOP = !!(chrome && chrome.runtime && chrome.runtime.ccDesktop);
if (IS_DESKTOP) {
  document.documentElement.dataset.platform = 'desktop';
  const seq = SETTINGS.find((s) => s.key === 'sequential');
  seq.disabled = false;
  seq.fixed = undefined;
  seq.sub = '끄면 계정들을 동시에 실행 (PC 버전은 계정마다 쿠키가 분리됨)';
}

let state = {
  accounts: [],
  settings: {},
  sessions: [],
  running: 0,
  logs: {},
  today: '',
};
let selectedModeId = 'auto_all';
let searchQuery = '';
let currentLogDate = '';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ 초기화

async function init() {
  const manifest = chrome.runtime.getManifest();
  $('versionBadge').textContent = `v${manifest.version}`;

  buildModeGrid();
  bindEvents();

  state = await send({ type: 'getState' });
  currentLogDate = state.today;
  applyTheme();

  buildSettings();
  renderAccounts();
  renderStatus();
  renderModeSelection();
  renderLogDates();
  renderLog();
  renderUpdate(state.update);
  renderProgress();
}

/** 새 버전 안내 띠. 백그라운드가 한 시간마다(그리고 팝업을 열 때) 확인해서 알려 준다. */
function renderUpdate(update) {
  const banner = $('updateBanner');
  if (!update) { banner.classList.add('hidden'); return; }
  const now = chrome.runtime.getManifest().version;
  if (IS_DESKTOP) {
    $('updateText').textContent = update.downloaded
      ? `✦ 새 버전 v${update.version} 을 받았어요 — 설치만 하면 끝 (지금 v${now})`
      : `✦ 새 버전 v${update.version} 을 받는 중이에요 (지금 v${now})`;
    $('btnUpdate').textContent = '⬇ 지금 설치';
  } else {
    // 확장은 새 버전을 찾는 즉시 zip 을 알아서 받아 둔다. 크롬이 사람 손을 요구하는 건 덮어쓰기 하나뿐이다.
    $('updateText').textContent = update.downloaded
      ? `✦ v${update.version} zip 을 받아 뒀어요 — 압축을 풀어 확장 폴더에 덮어쓰면 알아서 새 버전으로 켜져요 (지금 v${now})`
      : `✦ 새 버전 v${update.version} 을 받는 중이에요 (지금 v${now})`;
    $('btnUpdate').textContent = update.downloaded ? '⬇ 다시 받기' : '⬇ 업데이트 받기';
  }
  banner.classList.remove('hidden');
}

function send(message) {
  return chrome.runtime.sendMessage(message);
}

/** 밤/낮 · 이세계 테마 전환 — CSS 변수만 갈아 끼우면 전체가 따라온다. */
function applyTheme() {
  const dark = state.settings.darkMode !== false;
  const anime = state.settings.animeTheme !== false;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-anime', anime ? 'on' : 'off');
}

function bindEvents() {
  $('tabMain').addEventListener('click', () => showTab('main'));
  $('tabLog').addEventListener('click', () => showTab('log'));
  $('btnGear').addEventListener('click', () => $('advancedCard').classList.toggle('hidden'));

  $('btnAddAccount').addEventListener('click', addAccount);
  $('btnImportEnv').addEventListener('click', () => $('envModal').classList.remove('hidden'));
  $('btnEnvCancel').addEventListener('click', () => $('envModal').classList.add('hidden'));
  $('btnEnvOk').addEventListener('click', importEnv);
  $('btnSaveAccounts').addEventListener('click', saveAccounts);
  $('btnOpenTab').addEventListener('click', () => send({ type: 'openTabs', accountIds: selectedIds() }));
  $('btnCloseTab').addEventListener('click', () => send({ type: 'closeTabs', accountIds: selectedIds() }));
  $('btnSelectAll').addEventListener('click', toggleSelectAll);
  $('btnDeleteSelected').addEventListener('click', deleteSelected);
  $('btnUseActiveTab').addEventListener('click', useActiveTab);
  $('inputSearch').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderAccounts();
  });
  $('btnRun').addEventListener('click', onRun);
  $('btnPause').addEventListener('click', () => send({ type: 'pause' }));
  $('btnResume').addEventListener('click', () => send({ type: 'resume' }));
  $('btnStop').addEventListener('click', () => send({ type: 'stop' }));
  $('btnSavePos').addEventListener('click', async () => {
    const r = await send({ type: 'saveProgress', accountIds: selectedIds() });
    if (r && r.resume) state.resume = r.resume;
    flash($('btnSavePos'), '저장됨');
    renderProgress();
  });
  $('btnResumeRun').addEventListener('click', () => send({ type: 'resumeRun', accountIds: selectedIds() }));
  $('btnUpdate').addEventListener('click', async () => {
    flash($('btnUpdate'), '받는 중…');
    await send({ type: 'downloadUpdate' });
    showTab('log');
  });

  $('logDateSelect').addEventListener('change', (e) => {
    currentLogDate = e.target.value;
    renderLog();
  });
  $('btnSaveLog').addEventListener('click', saveLog);
  $('btnClearLog').addEventListener('click', async () => {
    await send({ type: 'clearLog', date: currentLogDate });
    delete state.logs[currentLogDate];
    renderLog();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'log') {
      if (!state.logs[msg.date]) state.logs[msg.date] = [];
      state.logs[msg.date].push(msg.line);
      if (msg.date === currentLogDate) appendLogLine(msg.line);
      else renderLogDates();
    } else if (msg.type === 'state') {
      state.sessions = msg.sessions;
      state.running = msg.running;
      renderAccounts();
      renderStatus();
      renderProgress();
    } else if (msg.type === 'update') {
      renderUpdate(msg.update);
    }
  });
}

function showTab(which) {
  $('tabMain').classList.toggle('active', which === 'main');
  $('tabLog').classList.toggle('active', which === 'log');
  $('pageMain').classList.toggle('hidden', which !== 'main');
  $('pageLog').classList.toggle('hidden', which !== 'log');
}

// ------------------------------------------------------------------ 계정

function selectedIds() {
  return state.accounts.filter((a) => a.enabled !== false).map((a) => a.id);
}

function sessionFor(id) {
  return state.sessions.find((s) => s.id === id) || null;
}

function renderAccounts() {
  const list = $('accountList');
  list.textContent = '';

  const visible = state.accounts.filter(
    (a) => !searchQuery || a.id.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  for (const account of visible) {
    const row = document.createElement('div');
    row.className = 'account-row';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = account.enabled !== false;
    check.addEventListener('change', async () => {
      account.enabled = check.checked;
      await send({ type: 'setAccounts', accounts: state.accounts });
      renderStatus();
    });
    check.addEventListener('click', (e) => e.stopPropagation());

    const grow = document.createElement('div');
    grow.className = 'grow';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = account.id;
    const stateLine = document.createElement('div');
    stateLine.className = 'state';

    const session = sessionFor(account.id);
    const sState = session ? session.state : 'off';
    stateLine.textContent = session
      ? (session.detail || stateLabel(sState)) + (session.paused ? ' · 일시정지' : '')
      : '탭 꺼짐';

    // 비밀번호: 가려 두고 👁 로 보기/숨기기
    const pwLine = document.createElement('div');
    pwLine.className = 'pw';
    const shown = shownPw.has(account.id);
    pwLine.textContent = account.pw ? (shown ? account.pw : '•'.repeat(Math.min(12, account.pw.length))) : '(비밀번호 없음)';
    if (shown) pwLine.classList.add('shown');
    const eye = document.createElement('button');
    eye.className = 'eye';
    eye.title = shown ? '비밀번호 숨기기' : '비밀번호 보기';
    eye.textContent = shown ? '🙈' : '👁';
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      if (shown) shownPw.delete(account.id); else shownPw.add(account.id);
      renderAccounts();
    });

    grow.append(name, stateLine, pwLine);

    const chip = document.createElement('span');
    chip.className = `chip ${sState}`;
    chip.textContent = chipLabel(sState);

    row.append(check, grow, eye, chip);
    row.addEventListener('click', () => {
      if (session && chrome.tabs) chrome.tabs.update(session.tabId, { active: true });
    });
    list.appendChild(row);
  }

  $('accountSummary').textContent = `계정 ${state.accounts.length} · 실행 ${state.running}`;
}

const shownPw = new Set();   // 비밀번호를 보이게 한 계정 (팝업이 열려 있는 동안만)

function stateLabel(s) {
  return { off: '탭 꺼짐', opening: '탭 여는 중', ready: '탭 열림', running: '진행 중', error: '오류' }[s] || s;
}

function chipLabel(s) {
  return { off: '꺼짐', opening: '여는 중', ready: '준비됨', running: '실행 중', error: '오류' }[s] || s;
}

async function addAccount() {
  const id = $('inputNewId').value.trim();
  const pw = $('inputNewPw').value.trim();
  if (!id) return;
  state.accounts = state.accounts.filter((a) => a.id !== id);
  state.accounts.push({ id, pw, enabled: true });
  await send({ type: 'setAccounts', accounts: state.accounts });
  $('inputNewId').value = '';
  $('inputNewPw').value = '';
  renderAccounts();
}

async function saveAccounts() {
  await send({ type: 'setAccounts', accounts: state.accounts });
  flash($('btnSaveAccounts'), '저장됨 ✓');
}

async function toggleSelectAll() {
  const allChecked = state.accounts.length > 0 && state.accounts.every((a) => a.enabled !== false);
  state.accounts = state.accounts.map((a) => ({ ...a, enabled: !allChecked }));
  await send({ type: 'setAccounts', accounts: state.accounts });
  renderAccounts();
  renderStatus();
}

async function deleteSelected() {
  const doomed = selectedIds();
  if (!doomed.length) return;
  await send({ type: 'closeTabs', accountIds: doomed });
  state.accounts = state.accounts.filter((a) => !doomed.includes(a.id));
  await send({ type: 'setAccounts', accounts: state.accounts });
  renderAccounts();
  renderStatus();
}

async function useActiveTab() {
  const first = selectedIds()[0];
  await send({ type: 'useActiveTab', accountId: first });
}

/** `.env` 형식 텍스트 파싱 — 파이썬 parse_accounts() 와 같은 규칙. */
function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    values[line.slice(0, eq).trim().toUpperCase()] =
      line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }

  const out = [];
  const ids = (values.CLASSCARD_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
  const pws = (values.CLASSCARD_PW || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < Math.min(ids.length, pws.length); i++) {
    out.push({ id: ids[i], pw: pws[i], enabled: true });
  }
  let n = 2;
  while (values[`CLASSCARD_ID_${n}`] && values[`CLASSCARD_PW_${n}`]) {
    out.push({ id: values[`CLASSCARD_ID_${n}`], pw: values[`CLASSCARD_PW_${n}`], enabled: true });
    n++;
  }

  const seen = new Set();
  return out.filter((a) => (seen.has(a.id) ? false : seen.add(a.id)));
}

async function importEnv() {
  const parsed = parseEnv($('envText').value);
  $('envModal').classList.add('hidden');
  if (!parsed.length) return;
  for (const account of parsed) {
    state.accounts = state.accounts.filter((a) => a.id !== account.id);
    state.accounts.push(account);
  }
  await send({ type: 'setAccounts', accounts: state.accounts });
  renderAccounts();
  renderStatus();
}

// ------------------------------------------------------------------ 모드

function buildModeGrid() {
  const grid = $('modeGrid');
  grid.textContent = '';
  for (const mode of MODES) {
    const button = document.createElement('button');
    button.className = 'mode-btn';
    button.textContent = mode.label;
    button.dataset.id = mode.id;
    button.addEventListener('click', () => {
      if (mode.id === 'fetch') {
        send({ type: 'fetchDict', accountIds: selectedIds() });
        return;
      }
      selectedModeId = mode.id;
      renderModeSelection();
    });
    grid.appendChild(button);
  }
}

function renderModeSelection() {
  for (const button of $('modeGrid').children) {
    button.classList.toggle('selected', button.dataset.id === selectedModeId);
  }
  const mode = MODES.find((m) => m.id === selectedModeId);
  $('modeHelp').textContent = mode ? mode.help : '';
}

// ------------------------------------------------------------------ 설정

function buildSettings() {
  const wrap = $('advancedList');
  wrap.textContent = '';

  for (const spec of SETTINGS) {
    const row = document.createElement('div');
    row.className = 'setting' + (spec.disabled ? ' disabled' : '');

    const grow = document.createElement('div');
    grow.className = 'grow';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = spec.title;
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = spec.sub;
    grow.append(title, sub);
    row.appendChild(grow);

    if (spec.type === 'choice') {
      // 두 가지 중 하나를 고르는 세그먼트 버튼 (예: 다크 / 화이트)
      const seg = document.createElement('div');
      seg.className = 'seg';
      const btnOn = document.createElement('button');
      const btnOff = document.createElement('button');
      btnOn.className = btnOff.className = 'seg-btn';
      btnOn.textContent = spec.labelOn;
      btnOff.textContent = spec.labelOff;

      const paint = (on) => {
        btnOn.classList.toggle('active', on);
        btnOff.classList.toggle('active', !on);
      };
      paint(state.settings[spec.key] !== false);

      const pick = (on) => () => {
        if ((state.settings[spec.key] !== false) === on) return;
        state.settings[spec.key] = on;
        send({ type: 'setSettings', patch: { [spec.key]: on } });
        paint(on);
        applyTheme();
      };
      btnOn.addEventListener('click', pick(true));
      btnOff.addEventListener('click', pick(false));

      seg.append(btnOn, btnOff);
      row.appendChild(seg);
    } else if (spec.type === 'toggle') {
      const label = document.createElement('label');
      label.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.disabled = !!spec.disabled;
      input.checked = spec.disabled
        ? !!spec.fixed
        : state.settings[spec.key] !== false;
      input.addEventListener('change', () => {
        send({ type: 'setSettings', patch: { [spec.key]: input.checked } });
        state.settings[spec.key] = input.checked;
        applyTheme();
      });
      const slider = document.createElement('span');
      slider.className = 'slider';
      label.append(input, slider);
      row.appendChild(label);
    } else {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.value = state.settings[spec.key] ?? 0;
      input.addEventListener('change', () => {
        const value = Math.max(0, parseInt(input.value, 10) || 0);
        input.value = value;
        state.settings[spec.key] = value;
        send({ type: 'setSettings', patch: { [spec.key]: value } });
      });
      row.appendChild(input);
    }

    wrap.appendChild(row);
  }
}

// ------------------------------------------------------------------ 실행

function onRun() {
  if (state.running > 0) {
    send({ type: 'stop' });
    return;
  }
  const ids = selectedIds();
  if (!ids.length) return;
  send({ type: 'run', modeId: selectedModeId, accountIds: ids });
}

/** 진행률 카드: 세션마다 현재/전체 · % · 막대 · 남은 수 · 성공/실패/미처리. 없으면 저장된 진행 위치를 보여 준다. */
function renderProgress() {
  const list = $('progressList');
  list.textContent = '';
  const sessions = state.sessions.filter((s) => s.progress || s.running);
  const anyPaused = state.sessions.some((s) => s.running && s.paused);
  const anyRunning = state.sessions.some((s) => s.running && !s.paused);
  $('btnPause').disabled = !anyRunning;
  $('btnResume').disabled = !anyPaused;
  $('btnStop').disabled = !(state.running > 0);
  const resumable = selectedIds().some((id) => state.resume && state.resume[id]);
  $('btnResumeRun').disabled = !resumable || state.running > 0;
  $('progressHint').textContent = anyPaused ? '일시정지 중' : (state.running > 0 ? '실행 중' : '');

  for (const s of sessions) {
    const p = s.progress || { current: 0, total: 0, ok: 0, fail: 0, skipped: 0, label: '' };
    const pct = p.total > 0 ? Math.min(100, Math.round((p.current / p.total) * 100)) : 0;
    const left = Math.max(0, p.total - p.current);
    const row = document.createElement('div');
    row.className = 'prog-row';
    row.innerHTML =
      `<div class="prog-head"><span class="who"></span><span class="mode"></span><span class="pct">${pct}%</span></div>` +
      `<div class="prog-nums"><span>현재: <b>${p.current} / ${p.total}</b></span><span>진행률: <b>${pct}%</b></span><span>남은 항목: <b>${left}</b></span></div>` +
      `<div class="prog-bar${s.paused ? ' paused' : ''}"><div style="width:${pct}%"></div></div>` +
      `<div class="prog-counts"><span class="ok">성공 ${p.ok}</span><span class="fail">실패 ${p.fail}</span><span class="todo">미처리 ${p.skipped}</span></div>`;
    row.querySelector('.who').textContent = s.id;
    row.querySelector('.mode').textContent = (p.label || modeLabel(s.modeId) || '') + (s.paused ? ' · ⏸ 일시정지' : (s.running ? '' : ' · 끝남'));
    list.appendChild(row);
  }
  if (!sessions.length) {
    const saved = Object.entries(state.resume || {});
    const empty = document.createElement('div');
    empty.className = 'prog-empty';
    if (saved.length) {
      empty.textContent = '저장된 진행 위치: ' + saved.map(([id, e]) => {
        const p = e.progress;
        return `${id} — ${modeLabel(e.modeId)}${p ? ` ${p.current}/${p.total}` : ''} (${new Date(e.savedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })})`;
      }).join(' · ') + ' → [이어하기]';
    } else {
      empty.textContent = '진행 중인 자동화가 없습니다. 자동화를 시작하면 여기에 진행률이 표시됩니다.';
    }
    list.appendChild(empty);
  }
}

function modeLabel(id) {
  const m = MODES.find((x) => x.id === id);
  return m ? m.label.replace(/^\S+\s/, '') : (id || '');
}

function renderStatus() {
  const running = state.running;
  $('statusDot').classList.toggle('on', running > 0);
  $('statusText').textContent = running > 0 ? `자동화 실행 중 (${running})` : '대기 중';
  const button = $('btnRun');
  button.classList.toggle('stop', running > 0);
  button.innerHTML = running > 0 ? '■&nbsp;&nbsp;자동화 중지' : '▶&nbsp;&nbsp;자동화 시작';
  $('accountSummary').textContent = `계정 ${state.accounts.length} · 실행 ${running}`;
}

// ------------------------------------------------------------------ 로그

function renderLogDates() {
  const dates = Object.keys(state.logs).sort().reverse();
  if (!dates.length) dates.push(state.today);
  if (!dates.includes(currentLogDate)) currentLogDate = dates[0];

  const select = $('logDateSelect');
  select.textContent = '';
  for (const date of dates) {
    const option = document.createElement('option');
    option.value = date;
    option.textContent = date;
    select.appendChild(option);
  }
  select.value = currentLogDate;
}

function renderLog() {
  const console_ = $('logConsole');
  console_.textContent = '';
  for (const line of state.logs[currentLogDate] || []) appendLogLine(line, true);
  console_.scrollTop = console_.scrollHeight;
}

function appendLogLine(line, skipScroll) {
  const console_ = $('logConsole');
  const time = document.createElement('span');
  time.className = 't';
  time.textContent = `[${line.time}] `;
  const body = document.createElement('span');
  body.className = line.level || 'info';
  body.textContent = `${line.message}\n`;
  console_.append(time, body);
  if (!skipScroll) console_.scrollTop = console_.scrollHeight;
}

function saveLog() {
  const text = (state.logs[currentLogDate] || [])
    .map((l) => `[${l.time}] ${l.message}`)
    .join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  chrome.downloads
    ? chrome.downloads.download({ url, filename: `classcard-${currentLogDate}.log` })
    : triggerAnchorDownload(url, `classcard-${currentLogDate}.log`);
}

function triggerAnchorDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function flash(button, text) {
  const original = button.textContent;
  button.textContent = text;
  setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

init();
