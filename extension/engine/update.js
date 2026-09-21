/**
 * 자동 업데이트 확인 — 확장·PC 앱이 함께 쓴다.
 *
 * 릴리스에 올라가는 version.json 하나를 보고 새 버전이 나왔는지 판단한다 (tools/make_version.mjs 가 만든다).
 * 크롬 확장은 개발자 모드로 넣은 것이라 크롬이 스스로 갈아 끼우지 못한다 → 새 버전을 알리고 zip 을 받아 준다.
 * PC 앱은 electron-updater 로 스스로 갈아 끼운다 (desktop/main.js).
 */

export const VERSION_URL =
  'https://github.com/myzxit/Classcard-Automated-Macro-/releases/download/apk-latest/version.json';

/** '3.16.0' 같은 버전을 숫자 배열로. 비교용. */
export function parseVersion(v) {
  return String(v || '').split('.').map((x) => parseInt(x, 10) || 0);
}

/** a 가 b 보다 새 버전이면 양수, 같으면 0, 오래됐으면 음수. */
export function compareVersion(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * version.json 을 받아 지금 버전과 비교한다.
 * @returns {Promise<{available:boolean, latest?:object, error?:string}>}
 */
export async function checkForUpdate(currentVersion, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return { available: false, error: `HTTP ${res.status}` };
    const latest = await res.json();
    if (!latest || !latest.version) return { available: false, error: 'version.json 형식 오류' };
    return { available: compareVersion(latest.version, currentVersion) > 0, latest };
  } catch (e) {
    return { available: false, error: String((e && e.message) || e) };
  }
}
