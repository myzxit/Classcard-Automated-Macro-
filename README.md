<a id="readme-top"></a>

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <img src="https://play-lh.googleusercontent.com/howCUVHqn67CQ_1VuMAICY7FIwUGT-4c6_Tcii_9z0dE1_2ZN2vA8Ny1EMkJVYMGBQUw" alt="Classcard" width="80" height="80">

  <h3 align="center">Classcard Automation for Android</h3>

  <p align="center">
    클래스카드(Classcard)의 암기 · 리콜 · 스펠 · 매칭 · 스크램블 · 테스트 학습을 자동화하는 <b>안드로이드 앱</b>입니다.
    <br />
    PC(Selenium) 버전의 <b>모든 기능</b>을 그대로 옮겼습니다. 폰 하나로 전체 자동화까지 돌아갑니다.
  </p>
</div>

<br />

## About The Project

원래 이 프로젝트는 PC에서 Selenium으로 크롬을 조종하고, `pynput` 글로벌 단축키로 자동화를
켜는 파이썬 스크립트였습니다. 안드로이드에는 ChromeDriver도, 글로벌 단축키도, `.env` 파일도
없기 때문에 **자동화 두뇌는 Kotlin으로 1:1 이식**하고, 브라우저를 조종하는 부분만
`WebView` + 코루틴으로 갈아 끼웠습니다.

카드 판별 · 정답 매칭 · 클릭 순서 · 목표 점수 · 이탈 감지 우회 같은 핵심 로직은
**원본과 같은 값이 나오는지 테스트로 검증**합니다
(`android/app/src/test/.../PortParityTest.kt` — 원본 파이썬을 실제로 실행해 만든 기준값과 대조).

### 기능 (하나도 빠지지 않았습니다)

* **자동 로그인** — 앱에 저장한 아이디/비밀번호로 자동 로그인
* **다계정 동시 실행** — 계정 수만큼 WebView가 열리고, 버튼 한 번이면 **모든 계정이 동시에**
  같은 자동화를 수행합니다. 계정별로 쿠키가 분리되어 서로 섞이지 않습니다
  (기기의 WebView가 멀티 프로필을 지원하는 경우. 미지원이면 앱이 알려줍니다)
* **암기(Memorize)** — 단어/문장 암기 자동화
* **리콜(Recall)** — 단어/문장 리콜 자동화
* **스펠(Spell)** — 정답을 자동으로 타이핑. 전체 자동화에서는 선생님이 **필수로 지정한 단어 set**에서만 수행
* **테스트(단어)** — 객관식 자동 풀이. 양방향(영↔한) 매칭으로 정답을 고르고,
  항상 100점이 되지 않도록 일부 문항을 랜덤 오답 처리(**70점 초과 보장**)
* **테스트(문장)** — 문장 어순 배열 자동 풀이. 한글 문제 → 영어 정답 문장을 찾아 어순대로 클릭.
  실시간 채점에 대응하기 위해 **네이티브 터치 주입(진짜 클릭)** 을 사용하며,
  괄호 묶음 `(...)`·대소문자 중복(`The`/`the`)·구두점 차이를 모두 정규화해 매칭.
  0~1개만 랜덤 오답 처리(**90점 패스 기준** 안전 통과)
* **매칭(단어)** — 영어↔한국어 카드 매칭 게임 자동 풀이. 목표 점수(**3000~5000점 랜덤**)에
  도달하면 게임 도중에 자동으로 빠져나옴(점수는 저장됨)
* **스크램블(문장)** — 문장 어순 배열 게임 자동 풀이. 목표 점수(**4000~5000점 랜덤**)에 도달하면 빠져나옴
* **단어장 가져오기** — 현재 페이지에서 단어 데이터를 추출해 계정별로 보관
* **전체 자동화** — 단어장 목록에서 맨 아래 set부터 위로 올라가며 단어/문장 자동 판별 →
  학습구간을 '전체 카드 학습'으로 변경 → 단어장 자동 갱신 →
  암기 → 리콜 → 스펠 → 매칭/스크램블 → 테스트를 차례로 수행.
  이미 완료된 모드와 set은 자동으로 스킵
  (테스트는 최고점수가 단어 90점 / 문장 90점, 매칭은 3000점 / 스크램블은 4000점 이상이면 스킵)
* **한 세트 자동화** — 셋홈(set 상세) 화면에서 그 한 set만 전체 모드를 수행하고 멈춤
* **백그라운드 실행** — 포그라운드 서비스 + WakeLock으로 화면을 꺼도 계속 동작합니다.
  페이지의 '이탈 감지'는 문서 시작 시점에 주입되는 스크립트가 막습니다

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## 설치

### 1) 이미 만들어진 APK 받기 (권장)

이 저장소에 코드가 올라갈 때마다 GitHub Actions가 APK를 만들어 둡니다.

1. 저장소 상단의 **Actions** 탭 → 최신 **Android** 실행을 선택
2. 아래 **Artifacts** 에서 `classcard-automation-debug-apk` 다운로드
3. 압축을 풀고 `app-debug.apk` 를 폰으로 옮겨 설치
   (설치 시 "출처를 알 수 없는 앱" 허용이 필요합니다)

### 2) 직접 빌드하기

```sh
git clone https://github.com/myzxit/Classcard-Automated-Macro-.git
cd Classcard-Automated-Macro-/android
./gradlew assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk
```

**요구 사항**: JDK 17, Android SDK (compileSdk 34) / 폰은 **Android 8.0(API 26) 이상**

> 문장 리콜의 정답 캡처와 계정별 쿠키 분리는 최신 WebView 기능을 사용합니다.
> 잘 동작하지 않으면 Play 스토어에서 **Android System WebView** 와 **Chrome** 을 업데이트하세요.
> (지원하지 않는 기기에서는 앱이 로그로 알려주고 가능한 범위에서 계속 동작합니다.)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## 사용법

1. 앱을 켜고 오른쪽 위 **[계정]** 을 눌러 클래스카드 아이디/비밀번호를 등록합니다.
   * 여러 계정을 넣으면 계정 수만큼 창이 열리고, 버튼 한 번이 **모든 계정에 동시에** 적용됩니다.
   * 기존 `.env` 를 쓰던 분은 그 내용을 그대로 붙여넣고 **[붙여넣은 내용 가져오기]** 를 누르면 됩니다.

     ```
     CLASSCARD_ID=계정1,계정2
     CLASSCARD_PW=비번1,비번2
     ```
2. **[저장하고 다시 시작]** 을 누르면 계정마다 창이 열리고 자동으로 로그인됩니다.
3. 화면 위쪽 드롭다운으로 계정을 골라 볼 수 있습니다. **보이지 않는 계정도 뒤에서 계속 동작합니다.**
4. 아래 버튼으로 자동화를 제어합니다.

| 버튼 | 기능 | (PC 버전 단축키) |
|------|------|------------------|
| **전체 자동화** | 단어장 목록 페이지에서 맨 아래 set부터 순차 처리 | `Ctrl + A` |
| **한 세트** | 열어 둔 셋홈 화면의 그 set만 전체 모드 수행 | `Ctrl + Alt + S` |
| **단어장 가져오기** | 현재 페이지에서 단어 데이터 추출 | `Ctrl + M` |
| **중지** | 현재 자동화 중지 (전체 계정) | `Ctrl + E` |
| **종료** | 자동화를 멈추고 앱 종료 | `Ctrl + Esc` |
| **암기** | 단어 암기 | `Ctrl + I` |
| **리콜** | 단어 리콜 | `Ctrl + Y` |
| **스펠** | 스펠 | `Ctrl + X` |
| **문장 암기** | 문장 암기 | `Ctrl + B` |
| **문장 리콜** | 문장 리콜 | `Ctrl + Q` |
| **단어 테스트** | 단어 객관식 테스트 | `Ctrl + Alt + G` |
| **문장 테스트** | 문장 어순 배열 테스트 | `Ctrl + Alt + H` |
| **매칭** | 단어 매칭 게임 | `Ctrl + Alt + J` |
| **스크램블** | 문장 스크램블 게임 | `Ctrl + Alt + K` |

**[로그]** 버튼을 누르면 진행 상황이 그대로 보입니다 (PC 버전의 터미널 출력과 같은 내용).

### 잘 안 될 때

* **화면이 작게 보이는 건 정상입니다.** 클래스카드는 화면이 좁으면 모바일 레이아웃으로 바뀌는데,
  그러면 스크램블 타일이 잘려 자동화가 깨집니다. 그래서 앱이 **데스크톱 화면(가로 1280px)** 을
  강제로 유지하고 화면에 맞게 축소해서 보여 줍니다. 확대해서 보고 싶으면 손가락으로 스크롤하세요.
* 자동화가 멈춘 것 같으면 **[로그]** 를 열어 어느 단계에서 막혔는지 확인하세요.
* 단어장이 없다는 로그가 나오면 학습 페이지로 이동한 뒤 **[단어장 가져오기]** 를 누르세요.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## 코드 구조

```
android/app/src/main/java/com/classcard/automation/
  MainActivity.kt          컨트롤 패널 + 계정별 WebView 호스트
  AccountsActivity.kt      계정 설정 (.env 대체)
  AccountStore.kt          계정 저장 / .env 텍스트 파싱
  AutomationService.kt     포그라운드 서비스 + WakeLock (백그라운드 실행)
  LogBus.kt                로그 (파이썬 print 대체)
  core/
    Driver.kt              WebView 래퍼 — Selenium WebDriver 대체
                           execute_script -> eval, CDP 클릭/키 -> 네이티브 주입
    Session.kt             계정 1개 = WebView 1개 (원본 Account 클래스)
    Controller.kt          버튼 -> 전 계정 fan-out (원본 make_starter)
    StopFlag.kt            threading.Event 대체
    Norm.kt                정규화/토큰화 함수 모음 (원본 함수별 1:1)
    Similarity.kt          difflib.SequenceMatcher.ratio() 이식
    AntiBlur.kt            이탈 감지 우회 스크립트
  modules/                 자동화 모듈 (원본 파이썬 파일과 1:1)
    HtmlParser  Spell  Memorize  Recall  MemorizeSentence  RecallSentence
    Test  TestSentence  Matching  Scramble  AutoAll
android/app/src/main/assets/preload.js
    문서 시작 시점 주입 — 이탈 감지 우회 / 문장 리콜 정답 캡처 / 데스크톱 뷰포트 강제
```

### Selenium이 하던 일을 어떻게 대체했나

| 원본 (PC) | 안드로이드 |
|---|---|
| `driver.execute_script(...)` | `Driver.eval(...)` — JS 스니펫과 CSS 셀렉터를 그대로 재사용 |
| CDP `Input.dispatchMouseEvent` (진짜 클릭) | 네이티브 `MotionEvent` 주입 |
| `body.send_keys(SPACE)` (진짜 키 입력) | 네이티브 `KeyEvent` 주입 |
| CDP `addScriptToEvaluateOnNewDocument` | `WebViewCompat.addDocumentStartJavaScript` |
| 크롬 창 N개 (계정 격리) | WebView N개 + `ProfileStore` 프로필 분리 |
| 창 크기 1280×900 강제 | 데스크톱 UA + `initialScale` + viewport 메타 강제 |
| `pynput` 글로벌 단축키 | 화면 하단 컨트롤 패널 |
| `.env` 파일 | 앱 내 계정 설정 (+ `.env` 붙여넣기 가져오기) |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## 개발

```sh
cd android
./gradlew testDebugUnitTest   # 이식 정확성 회귀 테스트
./gradlew assembleDebug       # APK 빌드
```

`android/tools/gen_reference.py` 는 **원본 파이썬 구현을 그대로 실행해서**
테스트 기준값(`app/src/test/resources/reference.json`)을 만드는 스크립트입니다.
원본 파이썬 파일은 이 저장소의 git 히스토리(안드로이드 이식 이전 커밋)에 있습니다.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] 자동 로그인
- [x] 단어장 자동 추출
- [x] 단어/문장 암기·리콜
- [x] 스펠
- [x] 단어/문장 테스트 (백그라운드 실행)
- [x] 매칭 / 스크램블 (백그라운드 실행)
- [x] 전체 자동화 / 한 세트 자동화
- [x] 다계정 동시 실행
- [x] 안드로이드 앱 (GUI 인터페이스)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the Unlicense License.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgments

* 원본 PC(파이썬) 버전: [youngmin0/Classcard-Automation](https://github.com/youngmin0/Classcard-Automation)
* [Best-README-Template](https://github.com/othneildrew/Best-README-Template)

<p align="right">(<a href="#readme-top">back to top</a>)</p>
