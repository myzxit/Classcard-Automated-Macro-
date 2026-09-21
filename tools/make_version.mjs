// 릴리스에 같이 올리는 `version.json` 을 만든다.
//
// 모든 클라이언트(안드로이드 앱 · PC 앱 · 크롬 확장)가 이 파일 하나를 보고 새 버전이 나왔는지 안다.
//   node tools/make_version.mjs [출력 경로]   (기본: dist/version.json)
//
// 버전의 원본은 extension/manifest.json (version) 과 android/app/build.gradle.kts (versionCode) 다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || resolve(ROOT, 'dist/version.json');

const manifest = JSON.parse(readFileSync(resolve(ROOT, 'extension/manifest.json'), 'utf8'));
const gradle = readFileSync(resolve(ROOT, 'android/app/build.gradle.kts'), 'utf8');
const versionCode = Number((gradle.match(/versionCode\s*=\s*(\d+)/) || [])[1] || 0);
const versionName = (gradle.match(/versionName\s*=\s*"([^"]+)"/) || [])[1] || '';
if (versionName !== manifest.version) {
  throw new Error(`버전이 어긋납니다: manifest ${manifest.version} / gradle ${versionName}`);
}
let commit = process.env.GITHUB_SHA || '';
if (!commit) { try { commit = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(); } catch (e) { /* 없어도 된다 */ } }

const REPO = process.env.GITHUB_REPOSITORY || 'myzxit/Classcard-Automated-Macro-';
const TAG = process.env.CC_RELEASE_TAG || 'apk-latest';
const base = `https://github.com/${REPO}/releases/download/${TAG}/`;

const info = {
  version: manifest.version,
  versionCode,
  date: new Date().toISOString(),
  commit: commit.slice(0, 12),
  apk: base + 'classcard-automation.apk',
  extension: base + 'classcard-automation-extension.zip',
  setup: base + 'classcard-automation-setup.exe',
  portable: base + 'classcard-automation-portable.exe',
  notes: process.env.CC_RELEASE_NOTES || '',
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(info, null, 2) + '\n');
console.log(`${out}: v${info.version} (versionCode ${info.versionCode})`);
