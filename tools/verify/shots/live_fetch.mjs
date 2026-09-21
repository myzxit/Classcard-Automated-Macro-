// classcard.net 요청을 curl 로 대신 받아 오는 헬퍼 (브라우저는 프록시 터널이 끊겨 직접 못 붙는다)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, unlinkSync, appendFileSync } from 'node:fs';
const run = promisify(execFile);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// curl 호출을 한 번에 하나씩만 실행하는 대기줄 (쿠키 파일 경쟁 방지)
let queue = Promise.resolve();
function serialize(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

/** url 을 curl 로 받아 {status, headers, body(Buffer)} 로 돌려준다. */
export async function curlFetch(url, opts = {}) {
  // 쿠키를 쓰는 요청만 한 줄로 세운다. 정적 파일(js/css)은 세션이 필요 없으므로
  // 동시에 받아도 되고, 그래야 페이지가 제때 뜬다.
  if (!opts.jar) return curlFetchNow(url, opts);
  return serialize(() => curlFetchNow(url, opts));
}

/** 쿠키 파일(Netscape 형식)에서 classcard.net 쿠키를 읽어 {이름:값} 으로 돌려준다. */
function readJar(jar) {
  const out = {};
  try {
    for (const line of readFileSync(jar, 'utf8').split('\n')) {
      const t = line.replace(/^#HttpOnly_/, '').trim();
      if (!t || t.startsWith('#')) continue;
      const f = t.split('\t');
      if (f.length >= 7 && /classcard\.net$/.test(f[0])) out[f[5]] = f[6];
    }
  } catch (e) {}
  return out;
}

/**
 * 브라우저가 심은 쿠키(is_std_start 등)를 쿠키 파일에 적어 준다.
 * 사이트는 브라우저에서 JS 로 심는 쿠키(is_std_start 등)를 보고 학습 시작 여부를 판단하므로,
 * 이걸 안 넘기면 시작 화면만 반복해서 뜬다.
 * 세션 쿠키(ci_session)는 curl 쪽이 진짜이므로 쿠키 파일 값을 우선한다.
 */
function mergeCookies(jar, browserCookieHeader) {
  if (!browserCookieHeader) return;
  const have = readJar(jar);
  const lines = [];
  for (const part of browserCookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (have[name] === value) continue;
    // 세션 쿠키는 curl 쪽이 진짜다 — 브라우저 값으로 덮어쓰지 않는다
    if (name === 'ci_session') continue;
    lines.push(['www.classcard.net', 'FALSE', '/', 'TRUE', '2147483647', name, value].join('\t'));
  }
  if (!lines.length) return;
  try { appendFileSync(jar, lines.join('\n') + '\n'); } catch (e) {}
}

async function curlFetchNow(url, { jar, method = 'GET', data = null, retry = true, cookieHeader = null, extraHeaders = null } = {}) {
  // 사이트가 여러 대의 서버로 나뉘어 있고 세션이 그중 한 대에만 있어서,
  // 로그인한 뒤에도 요청이 다른 서버로 가면 로그인 화면으로 튕긴다.
  // 로그인 화면으로 튕기면 같은 요청을 몇 번 더 보내 세션이 있는 서버에 닿게 한다.
  let last = null;
  const tries = retry ? 18 : 1;
  for (let attempt = 0; attempt < tries; attempt++) {
    last = await curlOnce(url, { jar, method, data, cookieHeader, extraHeaders });
    if (!jar) break;
    const loc = last.headers['location'] || '';
    // 세션이 없는 서버로 갔을 때의 두 가지 모습:
    //   1) 로그인 화면으로 보내는 리다이렉트
    //   2) 200 이지만 본문이 '사용할 수 없는 페이지' / '정상적인 접근이 아닙니다' 스크립트뿐
    const bounced = /LoginPage|\/Login\b/.test(loc);
    const body = last.body && last.body.length < 4000 ? last.body.toString('utf8') : '';
    const refused = /사용할 수 없는 페이지|정상적인 접근이 아닙니다/.test(body);
    // curl 자체가 실패한 경우(프록시 리셋 등)도 다시 보낸다
    const redirect = last.status >= 300 && last.status < 400;
    const failed = last.status === 599 || (!redirect && (!last.body || last.body.length === 0));
    if (!bounced && !refused && !failed) break;
  }
  // 로그인 화면이 아닌 리다이렉트는 따라간다
  let hops = 0;
  while (last && last.status >= 300 && last.status < 400 && last.headers['location'] && hops++ < 5) {
    const next = new URL(last.headers['location'], url).toString();
    last = await curlOnce(next, { jar, cookieHeader });
  }
  return last;
}

async function curlOnce(url, { jar, method = 'GET', data = null, cookieHeader = null, extraHeaders = null } = {}) {
  const hdrFile = `/tmp/shots/.hdr_${process.pid}_${Math.random().toString(36).slice(2)}`;
  const args = ['-sS', '--max-time', '30', '-A', UA, '-D', hdrFile];
  // 쿠키는 읽고 쓴다. 사이트(CodeIgniter)가 몇 분마다 세션 ID 를 새로 발급하므로
  // 새 쿠키를 저장하지 않으면 도중에 로그아웃된다.
  // 단, 동시에 쓰면 쿠키 파일이 깨지므로 curl 호출 자체를 한 줄로 세운다(queue).
  if (jar) {
    // 브라우저가 심은 쿠키를 쿠키 파일에 합쳐 넣고, 파일 그대로 보낸다.
    mergeCookies(jar, cookieHeader);
    args.push('-b', jar, '-c', jar);
  }
  // 사이트는 XHR 을 Referer / X-Requested-With / Content-Type 으로 가린다.
  // 이걸 안 넘기면 멀쩡한 요청이 거부돼 '가짜 버그'가 된다.
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      if (v) args.push('-H', `${k}: ${v}`);
    }
  }
  if (method === 'POST') { args.push('-X', 'POST'); if (data) args.push('--data-binary', data); }
  args.push(url);
  try {
    const { stdout } = await run('curl', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
    let head = '';
    try { head = readFileSync(hdrFile, 'latin1'); } catch (e) {}
    try { unlinkSync(hdrFile); } catch (e) {}
    const last = head.split(/\r?\n\r?\n/).filter((b) => b.trim()).pop() || '';
    const status = parseInt((last.match(/HTTP\/[\d.]+ (\d+)/) || [])[1] || '200', 10);
    const headers = {};
    for (const line of last.split(/\r?\n/).slice(1)) {
      const m = line.match(/^([^:]+):\s*(.*)$/);
      if (!m) continue;
      const k = m[1].toLowerCase();
      if (['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie',
           'content-security-policy', 'content-security-policy-report-only'].includes(k)) continue;
      headers[k] = m[2];
    }
    return { status, headers, body: stdout };
  } catch (e) {
    try { unlinkSync(hdrFile); } catch (e2) {}
    if (process.env.CC_DEBUG) console.log('curl 실패:', url.slice(0, 60), String(e.message).slice(0, 160));
    return { status: 599, headers: {}, body: Buffer.from('') };
  }
}

/** classcard.net 요청을 curl 로 대신 받아 브라우저에 넘겨 주는 라우트를 건다. */
export async function routeThroughCurl(ctx, { jar = null, log = false } = {}) {
  const skip = new Set(['image', 'font', 'media']);
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (!/^https:\/\/(www\.)?classcard\.net\//.test(url)) {
      // 외부(구글 애널리틱스 등)는 그냥 막는다
      if (/^https?:\/\//.test(url)) return route.abort();
      return route.continue();
    }
    if (skip.has(req.resourceType())) return route.abort();
    // 세션이 필요한 요청(문서·XHR)만 쿠키를 쓰고, 세션 없는 서버에 걸리면 다시 보낸다.
    const kind = req.resourceType();
    const needsSession = kind === 'document' || kind === 'xhr' || kind === 'fetch';
    const r = await curlFetch(url, {
      jar: needsSession ? jar : null,
      method: req.method(),
      data: req.postData(),
      retry: needsSession,
      cookieHeader: needsSession ? (req.headers()['cookie'] || null) : null,
      extraHeaders: {
        'Referer': req.headers()['referer'] || null,
        'X-Requested-With': req.headers()['x-requested-with'] || null,
        'Content-Type': req.headers()['content-type'] || null,
        'Origin': req.headers()['origin'] || null,
      },
    });
    if (log) console.log('  <-', r.status, req.resourceType(), url.slice(0, 90));
    if (r.status === 599) return route.abort();
    await route.fulfill({
      status: r.status,
      headers: { ...r.headers, 'content-type': r.headers['content-type'] || 'text/html; charset=utf-8' },
      body: r.body,
    });
  });
}
