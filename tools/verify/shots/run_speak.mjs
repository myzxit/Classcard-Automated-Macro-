// 클래스 테스트(문장 테스트) 모의 회귀 — 난수 클래스 타일 · 지워지는 정답 · 묶음 제시를 흉내 낸 화면에서
// 매크로가 모든 문항을 100점으로 푸는지 본다.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const EXT = '/home/user/Classcard-Automated-Macro-/extension', OUT = '/tmp/shots';
const mock = readFileSync('/tmp/shots/mock_speak.html', 'utf8');

const ctx = await chromium.launchPersistentContext('/tmp/shots/profileSPEAK', {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
});
await ctx.route('https://www.classcard.net/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: mock }));

const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
const id = new URL(sw.url()).host;
await sw.evaluate(() => chrome.storage.local.set({ settings: { autoLogin: false, keepTab: true } }));

const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0,140)));
page.on('console', (m) => { if (m.type()==='error') console.log('CONSOLEERR', m.text().slice(0,140)); });
await page.setViewportSize({ width: 1000, height: 760 });
await page.goto('https://www.classcard.net/Paragraph/30378310/0/0/1994042');
await page.waitForTimeout(700);
// 녹음 시간을 짧게 (기본 6초면 모의에서 너무 오래 걸린다)
await sw.evaluate(() => chrome.storage.local.set({ settings: { autoLogin: false, keepTab: true, speakingRecordSec: 2 } }));

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
  await page.waitForFunction(() => ['read','comp','listen'].every((m) => {
    const b = document.querySelector('.btn-start-study[data-mode="' + m + '"]');
    return b && parseInt(b.dataset.cnt, 10) > 0;
  }), { timeout: 120000 });
  const st = await page.evaluate(() => ({
    cnts: [].map.call(document.querySelectorAll('.btn-start-study'), (b) => b.dataset.mode + ':' + b.dataset.cnt).join(' '),
    opt: !!(document.querySelector('.start-opt-body') || {}).offsetParent,
  }));
  console.log(`결과: 듣기단계 3종 완주 · ${st.cnts} · 시작화면 복귀 ${st.opt ? '됨' : '안 됨'}`);
  await page.screenshot({ path: `${OUT}/speak-done.png` });
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
  await page.screenshot({ path: `${OUT}/speak-timeout.png` });
}
await popup.bringToFront();
await popup.click('#tabLog');
await popup.waitForTimeout(400);
console.log('SW alive:', ctx.serviceWorkers().length, 'workers');
try { console.log('SW ping:', await ctx.serviceWorkers()[0].evaluate(() => typeof chrome !== 'undefined')); } catch (e) { console.log('SW ping 실패:', String(e.message).slice(0,90)); }
console.log('--- 로그 ---');
console.log((await popup.textContent('#logConsole')).trim().split('\n').slice(-25).join('\n'));
await ctx.close();
