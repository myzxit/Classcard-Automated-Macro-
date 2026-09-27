import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const EXT='/home/user/Classcard-Automated-Macro-/extension', OUT='/tmp/shots';
const mock = readFileSync('/tmp/shots/mock_gstreak.html','utf8');
const ctx = await chromium.launchPersistentContext('/tmp/shots/profileGSTREAK',{headless:false,
  args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`,'--no-sandbox']});
await ctx.route('https://www.classcard.net/**', r =>
  r.fulfill({status:200, contentType:'text/html; charset=utf-8', body:mock}));
let sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
for (let t = 0; t < 40 && !sw; t++) { await new Promise((r) => setTimeout(r, 500)); sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')); }
const id = new URL(sw.url()).host;
for (let t = 0; t < 20; t++) { try { await sw.evaluate(() => chrome.storage.local.set({ settings:{ autoLogin:false, keepTab:true } })); break; } catch (e) { await new Promise((r) => setTimeout(r, 500)); } }
const page = await ctx.newPage();
await page.setViewportSize({width:1000,height:800});
await page.goto('https://www.classcard.net/GclassTest/test/1/2/3');
await page.waitForTimeout(500);
const popup = await ctx.newPage();
await popup.goto(`chrome-extension://${id}/popup/popup.html`);
await popup.waitForTimeout(700);
await popup.fill('#inputNewId','student01'); await popup.fill('#inputNewPw','pw1');
await popup.click('#btnAddAccount'); await popup.waitForTimeout(250);
await page.bringToFront(); await page.waitForTimeout(200);
await popup.evaluate(() => chrome.runtime.sendMessage({type:'useActiveTab', accountId:'student01'}));
await popup.waitForTimeout(400);
await popup.bringToFront();
await popup.click('.mode-btn[data-id="grammar"]'); await popup.waitForTimeout(150);
await popup.click('#btnRun');
await page.bringToFront();
try {
  await page.waitForFunction(() => document.getElementById('stat').getAttribute('data-done')==='1',{timeout:90000});
  console.log('결과:', (await page.textContent('#stat')).replace('결과: ',''));
} catch (e) {
  console.log('결과: 완주 못함 —', (await page.textContent('#stat')));
}
await page.screenshot({path:`${OUT}/gstreak.png`});
await ctx.close();
