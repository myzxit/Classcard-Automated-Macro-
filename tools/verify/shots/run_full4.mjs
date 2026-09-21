import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const EXT='/home/user/Classcard-Automated-Macro-/extension', OUT='/tmp/shots';
const mock = readFileSync('/tmp/shots/mock_full4.html','utf8');

const ctx = await chromium.launchPersistentContext('/tmp/shots/profileFULL4',{headless:false,
  args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`,'--no-sandbox']});
await ctx.route('https://www.classcard.net/**', r =>
  r.fulfill({status:200, contentType:'text/html; charset=utf-8', body:mock}));

const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker',{timeout:20000});
const id = new URL(sw.url()).host;
await sw.evaluate(() => chrome.storage.local.set({ settings:{ autoLogin:false, keepTab:true } }));

const page = await ctx.newPage();
await page.setViewportSize({width:1000,height:760});
await page.goto('https://www.classcard.net/GClass/127657');
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
await popup.click('.mode-btn[data-id="grammar"]');
await popup.waitForTimeout(150);
await popup.click('#btnRun');

await page.bringToFront();
await page.waitForTimeout(6000);
await page.screenshot({path:`${OUT}/full-solving.png`});

try {
  // 매크로가 페이지를 이동시키므로 waitForFunction 대신 폴링한다
  let done = false;
  for (let i = 0; i < 120 && !done; i++) {
    try { done = ((await page.evaluate(() => (window.__log && window.__log()) || '')) || '').split('>').length >= 5; }
    catch (e) { /* 이동 중 */ }
    if (!done) await page.waitForTimeout(2000);
  }
  if (!done) throw new Error('미완주');
  console.log('결과:', await page.evaluate(()=>window.__log()));
  await page.screenshot({path:`${OUT}/full-done.png`});
} catch (e) {
  console.log('완주 못함. 진행:', await page.evaluate(()=>window.__log()));
  await page.screenshot({path:`${OUT}/full-timeout.png`});
}
await popup.bringToFront();
await popup.click('#tabLog');
await popup.waitForTimeout(400);
console.log('--- 로그 ---');
console.log((await popup.textContent('#logConsole')).trim().split('\n').slice(-10).join('\n'));
await ctx.close();
