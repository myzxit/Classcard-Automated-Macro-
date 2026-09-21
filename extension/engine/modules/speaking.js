/**
 * 스피킹 자동화 (단어 세트 · 문장 세트 공통) — 파이썬 원본 없음.
 *
 * 스피킹은 세트 화면의 '스피킹' 버튼이 여는 `/Paragraph/{set}/0/0/{class}` 화면이다
 * (사이트 스크립트: scripts/v3/paragraph_v2.js 와 paragraph_{read,comp,listen,aloud,shadow,record}_v2.js).
 *
 * 단계는 여섯 가지고, 시작 화면의 `.btn-start-study[data-mode="…"]` 로 고른다:
 *   read(입해석) · comp(입영작) · listen(집중듣기) · aloud(낭독) · shadow(쉐도잉) · record(녹음)
 * 고르면 `.study-wrapper` 의 클래스가 그 단계 이름으로 바뀌고 `.study-body > div.<단계>.active` 가 열린다.
 * 카드는 `.study-body .CardItem.active`, 이동은 `.btn-next-card`,
 * 소리는 `.btn-bottom-audio`(재생) / `.btn-bottom-audio-stop`, 녹음은 `.btn-bottom-record` 다.
 * 진행 기록은 `/ParagraphAsync/saveParagraphCardLog` 로 카드마다 올라간다.
 *
 * **낭독·쉐도잉·녹음은 마이크가 필요하다.** 이 세 단계는 setMode 가 `getUserMedia` 를 먼저 부르고,
 * 실패하면 아예 시작되지 않는다. 그리고 녹음한 **목소리 파일이 그대로 올라가** 선생님께 전달되고
 * 자동 채점된다(`audio_data[]`, `record_path[]`, `aloud_path[]`).
 * 그래서 이 매크로는 목소리를 지어내지 않는다. 대신 **녹음 말고 나머지를 전부 대신 해 준다**:
 * 카드 열기 · 예문 소리 끝까지 듣기 · 녹음 시작/정지 · 다음 카드. 말하는 것만 직접 하면 된다.
 * (녹음 단계는 고급 설정의 '스피킹 녹음 단계' 를 켜야 진행한다. 지금은 단계의 **마지막 카드에서 멈추는**
 *  문제가 남아 있어 기본은 꺼져 있다 — 입해석·입영작·집중듣기는 끝까지 정상 동작한다.)
 */

import { reportCardProgress } from './basic.js';

/** 마이크가 필요해 사람이 직접 말해야 하는 단계 */
export const MIC_MODES = ['aloud', 'shadow', 'record'];
/** 매크로가 혼자 끝까지 할 수 있는 단계 (듣고 넘기기만 하면 된다) */
export const AUTO_MODES = ['read', 'comp', 'listen'];

const MODE_LABEL = {
  read: '입해석', comp: '입영작', listen: '집중듣기',
  aloud: '낭독', shadow: '쉐도잉', record: '녹음',
};

/** 화면 상태 한 번에 읽기 */
const SPEAK_STATE_JS = String.raw`
function vis(el) { return !!el && el.offsetParent !== null; }
var out = { modes: [], mode: null, opt: false, card: false, cards: 0, idx: 0, last: false,
            playing: false, recording: false, modal: false, end: false };
var modal = document.querySelector('#alertModal');
var confirmEl = document.querySelector('#confirmModal');
out.modal = (!!modal && window.getComputedStyle(modal).display === 'block') ||
            (!!confirmEl && window.getComputedStyle(confirmEl).display === 'block');
var btns = document.querySelectorAll('.btn-start-study[data-mode]');
for (var i = 0; i < btns.length; i++) {
    var m = btns[i].getAttribute('data-mode');
    if (!m || m === 'end') continue;
    var c = parseInt(btns[i].getAttribute('data-cnt'), 10);
    out.modes.push({ mode: m, cnt: isNaN(c) ? 0 : c, visible: vis(btns[i]) });
}
out.opt = vis(document.querySelector('.start-opt-body'));
var wrap = document.querySelector('.study-wrapper');
if (wrap) {
    var names = ['read', 'comp', 'listen', 'aloud', 'shadow', 'record'];
    for (var j = 0; j < names.length; j++) if (wrap.classList.contains(names[j])) out.mode = names[j];
    out.end = wrap.classList.contains('end');
}
var cards = document.querySelectorAll('.study-body .CardItem');
out.cards = cards.length;
var card = document.querySelector('.study-body .CardItem.active') || document.querySelector('.CardItem.active');
if (card && vis(card)) {
    out.card = true;
    out.idx = Array.prototype.indexOf.call(cards, card) + 1;
    out.last = out.idx >= cards.length;
    out.key = String(out.idx) + ':' + (card.getAttribute('data-idx') || '');
}
// 듣기·녹음 버튼은 카드 안이 아니라 화면 아래(푸터)에 있다 — 문서 전체에서 보이는 것을 찾는다
function visIn(sel) {
    var els = document.querySelectorAll(sel);
    for (var k = 0; k < els.length; k++) if (vis(els[k])) return true;
    return false;
}
out.hasAudio = visIn('.btn-bottom-audio, .btn-audio-all');
out.hasRecord = visIn('.btn-bottom-record, .btn-audio-record');
out.playing = !!(window.audio && window.audio.src && !window.audio.paused && !window.audio.ended);
out.recording = !!document.querySelector('.btn-bottom-audio-stop:not(.hidden), .recording, .is-recording');
return out;`;

async function speakState(d) {
  const s = await d.eval(SPEAK_STATE_JS);
  return s && typeof s === 'object' ? s : null;
}

/** 시작 화면에서 그 단계를 고른다 */
async function startMode(d, mode) {
  return d.clickSmart(`
    var b = document.querySelector('.btn-start-study[data-mode="${mode}"]');
    if (b && b.offsetParent !== null) el = b;`);
}

/** 화면 아래의 버튼 하나를 누른다 */
async function clickBottom(d, sel) {
  return d.clickSmart(`
    var btns = document.querySelectorAll(${JSON.stringify(sel)});
    for (var i = 0; i < btns.length; i++) if (btns[i].offsetParent !== null) { el = btns[i]; break; }`);
}

async function closeModal(d) {
  return d.clickSmart(`
    var sels = ['#alertModal .btn-ok', '#confirmModal .btn-ok', '.modal-content .btn-ok'];
    for (var i = 0; i < sels.length && !el; i++) {
        var btns = document.querySelectorAll(sels[i]);
        for (var j = 0; j < btns.length; j++) {
            if (btns[j].offsetParent !== null && !btns[j].classList.contains('close-pos')) { el = btns[j]; break; }
        }
    }`);
}


/**
 * 오래 기다리는 동안에도 브라우저에 말을 건다.
 *
 * 크롬 확장(MV3)의 배경 스크립트는 한동안 아무 일도 안 하면 브라우저가 꺼 버린다.
 * 그냥 `setTimeout` 으로만 기다리면 그 사이에 꺼져서 자동화가 조용히 멈춘다(로그도 안 남는다).
 * 그래서 기다리는 동안 짧게 끊어 가며 페이지를 한 번씩 읽는다.
 */
async function sleepAwake(d, stop, ms) {
  let left = ms;
  while (left > 0) {
    const slice = Math.min(500, left);
    if (await stop.await(slice)) return true;
    left -= slice;
    await d.evalBool('return true;');       // 브라우저를 깨워 둔다
  }
  return stop.isSet;
}

/** 예문 소리를 끝까지 듣는다 (중간에 끊지 않는다). */
async function waitAudioEnd(d, stop, maxMs = 30000) {
  let waited = 0;
  // 재생이 시작될 때까지 잠깐
  while (waited < 3000) {
    if (await stop.await(200)) return;
    waited += 200;
    if (await d.evalBool('return !!(window.audio && window.audio.src && !window.audio.paused);')) break;
  }
  waited = 0;
  while (waited < maxMs) {
    if (await stop.await(250)) return;
    waited += 250;
    const playing = await d.evalBool(
      'return !!(window.audio && window.audio.src && !window.audio.paused && !window.audio.ended);',
    );
    if (!playing) return;
  }
}

/** 카드가 바뀌거나 단계가 끝날 때까지 기다린다: 'changed' | 'done' | 'stopped' | 'stuck' */
async function waitCardChange(d, stop, prevKey, timeout = 4000) {
  let elapsed = 0;
  while (elapsed < timeout) {
    if (await stop.await(250)) return 'stopped';
    elapsed += 250;
    const s = await speakState(d);
    if (!s) continue;
    if (s.end || s.opt) return 'done';
    if (s.card && s.key !== prevKey) return 'changed';
  }
  return 'stuck';
}

/**
 * 한 단계를 끝까지 진행한다.
 * @param {string} mode read|comp|listen|aloud|shadow|record
 * @param {number} recordSec 마이크 단계에서 한 카드마다 말할 시간(초)
 */
async function runOneMode(d, stop, mode, recordSec) {
  const label = MODE_LABEL[mode] || mode;
  const needsMic = MIC_MODES.includes(mode);
  if (!(await startMode(d, mode))) {
    d.log(`[스피킹] ${label} 단계를 열지 못했습니다 — 건너뜁니다`, 'warn');
    return false;
  }
  d.log(`[스피킹] ${label} 시작${needsMic ? ' — 마이크 단계입니다. 소리가 끝나면 말씀하세요.' : ''}`);
  if (await stop.await(1500)) return false;

  let sameCount = 0;
  let lastKey = '';
  while (!stop.isSet) {
    const s = await speakState(d);
    if (!s) { if (await stop.await(400)) break; continue; }

    if (s.modal) {                       // '마이크 가까이 또박또박' 같은 안내
      await closeModal(d);
      if (await stop.await(800)) break;
      continue;
    }
    if (s.end || s.opt) { d.log(`[스피킹] ${label} 끝`); return true; }
    if (!s.card) { if (await stop.await(400)) break; continue; }
    if (s.mode && s.mode !== mode) { d.log(`[스피킹] ${label} 끝 (화면이 바뀌었습니다)`); return true; }

    d.progress({ current: s.idx, total: s.cards, ok: s.idx - 1, fail: 0,
      skipped: Math.max(0, s.cards - s.idx), label: `스피킹 ${label}` });

    if (s.key === lastKey) {
      sameCount += 1;
      if (sameCount === 40) {
        d.log(`[스피킹] ${label} 진행이 멈췄습니다 — 화면: ${JSON.stringify({ idx: s.idx, cards: s.cards, mode: s.mode }).slice(0, 160)}`, 'warn');
        await clickBottom(d, '.btn-next-card');
      }
    } else { sameCount = 0; lastKey = s.key; }

    // 1) 예문 소리를 끝까지 듣는다
    if (s.hasAudio) {
      await clickBottom(d, '.btn-bottom-audio, .btn-audio-all');
      await waitAudioEnd(d, stop);
      if (stop.isSet) break;
    }

    // 2) 마이크 단계면 녹음을 걸어 두고 말할 시간을 준다 (목소리는 사용자 본인 것이다)
    if (needsMic && s.hasRecord) {
      if (await clickBottom(d, '.btn-bottom-record, .btn-audio-record')) {
        d.log(`[스피킹] ${label} ${s.idx}/${s.cards} — 지금 말씀하세요 (${recordSec}초)`);
        if (await sleepAwake(d, stop, recordSec * 1000)) break;
        await clickBottom(d, '.btn-bottom-audio-stop, .btn-bottom-record');
        if (await sleepAwake(d, stop, 800)) break;
      }
    }

    // 3) 다음 카드
    await clickBottom(d, '.btn-next-card');
    const r = await waitCardChange(d, stop, s.key);
    if (r === 'stopped') break;
    if (r === 'done') { d.log(`[스피킹] ${label} 끝`); return true; }
    if (r === 'stuck') { await d.blurActiveElement(); await d.pressSpace(); }
  }
  return !stop.isSet;
}

/**
 * 스피킹 자동화.
 *
 * `opts.includeMic` 가 false 면 마이크가 필요한 단계(낭독·쉐도잉·녹음)는 건너뛴다.
 * `opts.recordSec` 는 마이크 단계에서 카드마다 말할 시간(초).
 */
export async function speaking(d, answerDict, stop, opts = {}) {
  const includeMic = opts.includeMic !== false;
  const recordSec = Number(opts.recordSec) > 0 ? Number(opts.recordSec) : 6;
  d.log('[스피킹] 시작');
  try {
    // 시작 화면이 아니면(이미 한 단계 안이면) 그 단계부터 이어서 한다
    let s = await speakState(d);
    if (!s) { d.log('[스피킹] 스피킹 화면이 아닙니다 (세트 화면의 [스피킹] 을 먼저 누르세요)', 'error'); return; }
    if (!s.modes.length) {
      d.log('[스피킹] 단계 버튼을 찾지 못했습니다 — 스피킹 화면이 맞는지 확인하세요', 'error');
      return;
    }

    const wanted = s.modes
      .map((m) => m.mode)
      .filter((m) => AUTO_MODES.includes(m) || MIC_MODES.includes(m))
      .filter((m) => includeMic || !MIC_MODES.includes(m));
    const skipped = s.modes.map((m) => m.mode).filter((m) => MIC_MODES.includes(m) && !includeMic);

    d.log(`[스피킹] 할 단계: ${wanted.map((m) => MODE_LABEL[m] || m).join(' · ') || '없음'}`);
    if (skipped.length) {
      d.log(`[스피킹] 건너뛸 단계(마이크 필요): ${skipped.map((m) => MODE_LABEL[m] || m).join(' · ')}`);
    }
    if (includeMic) {
      d.log('[스피킹] 낭독·쉐도잉·녹음은 목소리가 그대로 선생님께 올라갑니다 — 매크로는 소리 재생과 녹음 시작/정지만 대신하고, 말하기는 직접 하셔야 합니다.', 'warn');
    }

    for (const mode of wanted) {
      if (stop.isSet) break;
      // 단계를 고르려면 시작 화면이어야 한다
      s = await speakState(d);
      if (s && !s.opt && s.mode) {
        await clickBottom(d, '.btn-start-study.end, .btn-back');
        if (await stop.await(1200)) break;
      }
      await runOneMode(d, stop, mode, recordSec);
      if (await stop.await(1200)) break;
    }
    if (!stop.isSet) d.log('[스피킹] 할 수 있는 단계를 모두 마쳤습니다', 'success');
  } catch (e) {
    if (!stop.isSet) d.log(`[스피킹] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[스피킹] 종료');
  }
}

/** 마이크 단계를 뺀 스피킹 (듣고 넘기는 단계만) */
export async function speakingNoMic(d, answerDict, stop) {
  return speaking(d, answerDict, stop, { includeMic: false });
}
