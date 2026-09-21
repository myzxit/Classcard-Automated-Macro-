# PC(윈도우 exe) 버전

크롬 확장·안드로이드 앱과 **같은 엔진, 같은 화면**을 Electron 으로 감싼 것입니다.
12개 모드 전부(암기·리콜·스펠·문장 암기·문장 리콜·단어/문장 테스트·매칭·스크램블·문법·전체/한 세트 자동화)가
그대로 동작하고, 크롬 확장에서 하던 **신뢰된 입력(CDP)** 도 같은 방식으로 보냅니다.

| 파일 | 설명 |
|---|---|
| `classcard-automation-portable.exe` | 설치 없이 바로 실행 (권장) |
| `classcard-automation-setup.exe` | 설치판 (바탕화면 바로가기 생성) |

두 파일 모두 GitHub 의 [최신 빌드 릴리스](https://github.com/myzxit/Classcard-Automated-Macro-/releases/tag/apk-latest)에서 받습니다.

## 사용법

1. exe 를 실행하면 **조작 창**(확장 팝업과 같은 화면)이 뜹니다.
2. 왼쪽에 아이디/비밀번호를 넣고 **+** → **🌐 탭 열기** 를 누르면 계정마다 **클래스카드 창**이 열리고 자동 로그인됩니다.
3. 그 창에서 학습 화면으로 이동한 뒤, 조작 창에서 **학습 모드**를 고르고 **▶ 자동화 시작**.
4. 진행 상황은 **LOG** 탭에서 봅니다.

크롬과 달리 **계정마다 쿠키가 분리**돼 있어 여러 계정을 동시에 로그인해 둘 수 있습니다.
고급 설정의 *다계정 순차 실행* 을 끄면 계정들이 **동시에** 돕니다(안드로이드 앱과 같음).

> 윈도우 SmartScreen 이 "확인되지 않은 앱" 경고를 띄울 수 있습니다. 코드 서명 인증서가 없는
> 개인 빌드라서 뜨는 경고입니다. **추가 정보 → 실행** 으로 넘어가면 됩니다.

## 구조

```
desktop/
  main.js          Electron 메인 — 창 관리 · 계정별 자동화 루프 (확장의 background.js 와 1:1)
  driver.js        확장의 Driver 와 같은 인터페이스 (executeJavaScript + webContents.debugger)
  preload-ui.cjs   조작 창에 chrome.runtime 을 흉내 내는 브리지 (팝업 코드는 그대로)
  sync.mjs         extension/engine, popup, content/preload.js 를 app/ 로 복사 (빌드 전 실행)
  test/smoke.mjs   모의 화면으로 모드가 끝까지 도는지 확인
  build/icon.png   앱 아이콘
```

`desktop/app/` 은 `sync.mjs` 가 만드는 복사본이라 커밋하지 않습니다.
엔진을 고치면 확장·안드로이드·아이폰·PC 네 곳이 함께 고쳐집니다.

## 직접 빌드

```bash
cd desktop
npm install
npm run dist:win        # dist/ 에 portable exe 와 setup exe 가 생긴다 (윈도우에서)
npm start               # 개발 실행
```

리눅스/맥에서도 `npm start` 로 실행은 되지만, exe 는 GitHub Actions 의 `windows-latest` 러너가 만듭니다
(`.github/workflows/build.yml` 의 `desktop-windows` 잡).

## 검증

```bash
# 확장의 모의 화면(진짜 사이트처럼 isTrusted 를 검사한다)을 그대로 통과시킨다
CC_NO_SANDBOX=1 xvfb-run -a node desktop/test/smoke.mjs mock_recall.html recall
```

`결과:` 줄이 찍히면 끝까지 돈 것입니다. 리콜(신뢰된 클릭)·스펠(신뢰된 키 입력)·암기(SPACE)·매칭·문법 개념 톡·
문장 암기·스크램블 7종을 이 방법으로 확인했습니다.
