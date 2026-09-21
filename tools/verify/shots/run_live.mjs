// 진짜 사이트 · 진짜 세션 · 진짜 소리로 매크로를 돌린다 (저장 페이지 아님).
// 브라우저는 프록시에 직접 못 붙으므로 모든 classcard.net 요청을 curl 로 중계한다.
//   CC_ID=.. CC_PW=.. node run_live.mjs <시작경로> <모드> <초>
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { curlFetch } from './live_fetch.mjs';

const EXT = '/home/user/Classcard-Automated-Macro-/extension';
const [START, MODE, SECS_] = process.argv.slice(2);
const SECS = Number(SECS_ || 240);
const JAR = `/tmp/shots/.jlive_${MODE}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const cu = (a) => { try { return execFileSync('curl', a, { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch (e) { return ''; } };
execFileSync("rm", ["-rf", JAR, `/tmp/shots/profileLIVE_${MODE}`]); // 프로필을 지워야 확장의 새 코드가 실린다
cu(['-sS', '-c', JAR, '-b', JAR, '-A', UA, 'https://www.classcard.net/Login', '-o', '/dev/null']);
const login = cu(['-sS', '-c', JAR, '-b', JAR, '-A', UA, '-X', 'POST', 'https://www.classcard.net/LoginProc',
  '-H', 'X-Requested-With: XMLHttpRequest', '-H', 'Referer: https://www.classcard.net/Login',
  '--data-urlencode', `login_id=${process.env.CC_ID}`, '--data-urlencode', `login_pwd=${process.env.CC_PW}`,
  '--data', 'redirect=&req_type=&req_url=']);
if (!/"result":"ok"/.test(login)) { console.log('로그인 실패:', login.slice(0, 120)); process.exit(1); }

const ctx = await chromium.launchPersistentContext(`/tmp/shots/profileLIVE_${MODE}`, {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required'],
});
const cache = new Map();
const posts = [];
await ctx.route('**/*', async (route) => {
  const req = route.request();
  const url = req.url();
  if (!/^https?:/.test(url)) return route.continue();
  if (!/^https:\/\/(www\.|mobile\d?\.|static\d?\.)?classcard\.net\//.test(url)) return route.abort();
  const kind = req.resourceType();
  if (['image', 'font'].includes(kind)) return route.abort();
  const needsSession = kind === 'document' || kind === 'xhr' || kind === 'fetch' || req.method() === 'POST';
  if (!needsSession) {
    if (!cache.has(url)) cache.set(url, await curlFetch(url, { retry: false }));
    const r = cache.get(url);
    if (!r || r.status === 599) return route.abort();
    return route.fulfill({ status: r.status, headers: { ...r.headers, 'content-type': r.headers['content-type'] || 'application/octet-stream' }, body: r.body });
  }
  const r = await curlFetch(url, {
    jar: JAR, method: req.method(), data: req.postData(), retry: true,
    cookieHeader: req.headers()['cookie'] || null,
    extraHeaders: {
      Referer: req.headers()['referer'] || null,
      'X-Requested-With': req.headers()['x-requested-with'] || null,
      'Content-Type': req.headers()['content-type'] || null,
      Origin: req.headers()['origin'] || null,
    },
  });
  if (req.method() === 'POST') posts.push(`${new Date().toTimeString().slice(0, 8)} ${url.replace('https://www.classcard.net', '').slice(0, 50)} -> ${r.status}`);
  if (r.status === 599) return route.abort();
  return route.fulfill({ status: r.status, headers: { ...r.headers, 'content-type': r.headers['content-type'] || 'text/html; charset=utf-8' }, body: r.body });
});

let sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
for (let t = 0; t < 40 && !sw; t++) { await new Promise((r) => setTimeout(r, 500)); sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')); }
const id = new URL(sw.url()).host;
for (let t = 0; t < 20; t++) { try { await sw.evaluate(() => chrome.storage.local.set({ settings: { autoLogin: false, keepTab: true } })); break; } catch (e) { await new Promise((r) => setTimeout(r, 500)); } }

const page = await ctx.newPage();
const navs = [];
page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push(`${new Date().toTimeString().slice(0, 8)} ${f.url().replace('https://www.classcard.net', '')}`); });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 140)));
await page.addInitScript(() => {
  window.__w = { cards: {}, order: [], restarts: 0 };
  setInterval(() => {
    const a = window.audio; if (!a || !isFinite(a.duration) || a.duration <= 0) return;
    const w = window.__w; const src = (a.currentSrc || a.src || '').slice(-40);
    if (!w.cards[src]) { w.cards[src] = { dur: a.duration, max: 0, last: 0 }; w.order.push(src); }
    const c = w.cards[src]; const t = a.currentTime;
    if (t + 1.0 < c.last) w.restarts++;
    c.last = t; if (t > c.max) c.max = t; c.dur = a.duration;
  }, 100);
});
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`https://www.classcard.net${START}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(3000);
console.log('시작 페이지:', page.url(), '| 제목:', (await page.title()).slice(0, 40));

const popup = await ctx.newPage();
await popup.goto(`chrome-extension://${id}/popup/popup.html`);
await popup.waitForTimeout(700);
await popup.fill('#inputNewId', 'live'); await popup.fill('#inputNewPw', 'pw');
await popup.click('#btnAddAccount'); await popup.waitForTimeout(250);
await page.bringToFront(); await page.waitForTimeout(200);
await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'useActiveTab', accountId: 'live' }));
await popup.waitForTimeout(400);
await popup.bringToFront();
await popup.click(`.mode-btn[data-id="${MODE}"]`); await popup.waitForTimeout(150);
await popup.click('#btnRun');
await page.bringToFront();

let audio = null;
for (let i = 0; i < SECS; i++) {
  await page.waitForTimeout(1000);
  try { const w = await page.evaluate(() => window.__w || null); if (w && w.order.length) audio = w; } catch (e) {}
  if (i % 30 === 29) { try { await page.screenshot({ path: `/tmp/shots/live_${MODE}_${i + 1}.png` }); } catch (e) {} }
}
try { await page.screenshot({ path: `/tmp/shots/live_${MODE}_end.png` }); } catch (e) {}
console.log('--- 이동 기록'); console.log(navs.join('\n'));
console.log('--- POST', posts.length, '건'); console.log(posts.slice(0, 60).join('\n'));
if (audio) {
  const cards = audio.order.map((s) => audio.cards[s]);
  const judged = cards.slice(0, -1);
  console.log(`--- 소리: 해설 ${cards.length}개 · 끝까지 들은 것 ${judged.filter((c) => c.max >= c.dur - 0.9).length}/${judged.length} · 다시 튼 횟수 ${audio.restarts}`);
}
if (pageErrors.length) { console.log('--- 페이지 오류', pageErrors.length); console.log(pageErrors.slice(0, 5).join('\n')); }
await popup.bringToFront(); await popup.click('#tabLog'); await popup.waitForTimeout(400);
const log = (await popup.textContent('#logConsole')).trim().split('\n');
console.log('--- 로그', log.length, '줄'); console.log(log.slice(-60).join('\n'));
await ctx.close();
