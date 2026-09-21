import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const EXT='/home/user/Classcard-Automated-Macro-/extension', OUT='/tmp/shots';
const mock = readFileSync('/tmp/shots/mock_matching.html','utf8');

const ctx = await chromium.launchPersistentContext('/tmp/shots/profileMATCH',{headless:false,
  args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`,'--no-sandbox']});
await ctx.route('https://www.classcard.net/**', r =>
  r.fulfill({status:200, contentType:'text/html; charset=utf-8', body:mock}));

const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker',{timeout:20000});
const id = new URL(sw.url()).host;
await sw.evaluate(() => chrome.storage.local.set({ settings:{ autoLogin:false, keepTab:true } }));

const page = await ctx.newPage();
await page.setViewportSize({width:1000,height:760});
await page.goto('https://www.classcard.net/GclassTest/grammarTalk/127657/2634371/7914661');
await page.waitForTimeout(500);

const popup = await ctx.newPage();
await popup.setViewportSize({width:800,height:640});
await popup.goto(`chrome-extension://${id}/popup/popup.html`);
await popup.waitForTimeout(700);
await popup.fill('#inputNewId','student01');
await popup.fill('#inputNewPw','pw1');
await popup.click('#btnAddAccount');
await popup.waitForTimeout(250);
await page.bringToFront(); await page.waitForTimeout(200);
await popup.evaluate(() => chrome.runtime.sendMessage({type:'useActiveTab', accountId:'student01'}));
await popup.waitForTimeout(400);
await popup.bringToFront();
await popup.click('.mode-btn[data-id="matching"]');
await popup.waitForTimeout(150);
await popup.click('#btnRun');

await page.bringToFront();
await page.waitForTimeout(6000);
await page.screenshot({path:`${OUT}/match-solving.png`});

try {
  await page.waitForFunction(() => {
    const d = document.getElementById('done');
    return d && getComputedStyle(d).display !== 'none';
  }, {timeout: 240000});
  console.log('결과:', await page.textContent('#stat'));
  await page.screenshot({path:`${OUT}/match-done.png`});
} catch (e) {
  console.log('완주 못함. 현재 화면:',
    await page.evaluate(() => document.querySelectorAll('.talk-card:not(.hidden)').length + '장'));
  await page.screenshot({path:`${OUT}/match-timeout.png`});
}
await page.bringToFront();
await popup.bringToFront();
await popup.click('#tabLog');
await popup.waitForTimeout(400);
console.log('진단:', await page.evaluate(() => ({
  left: document.querySelectorAll('.match-body.left .flip-card').length,
  right: document.querySelectorAll('.match-body.right .flip-card').length,
  point: (document.querySelector('.point')||{}).textContent })));
console.log('--- 로그 ---');
console.log((await popup.textContent('#logConsole')).trim().split('\n').slice(-10).join('\n'));
await ctx.close();
