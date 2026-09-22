// 문장 스펠 모의 회귀: 어순배열(t=2) · 영작(t=0) · 첫글자(t=5) 세 설정을 차례로 돌린다.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const EXT='/home/user/Classcard-Automated-Macro-/extension', OUT='/tmp/shots';
const mock = readFileSync('/tmp/shots/mock_sspell.html','utf8');

const ctx = await chromium.launchPersistentContext('/tmp/shots/profileSENT3',{headless:false,
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
// 문장 암기(v3) · 문장 리콜(v3) — 같은 모의 화면의 mode 변형. 암기는 중간에 일시정지/재개도 해 본다.
const VARIANTS = [['mem', 'memorize_sentence', '문장 암기'], ['recall', 'recall_sentence', '문장 리콜']].filter(([m]) => !process.env.CC_M || m === process.env.CC_M);
for (const [m, modeId, name] of VARIANTS) {
  const t = m;
  const page = await ctx.newPage();
  await page.setViewportSize({width:1000,height:760});
  await page.goto(`https://www.classcard.net/${m === 'mem' ? 'Memorize' : 'Recall'}/1593000?mode=${m}`);
  await page.waitForTimeout(500);
  await page.bringToFront(); await page.waitForTimeout(200);
  await popup.evaluate(() => chrome.runtime.sendMessage({type:'useActiveTab', accountId:'student01'}));
  await popup.waitForTimeout(400);
  await popup.bringToFront();
  await popup.click('#tabMain');
  await popup.click(`.mode-btn[data-id="${modeId}"]`);
  await popup.waitForTimeout(150);
  await popup.click('#btnRun');
  await page.bringToFront();
  let pauseNote = '';
  if (m === 'mem') {
    // 6초 뒤 일시정지 → 카드 키가 3초 동안 안 바뀌어야 한다 → 재개
    await page.waitForTimeout(6000);
    await popup.bringToFront(); await popup.click('#btnPause'); await popup.waitForTimeout(800);
    const pausedTxt = await popup.textContent('#progressHint');
    const before = await page.evaluate(() => (document.querySelector('.CardItem.active') || {}).outerHTML || '');
    await page.waitForTimeout(3000);
    const after = await page.evaluate(() => (document.querySelector('.CardItem.active') || {}).outerHTML || '');
    const bar = await popup.$eval('.prog-bar', (el) => el.className).catch(() => '');
    pauseNote = ` · 일시정지 ${pausedTxt.includes('일시정지') && before === after && bar.includes('paused') ? '됨' : '안 됨'}`;
    await popup.click('#btnResume'); await popup.waitForTimeout(300); await page.bringToFront();
  }
  try {
    await page.waitForFunction(() => {
      const d = document.getElementById('done');
      return d && getComputedStyle(d).display !== 'none';
    }, {timeout: 120000});
    parts.push(`${name} ${await page.textContent('#stat')}${pauseNote}`);
    await page.screenshot({path:`${OUT}/sent3-${t}-done.png`});
  } catch (e) {
    parts.push(`${name} 완주 못함`);
    await page.screenshot({path:`${OUT}/sent3-${t}-timeout.png`});
  }
  await popup.bringToFront();
  await popup.click('#tabLog'); await popup.waitForTimeout(300);
  logs.push(`--- ${name}\n` + (await popup.textContent('#logConsole')).trim().split('\n').slice(-8).join('\n'));
  // 다음 설정 전에 이번 실행이 끝나도록 잠깐
  await popup.waitForTimeout(1500);
  await page.close();
}
const bad = parts.some((p) => /완주 못함|오답|거부된 입력 [1-9]|건너뛴 카드 [1-9]|안 됨/.test(p));
console.log('결과:', parts.join(' | ') + (bad ? ' · 안 됨' : ''));
console.log(logs.join('\n'));
await ctx.close();
