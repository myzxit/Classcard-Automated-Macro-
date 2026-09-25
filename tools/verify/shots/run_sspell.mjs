// 문장 스펠 모의 회귀: 어순배열(t=2) · 영작(t=0) · 첫글자(t=5) 세 설정을 차례로 돌린다.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const EXT='/home/user/Classcard-Automated-Macro-/extension', OUT='/tmp/shots';
const mock = readFileSync('/tmp/shots/mock_sspell.html','utf8');

const ctx = await chromium.launchPersistentContext('/tmp/shots/profileSSPELL',{headless:false,
  args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`,'--no-sandbox']});
await ctx.route('https://www.classcard.net/**', r =>
  r.fulfill({status:200, contentType:'text/html; charset=utf-8', body:mock}));

let sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
for (let t = 0; t < 40 && !sw; t++) { await new Promise((r) => setTimeout(r, 500)); sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')); }
const id = new URL(sw.url()).host;
for (let t = 0; t < 20; t++) { try { await sw.evaluate(() => chrome.storage.local.set({ settings:{ autoLogin:false, keepTab:true } })); break; } catch (e) { await new Promise((r) => setTimeout(r, 500)); } }

const popup = await ctx.newPage();
await popup.setViewportSize({width:800,height:640});
await popup.goto(`chrome-extension://${id}/popup/popup.html`);
await popup.waitForTimeout(700);
await popup.fill('#inputNewId','student01');
await popup.fill('#inputNewPw','pw1');
await popup.click('#btnAddAccount');
await popup.waitForTimeout(250);

const parts = [];
const logs = [];
const VARIANTS = [[2, '어순배열'], [0, '영작'], [5, '첫글자']].filter(([t]) => !process.env.CC_T || String(t) === process.env.CC_T);
for (const [t, name] of VARIANTS) {
  const page = await ctx.newPage();
  await page.setViewportSize({width:1000,height:760});
  await page.goto(`https://www.classcard.net/Spell/1593000?t=${t}`);
  await page.waitForTimeout(500);
  await page.bringToFront(); await page.waitForTimeout(200);
  await popup.evaluate(() => chrome.runtime.sendMessage({type:'useActiveTab', accountId:'student01'}));
  await popup.waitForTimeout(400);
  await popup.bringToFront();
  await popup.click('#tabMain');
  await popup.click('.mode-btn[data-id="spell_sentence"]');
  await popup.waitForTimeout(150);
  await popup.click('#btnRun');
  await page.bringToFront();
  try {
    await page.waitForFunction(() => {
      const d = document.getElementById('done');
      return d && getComputedStyle(d).display !== 'none';
    }, {timeout: 120000});
    parts.push(`${name} ${await page.textContent('#stat')}`);
    await page.screenshot({path:`${OUT}/sspell-${t}-done.png`});
  } catch (e) {
    parts.push(`${name} 완주 못함`);
    await page.screenshot({path:`${OUT}/sspell-${t}-timeout.png`});
  }
  await popup.bringToFront();
  await popup.click('#tabLog'); await popup.waitForTimeout(300);
  logs.push(`--- ${name}\n` + (await popup.textContent('#logConsole')).trim().split('\n').slice(-8).join('\n'));
  // 다음 설정 전에 이번 실행이 끝나도록 잠깐
  await popup.waitForTimeout(1500);
  await page.close();
}
const bad = parts.some((p) => /완주 못함|오답|거부된 입력 [1-9]/.test(p));
console.log('결과:', parts.join(' | ') + (bad ? ' · 안 됨' : ''));
console.log(logs.join('\n'));
await ctx.close();
