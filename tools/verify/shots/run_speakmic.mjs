// 진단용 — run.sh 의 기본 목록에는 없다. 손으로 돌린다:
//   cp tools/verify/shots/* /tmp/shots/ && cd /tmp/shots && xvfb-run -a node run_speakmic.mjs
//
// 스피킹의 마이크 단계(낭독·쉐도잉·녹음)까지 켜고 돌려서, 크롬이 배경 작업을 재우는 바람에
// 자동화가 조용히 서는 문제를 재현한다. 'SW CLOSED' 가 찍히는 시각이 핵심이다 —
// 카드 수나 녹음 시간을 바꿔도 언제나 **스피킹을 시작한 지 30초쯤**이다
// (그래서 오래 '마지막 카드' 문제로 본 것은 틀린 진단이었다).
// mock_speak.html 의 CARDS 를 5장으로 늘려 두면 두 번째 카드에서 서는 것을 볼 수 있다.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const EXT = '/home/user/Classcard-Automated-Macro-/extension', OUT = '/tmp/shots';
const mock = readFileSync('/tmp/shots/mock_speak.html', 'utf8');

const ctx = await chromium.launchPersistentContext('/tmp/shots/profileSPEAKMIC', {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
});
await ctx.route('https://www.classcard.net/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: mock }));

let sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
for (let t = 0; t < 40 && !sw; t++) { await new Promise((r) => setTimeout(r, 500)); sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')); }
const id = new URL(sw.url()).host;
for (let t = 0; t < 20; t++) { try { await sw.evaluate(() => chrome.storage.local.set({ settings: { autoLogin: false, keepTab: true } })); break; } catch (e) { await new Promise((r) => setTimeout(r, 500)); } }

ctx.on('serviceworker', (w) => console.log('SW NEW', new Date().toISOString(), w.url().slice(-30)));
sw.on('close', () => console.log('SW CLOSED', new Date().toISOString()));
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0,140)));
page.on('console', (m) => { if (m.type()==='error') console.log('CONSOLEERR', m.text().slice(0,140)); });
await page.setViewportSize({ width: 1000, height: 760 });
await page.goto('https://www.classcard.net/Paragraph/30378310/0/0/1994042');
await page.waitForTimeout(700);
// 녹음 시간을 짧게 (기본 6초면 모의에서 너무 오래 걸린다)
for (let t = 0; t < 20; t++) { try { await sw.evaluate(() => chrome.storage.local.set({ settings: { autoLogin: false, keepTab: true, speakingMic: true, speakingRecordSec: 1 } })); break; } catch (e) { await new Promise((r) => setTimeout(r, 500)); } }

const popup = await ctx.newPage();
await popup.setViewportSize({ width: 800, height: 640 });
await popup.goto(`chrome-extension://${id}/popup/popup.html`);
await popup.waitForTimeout(700);
await popup.fill('#inputNewId', 'student01');
await popup.fill('#inputNewPw', 'pw1');
await popup.click('#btnAddAccount');
await popup.waitForTimeout(250);
await page.bringToFront(); await page.waitForTimeout(200);
await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'useActiveTab', accountId: 'student01' }));
await popup.waitForTimeout(400);
await popup.bringToFront();
await popup.click('.mode-btn[data-id="speaking"]');
await popup.waitForTimeout(150);
await popup.click('#btnRun');
await page.bringToFront();

try {
  await page.waitForFunction(() => ['read','comp','listen','aloud','shadow','record'].every((m) => {
    const b = document.querySelector('.btn-start-study[data-mode="' + m + '"]');
    return b && parseInt(b.dataset.cnt, 10) > 0;
  }), { timeout: 200000 });
  const st = await page.evaluate(() => ({
    cnts: [].map.call(document.querySelectorAll('.btn-start-study'), (b) => b.dataset.mode + ':' + b.dataset.cnt).join(' '),
    opt: !!(document.querySelector('.start-opt-body') || {}).offsetParent,
  }));
  console.log(`결과: 마이크 포함 6단계 완주 · ${st.cnts} · 시작화면 복귀 ${st.opt ? '됨' : '안 됨'}`);
  await page.screenshot({ path: `${OUT}/speakmic-done.png` });
} catch (e) {
  console.log('결과: 완주 못함 · 현재 ' + JSON.stringify(await page.evaluate(() => ({
    wrap: (document.querySelector('.study-wrapper') || {}).className,
    opt: !!(document.querySelector('.start-opt-body') && document.querySelector('.start-opt-body').offsetParent),
    cards: document.querySelectorAll('.study-body .CardItem').length,
    active: document.querySelectorAll('.study-body .CardItem.active').length,
    modal: document.querySelector('#alertModal') ? getComputedStyle(document.querySelector('#alertModal')).display : null,
    footer: document.getElementById('footer') ? document.getElementById('footer').style.display : null,
    cnts: [].map.call(document.querySelectorAll('.btn-start-study'), function(b){return b.dataset.mode+':'+b.dataset.cnt;}),
  }))));
  await page.screenshot({ path: `${OUT}/speakmic-timeout.png` });
}
await popup.bringToFront();
await popup.click('#tabLog');
await popup.waitForTimeout(400);
console.log('SW alive:', ctx.serviceWorkers().length, 'workers');
try { console.log('SW ping:', await ctx.serviceWorkers()[0].evaluate(() => typeof chrome !== 'undefined')); } catch (e) { console.log('SW ping 실패:', String(e.message).slice(0,90)); }
console.log('--- 로그 ---');
console.log((await popup.textContent('#logConsole')).trim().split('\n').slice(-40).join('\n'));
await ctx.close();
