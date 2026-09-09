/**
 * 팝업 UI — 안드로이드 앱과 같은 화면 구성.
 * 실제 자동화는 background.js 에서 돌고, 여기서는 상태를 보여주고 명령만 보낸다.
 */

const MODES = [
  { id: 'auto_all', label: '⚡ 전체 자동화', help: '단어장 목록 페이지에서 맨 아래 set부터 순서대로 전 과정을 자동 수행합니다.' },
  { id: 'one_set', label: '◎ 한 세트 자동화', help: '셋홈(set 상세) 페이지를 열어둔 상태에서 그 한 세트만 전 과정을 수행합니다.' },
  { id: 'memorize', label: '🗂 암기', help: '암기 학습 화면에 들어간 상태에서 실행하세요.' },
  { id: 'recall', label: '🔁 리콜', help: '리콜 학습 화면에 들어간 상태에서 실행하세요.' },
  { id: 'spell', label: '⌨ 스펠', help: '스펠 학습 화면에서 실행하세요. 단어장이 없으면 자동으로 가져옵니다.' },
  { id: 'memorize_sentence', label: '📖 문장 암기', help: '문장 암기 화면에 들어간 상태에서 실행하세요.' },
  { id: 'recall_sentence', label: '📝 문장 리콜', help: '문장 리콜 화면에서 실행하세요. 정답은 페이지 로그에서 자동으로 캡처합니다.' },
  { id: 'test', label: '🃏 단어 테스트', help: '단어 테스트 문제 화면에서 실행하세요. 70점 초과를 보장하며 일부는 일부러 틀립니다.' },
  { id: 'test_sentence', label: '📕 문장 테스트', help: '문장 테스트 문제 화면에서 실행하세요. 신뢰된 클릭이 필요해 디버거가 잠깐 연결됩니다.' },
  { id: 'matching', label: '🎴 단어 매칭', help: '매칭 게임 화면에서 실행하세요. 목표 점수에 도달하면 중도 종료합니다.' },
  { id: 'scramble', label: '✳ 문장 스크램블', help: '스크램블 게임 화면에서 실행하세요. 목표 점수에 도달하면 종료합니다.' },
  { id: 'grammar', label: '📐 문법', help: '문법훈련 클래스 페이지에서 실행하면 유닛의 단계를 순서대로 진행합니다. 문제 화면에서 바로 실행해도 됩니다.' },
  { id: 'fetch', label: '⤵ 단어장 가져오기', help: '현재 열린 학습 페이지에서 단어/뜻 데이터를 추출해 저장합니다.' },
];

const SETTINGS = [
  {
    key: 'darkMode', title: '화면 테마', sub: '다크 / 화이트 중에서 고르세요',
    type: 'choice', labelOn: '🌙 다크', labelOff: '☀ 화이트',
  },
  { key: 'autoLogin', title: '자동 로그인', sub: '저장된 ID/PW로 탭을 열 때 바로 로그인', type: 'toggle' },
  { key: 'keepTab', title: '자동화 후 탭 유지', sub: '끄면 자동화가 끝날 때 탭을 닫음', type: 'toggle' },
  { key: 'sequential', title: '다계정 순차 실행', sub: '크롬은 쿠키를 공유하므로 계정을 하나씩 실행 (끌 수 없음)', type: 'toggle', disabled: true, fixed: true },
  { key: 'hotkey', title: '전역 단축키 사용', sub: 'Ctrl+A / Ctrl+I / Ctrl+E … (확장프로그램 미지원)', type: 'toggle', disabled: true, fixed: false },
  { key: 'startDelaySec', title: '시작 지연시간 (초)', sub: '시작 버튼을 누른 뒤 대기할 시간', type: 'number' },
  { key: 'accountGapSec', title: '계정별 실행 간격 (초)', sub: '다계정 순차 실행 시 간격', type: 'number' },
];

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
  applyTheme(state.settings.darkMode !== false);

  buildSettings();
  renderAccounts();
  renderStatus();
  renderModeSelection();
  renderLogDates();
  renderLog();
}

function send(message) {
  return chrome.runtime.sendMessage(message);
}

/** 다크/라이트 전환 — CSS 변수만 갈아 끼우면 전체가 따라온다. */
function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
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
      ? (session.detail || stateLabel(sState))
      : '탭 꺼짐';

    grow.append(name, stateLine);

    const chip = document.createElement('span');
    chip.className = `chip ${sState}`;
    chip.textContent = chipLabel(sState);

    row.append(check, grow, chip);
    row.addEventListener('click', () => {
      if (session) chrome.tabs.update(session.tabId, { active: true });
    });
    list.appendChild(row);
  }

  $('accountSummary').textContent = `계정 ${state.accounts.length} · 실행 ${state.running}`;
}

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
        if (spec.key === 'darkMode') applyTheme(on);
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
        if (spec.key === 'darkMode') applyTheme(input.checked);
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
