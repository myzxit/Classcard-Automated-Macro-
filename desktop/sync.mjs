// 확장(extension/)의 엔진·팝업 화면을 PC 앱 안으로 복사한다.
//
// PC 버전은 별도 코드가 아니라 **크롬 확장과 같은 엔진, 같은 화면**을 Electron 으로 감싼 것이다.
// 그래서 빌드 전에 이 스크립트로 원본을 desktop/app/ 에 가져온다 (desktop/app 은 생성물이라 커밋하지 않는다).
//
//   node desktop/sync.mjs
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = resolve(ROOT, 'desktop/app');

rmSync(APP, { recursive: true, force: true });
mkdirSync(APP, { recursive: true });

// 1) 엔진 — 12개 모드 전부 (ESM 그대로; Electron 메인 프로세스가 ESM 을 지원한다)
cpSync(resolve(ROOT, 'extension/engine'), resolve(APP, 'engine'), { recursive: true });

// 2) 페이지 선주입 스크립트 — 이탈 감지 우회 + 문장 리콜 정답 캡처.
//    확장에서는 document_start 콘텐츠 스크립트, 여기서는 BrowserWindow preload 로 같은 시점에 돈다.
writeFileSync(
  resolve(APP, 'page-preload.cjs'),
  readFileSync(resolve(ROOT, 'extension/content/preload.js'), 'utf8'),
);

// 3) 팝업 화면 — 확장의 popup/** 를 그대로 (테마·캐릭터 배경 포함)
cpSync(resolve(ROOT, 'extension/popup'), resolve(APP, 'ui'), { recursive: true });

// 4) 아이콘
cpSync(resolve(ROOT, 'extension/icons'), resolve(APP, 'icons'), { recursive: true });

// 앱 버전은 확장 manifest 와 같게 맞춘다
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'extension/manifest.json'), 'utf8'));
const pkgPath = resolve(ROOT, 'desktop/package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (pkg.version !== manifest.version) {
  pkg.version = manifest.version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`desktop/package.json 버전을 ${manifest.version} 으로 맞췄습니다`);
}
console.log(`desktop/app 갱신 완료 (엔진 + 팝업 UI + 선주입 스크립트, v${manifest.version})`);
