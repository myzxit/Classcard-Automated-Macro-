// '지금 보는 탭 사용' + 자동 로그인 켬 상태에서 학습 페이지가 로그인 페이지로 튕기지 않는지,
// 학습 페이지에 들어가면 단어장을 알아서 가져오는지 확인한다 (실제 로그에서 나온 버그의 회귀 테스트).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const EXT='/home/user/Classcard-Automated-Macro-/extension';
const mock = readFileSync('/tmp/shots/mock_spell2.html','utf8');
const login = `<!doctype html><html><body class="login"><form><input type="text" name="login_id"><input type="password" name="login_pwd"><a class="btn-login">로그인</a></form></body></html>`;
const ctx = await chromium.launchPersistentContext('/tmp/shots/profileUSEACTIVE',{headless:false,
  args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`,'--no-sandbox']});
let loginHits = 0;
await ctx.route('https://www.classcard.net/**', r => {
  if (/\/Login/.test(r.request().url())) { loginHits++; return r.fulfill({status:200, contentType:'text/html; charset=utf-8', body:login}); }
  return r.fulfill({status:200, contentType:'text/html; charset=utf-8', body:mock});
});
let sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
for (let t = 0; t < 40 && !sw; t++) { await new Promise((r) => setTimeout(r, 500)); sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')); }
const id = new URL(sw.url()).host;
for (let t = 0; t < 20; t++) { try { await sw.evaluate(() => chrome.storage.local.set({ settings:{ autoLogin:true, keepTab:true, autoDict:true } })); break; } catch (e) { await new Promise((r) => setTimeout(r, 500)); } }
const page = await ctx.newPage();
await page.setViewportSize({width:1000,height:760});
await page.goto('https://www.classcard.net/Spell/1593581/1');
await page.waitForTimeout(500);
const popup = await ctx.newPage();
await popup.goto(`chrome-extension://${id}/popup/popup.html`);
await popup.waitForTimeout(700);
await popup.fill('#inputNewId','cs2630207'); await popup.fill('#inputNewPw','pw1');
await popup.click('#btnAddAccount'); await popup.waitForTimeout(250);
await page.bringToFront(); await page.waitForTimeout(200);
await popup.evaluate(() => chrome.runtime.sendMessage({type:'useActiveTab', accountId:'cs2630207'}));
await popup.waitForTimeout(2500);   // 자동 단어장(1.5초 뒤)까지 기다린다
await popup.bringToFront();
await popup.click('.mode-btn[data-id="spell"]'); await popup.waitForTimeout(150);
await popup.click('#btnRun');
await page.bringToFront();
let stat = null;
try {
  await page.waitForFunction(() => { const d = document.getElementById('done'); return d && getComputedStyle(d).display !== 'none'; }, {timeout: 120000});
  stat = await page.textContent('#stat');
} catch (e) { stat = '완주 못함'; }
await popup.bringToFront(); await popup.click('#tabLog'); await popup.waitForTimeout(400);
const log = (await popup.textContent('#logConsole')).trim();
const bounced = /로그인 폼을 찾지 못했습니다/.test(log) || loginHits > 0 || /\/Login/.test(page.url());
const autoDict = /단어장을 자동으로 가져왔습니다/.test(log);
console.log(`결과: ${stat} · 로그인 튕김 ${bounced ? '있음' : '없음'} · 자동 단어장 ${autoDict ? '됨' : '안 됨'}`);
if (bounced || !autoDict) console.log(log.split('\n').slice(-12).join('\n'));
await ctx.close();
