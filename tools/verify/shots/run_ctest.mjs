// 클래스 테스트(문장 테스트) 모의 회귀 — 난수 클래스 타일 · 지워지는 정답 · 묶음 제시를 흉내 낸 화면에서
// 매크로가 모든 문항을 100점으로 푸는지 본다.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const EXT = '/home/user/Classcard-Automated-Macro-/extension', OUT = '/tmp/shots';
const mock = readFileSync('/tmp/shots/mock_ctest.html', 'utf8');

const ctx = await chromium.launchPersistentContext('/tmp/shots/profileCTEST', {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
});
await ctx.route('https://www.classcard.net/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: mock }));

const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
const id = new URL(sw.url()).host;
await sw.evaluate(() => chrome.storage.local.set({ settings: { autoLogin: false, keepTab: true } }));

const page = await ctx.newPage();
await page.setViewportSize({ width: 1000, height: 760 });
await page.goto('https://www.classcard.net/ClassTest/1994042/30378310?p=1&ex=1');
await page.waitForTimeout(700);

// preload 가 정답을 지워지기 전에 챙겼는지 (이게 이 화면의 핵심)
const captured = await page.evaluate(() => Object.keys(window.__cc_test_answers || {}).length);
const leftInDom = await page.evaluate(() => document.querySelectorAll('.answer.hidden').length);

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
await popup.click('.mode-btn[data-id="test_sentence"]');
await popup.waitForTimeout(150);
await popup.click('#btnRun');
await page.bringToFront();

try {
  await page.waitForFunction(() => {
    const d = document.getElementById('done');
    return d && getComputedStyle(d).display !== 'none';
  }, { timeout: 180000 });
  const stat = await page.textContent('#stat');
  console.log(`결과: ${stat} · 정답 미리 확보 ${captured}개(DOM 잔존 ${leftInDom})`);
  await page.screenshot({ path: `${OUT}/ctest-done.png` });
} catch (e) {
  console.log(`결과: 완주 못함 · 정답 미리 확보 ${captured}개 · 현재 ` +
    await page.evaluate(() => (document.querySelectorAll('.test-sentence-input span').length + '낱말')));
  await page.screenshot({ path: `${OUT}/ctest-timeout.png` });
}
await popup.bringToFront();
await popup.click('#tabLog');
await popup.waitForTimeout(400);
console.log('--- 로그 ---');
console.log((await popup.textContent('#logConsole')).trim().split('\n').slice(-10).join('\n'));
await ctx.close();
