<a id="readme-top"></a>

<br />
<div align="center">
  <img src="https://play-lh.googleusercontent.com/howCUVHqn67CQ_1VuMAICY7FIwUGT-4c6_Tcii_9z0dE1_2ZN2vA8Ny1EMkJVYMGBQUw" alt="Classcard" width="80" height="80">

  <h3 align="center">Classcard Automation</h3>

  <p align="center">
    클래스카드(Classcard)의 암기 · 리콜 · 스펠 · 매칭 · 스크램블 · 테스트 학습을 자동화합니다.
    <br />
    <b>📱 안드로이드 앱</b> 과 <b>🧩 크롬 확장프로그램</b> 두 가지로 쓸 수 있고, <b>기능은 완전히 같습니다.</b>
  </p>
</div>

<br />

## 다운로드

| | 받는 곳 | 설치 |
|---|---|---|
| 📱 **안드로이드** | [classcard-automation.apk](https://github.com/myzxit/Classcard-Automated-Macro-/releases/download/apk-latest/classcard-automation.apk) | 폰 브라우저로 링크를 열면 바로 받아집니다 |
| 🧩 **크롬 확장** | [classcard-automation-extension.zip](https://github.com/myzxit/Classcard-Automated-Macro-/releases/download/apk-latest/classcard-automation-extension.zip) | 압축을 풀고 개발자 모드로 로드 |

코드가 바뀔 때마다 같은 주소에 최신 빌드가 자동으로 올라갑니다.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## 기능 (두 버전 모두 동일)

* **자동 로그인** — 저장한 아이디/비밀번호로 자동 로그인
* **다계정** — 계정 여러 개를 등록해 두고 한 번에 실행
  (안드로이드는 계정별 세션을 분리해 **동시** 실행, 크롬은 쿠키를 공유하므로 **순차** 실행)
* **암기 / 리콜 / 스펠** — 단어 학습 자동화. 스펠은 선생님이 **필수**로 지정한 set 에서만 수행
* **문장 암기 / 문장 리콜** — 문장 학습 자동화.
  문장 리콜은 페이지가 콘솔로 흘리는 정답을 가로채 맞춥니다(정답이 DOM 에 없어서 이 방법뿐)
* **단어 테스트** — 객관식 자동 풀이. 양방향(영↔한) 매칭으로 정답을 고르고,
  항상 100점이 되지 않도록 일부를 랜덤 오답 처리(**70점 초과 보장**)
* **문장 테스트** — 어순 배열 자동 풀이. 한글 문제 → 영어 정답을 찾아 순서대로 클릭.
  괄호 묶음 `(...)`·대소문자 중복(`The`/`the`)·구두점 차이를 정규화해 매칭하고,
  0~1개만 랜덤 오답 처리(**90점 패스 안전 통과**)
* **단어 매칭** — 매칭 게임 자동 풀이. 목표 점수(**7,000~8,500 랜덤**) 도달 시 중도 종료(점수 저장됨)
* **문장 스크램블** — 스크램블 게임 자동 풀이. 목표 점수(**7,000~8,500 랜덤**) 도달 시 종료
* **문법** — 문법훈련(GClass) 자동 풀이.
  문법 클래스 페이지에서 실행하면 유닛의 단계(개념 톡 → 연습 문제 A/B → 서술형 →
  실전 → 누적오답복습 → Scramble)를 **잠기지 않은 것부터 순서대로** 진행합니다.
  **개념 톡**은 Enter 로 설명 카드를 넘기며, 중간에 나오는 빈칸·객관식을 풀어 진행합니다.
  문제 화면은 실제 시험지(70문항)에 나오는 유형을 전부 처리합니다 —
  **객관식**(`data-type=3`) · **인라인 선택**( ? 를 눌러 고르는 것, `10`) ·
  **서술형 입력**(`1`) · **어순 배열**(단어 타일 클릭, `4`) ·
  **배열형 빈칸**(빈칸 여러 개 + 화면의 힌트 단어, `6`) · 분류 · 짝맞추기.
  정답은 화면에 들어 있으면(`.gclass-q-answer-text`) 숨겨져 있어도 읽어 첫 시도에 맞히고,
  없으면 찍은 뒤 **채점 결과를 기억**해 오답을 지워 나갑니다.
  > 실전/연습 테스트 화면은 정답이 페이지에 들어 있지 않고 채점이 서버에서 이루어집니다.
  > 이때는 한 문제당 한 번만 답할 수 있어, 정답 표시가 없는 문항은 확률적으로 맞힙니다.
* **단어장 가져오기** — 현재 학습 페이지에서 단어/뜻 데이터를 추출해 계정별로 보관
* **전체 자동화** — 단어장 목록에서 맨 아래 set 부터 위로 올라가며 단어/문장 자동 판별 →
  학습구간을 '전체 카드 학습'으로 변경 → 단어장 갱신 →
  암기 → 리콜 → 스펠 → 매칭/스크램블 → 테스트를 차례로 수행.
  이미 끝난 모드와 set 은 자동으로 스킵(테스트 90점 / 매칭 7000점 / 스크램블 7000점 이상)
* **한 세트 자동화** — 셋홈(set 상세)에서 그 한 set 만 전 과정 수행
* **백그라운드 실행** — 화면이 꺼지거나 창이 가려져도 '이탈'로 잡히지 않고 계속 실행

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## 📱 안드로이드 설치

1. 위 표의 **APK 링크**를 폰 브라우저(크롬)로 열기 → 자동 다운로드
2. 다운로드 알림(또는 **파일** 앱 → **다운로드**)에서 APK를 누름
3. "출처를 알 수 없는 앱" 경고 → **설정** → 해당 브라우저에 **이 소스 허용** → 뒤로 → **설치**
4. "기기가 손상될 수 있다"(Play 프로텍트) 경고는 **무시하고 설치**
   — 개인 서명 APK라 항상 뜨는 경고입니다

### 설치가 안 될 때 ("앱이 설치되지 않음")

거의 항상 **서명 충돌**입니다. 예전에 깔아 둔 앱과 새 APK의 서명이 다르면 덮어쓰기가 막힙니다.

1. **기존 앱을 지우고 다시 설치하세요** — 설정 → 앱 → *클래스카드 자동화* → 삭제
   (v3.0.0 부터는 저장소에 넣어 둔 고정 키로 서명하므로, 한 번만 지우면 이후로는 덮어쓰기가 됩니다)
2. 그래도 안 되면:
   - **다운로드가 끊겼는지** 확인 — APK 크기가 6MB 정도인지 보고, 작으면 다시 받기
   - **저장 공간**이 부족하지 않은지
   - **Play 프로텍트**: 설정 → Play 프로텍트 → 설정(톱니) → *유해한 앱 검색* 잠시 끄기
   - 폰이 **Android 8.0 미만**이면 설치되지 않습니다 (아래 요구 사항)

**요구 사항**: Android 8.0(API 26) 이상.
문장 리콜의 정답 캡처와 계정별 쿠키 분리는 최신 WebView 기능을 씁니다.
잘 안 되면 Play 스토어에서 **Android System WebView** 와 **Chrome** 을 업데이트하세요.

### 사용법

1. 앱을 켜고 왼쪽 **계정 리스트** 에 아이디/비밀번호를 넣고 **+**
   (기존 `.env` 는 **⤓ .env 불러오기** 로 붙여넣으면 됩니다)
2. **🌐 브라우저 열기** → 자동으로 로그인됩니다
3. 계정 줄을 누르면 그 계정의 브라우저 화면이 열립니다. 단어장 목록 페이지로 이동하세요
4. 오른쪽에서 **학습 모드**를 고르고 아래 **▶ 자동화 시작**
5. 진행 상황은 위쪽 **LOG** 탭에서 볼 수 있습니다

> **화면이 작게 보이는 건 정상입니다.** 클래스카드는 화면이 좁으면 모바일 레이아웃으로 바뀌는데,
> 그러면 스크램블 타일이 잘려 자동화가 깨집니다. 그래서 앱이 **데스크톱 화면(가로 1280px)** 을
> 강제로 유지하고 축소해 보여 줍니다. 손가락으로 확대/스크롤하면 됩니다.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## 🧩 크롬 확장프로그램 설치

1. 위 표의 **확장 zip** 을 받아 **압축을 풉니다** (폴더가 하나 생깁니다)
2. 크롬 주소창에 `chrome://extensions` 입력
3. 오른쪽 위 **개발자 모드** 를 켭니다
4. **압축해제된 확장 프로그램을 로드합니다** → 방금 푼 폴더 선택
5. 툴바의 퍼즐 아이콘에서 **클래스카드 자동화** 를 고정해 두면 편합니다

> 크롬 웹스토어에 올린 앱이 아니라서 개발자 모드로 넣어야 합니다.
> Edge, Whale 등 크로미움 기반 브라우저도 같은 방법으로 됩니다.

### 사용법

1. 확장 아이콘을 눌러 팝업을 엽니다 (안드로이드 앱과 같은 화면입니다)
2. 계정을 등록하고 **🌐 탭 열기** → 새 탭이 열리며 자동 로그인됩니다
   - 이미 로그인해 둔 탭이 있으면 **↪ 지금 보는 탭 사용** 이 더 빠릅니다
3. 그 탭에서 단어장 목록 페이지로 이동
4. **학습 모드** 를 고르고 **▶ 자동화 시작**

**문장 테스트를 돌리면 "…에서 디버깅하고 있습니다" 알림 바가 뜹니다.** 정상입니다.
그 화면의 버튼은 진짜 마우스 입력에만 반응해서, 크롬 디버거(CDP)로 신뢰된 클릭을 보냅니다.
자동화가 끝나면 자동으로 연결이 끊깁니다. (원본 파이썬 버전이 쓰던 것과 **같은** 방식입니다)

**다계정은 순차로 돌아갑니다.** 크롬은 프로필 하나에서 쿠키를 공유하므로 여러 계정을
동시에 로그인해 둘 수 없습니다. 그래서 계정1 실행 → 쿠키 정리 → 계정2 로그인 → 실행 …
순서로 진행합니다. 정말 동시에 돌리고 싶다면 안드로이드 앱을 쓰거나,
크롬 **프로필**을 계정 수만큼 만들어 각각 확장을 설치하세요.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## 어떻게 만들어졌나

원래 이 프로젝트는 PC에서 **Selenium** 으로 크롬을 조종하고 **pynput** 글로벌 단축키로
자동화를 켜는 파이썬 스크립트였습니다. 자동화의 두뇌(카드 판별 · 정답 매칭 · 클릭 순서 ·
목표 점수 · 이탈 감지 우회)는 **로직 그대로** 옮기고, "브라우저를 조종하는 부분"만
플랫폼에 맞게 갈아 끼웠습니다.

| 원본 (PC / Selenium) | 📱 안드로이드 | 🧩 크롬 확장 |
|---|---|---|
| `driver.execute_script(...)` | `Driver.eval()` (WebView) | `Driver.eval()` (`chrome.scripting`, MAIN world) |
| CDP `Input.dispatchMouseEvent` (신뢰된 클릭) | 네이티브 `MotionEvent` 주입 | `chrome.debugger` → **같은 CDP** |
| `body.send_keys(SPACE)` | 네이티브 `KeyEvent` 주입 | CDP `Input.dispatchKeyEvent` |
| CDP `addScriptToEvaluateOnNewDocument` | `addDocumentStartJavaScript` | `document_start` 콘텐츠 스크립트 |
| 크롬 창 N개 (계정 격리) | WebView N개 + `ProfileStore` 분리 | 순차 실행 + 쿠키 정리 |
| 창 크기 1280×900 강제 | 데스크톱 UA + `initialScale` + viewport 강제 | (PC라 불필요) |
| `pynput` 글로벌 단축키 | 화면 하단 버튼 | 팝업 버튼 |
| `.env` 파일 | 앱 내 계정 설정 | 팝업 내 계정 설정 |

두 버전 모두 **페이지가 이동해도 자동화가 살아남도록** 조종 주체를 페이지 밖
(안드로이드는 코틀린 코루틴, 확장은 백그라운드 서비스 워커)에 두었습니다.
전체 자동화처럼 여러 페이지를 오가는 흐름이 이 구조라서 가능합니다.

### 이식이 맞는지 어떻게 검증했나

`android/tools/gen_reference.py` 가 **원본 파이썬 구현을 실제로 import 해서 실행**하고,
그 출력을 `reference.json` 으로 저장합니다. 두 이식본은 **같은 기준 파일**로 검증합니다.

```sh
node extension/test/parity.test.mjs      # 확장  — 223개 단언
cd android && ./gradlew testDebugUnitTest # 안드로이드 — 14개 테스트
```

정규화 함수 전부, 토큰화, `difflib.SequenceMatcher.ratio()`, 스크램블 정렬/다음 단어 선택,
문장 리콜 매칭, 스펠 정답 찾기, 단어 테스트 정답 고르기, 매칭 쌍 찾기, 오답 주입 개수를
원본과 한 글자도 다르지 않은지 대조합니다.

> 이 과정에서 실제 차이를 하나 잡았습니다: `Test.py` 의 `mnorm` 은 HTML 태그를 제거하지 **않고**
> `Matching.py` 의 `mnorm` 은 제거합니다. 처음엔 하나로 합쳤다가 테스트가 잡아내서 분리했습니다.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## 코드 구조

```
android/                                  📱 안드로이드 앱 (Kotlin)
  app/src/main/java/com/classcard/automation/
    MainActivity.kt        계정 리스트 · 학습 모드 · 고급 설정 · LOG 탭
    AccountStore.kt        계정 저장 / .env 파싱
    SettingsStore.kt       고급 설정 값
    LogBus.kt              로그(날짜별 보존)
    AutomationService.kt   포그라운드 서비스 + WakeLock
    core/
      Driver.kt      WebView 래퍼 (Selenium 대체)
      Session.kt     계정 1개 = WebView 1개
      Controller.kt  버튼 -> 전 계정 fan-out
      StopFlag.kt    threading.Event 대체
      Norm.kt        정규화/토큰화 (원본 함수별 1:1)
      Similarity.kt  difflib ratio 이식
      AntiBlur.kt    이탈 감지 우회
    modules/         자동화 모듈 (원본 파이썬 파일과 1:1) + Grammar.kt(문법훈련)
  app/src/main/assets/preload.js          문서 시작 주입
  app/src/test/                           이식 정확성 테스트

extension/                                🧩 크롬 확장 (MV3)
  manifest.json
  background.js                 오케스트레이터 (계정/실행/로그)
  content/preload.js            문서 시작 주입 (이탈 감지 우회 + 정답 캡처)
  engine/
    driver.js                   탭 조종 + CDP 신뢰된 입력
    norm.js  similarity.js      안드로이드판과 같은 내용
    modules/
      basic.js      HtmlParser · 암기 · 리콜 · 스펠
      sentence.js   문장 암기 · 문장 리콜
      games.js      단어/문장 테스트 · 매칭 · 스크램블
      grammar.js    문법훈련
      autoall.js    전체 자동화 · 한 세트 자동화
  popup/                        팝업 UI (안드로이드 앱과 같은 화면)
  test/parity.test.mjs          이식 정확성 테스트
  test/grammar.test.mjs         문법 보기 선택 로직 테스트
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## 직접 빌드하기

```sh
# 안드로이드 (JDK 17 + Android SDK 필요)
cd android && ./gradlew assembleDebug
#   -> app/build/outputs/apk/debug/app-debug.apk

# 확장 (빌드 과정 없음 — 폴더를 그대로 로드하거나 zip 으로 묶으면 끝)
cd extension && zip -r ../classcard-automation-extension.zip . -x 'test/*'
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] 자동 로그인 / 단어장 자동 추출
- [x] 단어·문장 암기 / 리콜 / 스펠
- [x] 단어·문장 테스트 (백그라운드 실행)
- [x] 매칭 / 스크램블 (백그라운드 실행)
- [x] 문법훈련
- [x] 전체 자동화 / 한 세트 자동화
- [x] 다계정
- [x] 📱 안드로이드 전용 버전
- [x] 🧩 크롬 확장프로그램 전용 버전

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the Unlicense License.

## Acknowledgments

* 원본 PC(파이썬) 버전: [youngmin0/Classcard-Automation](https://github.com/youngmin0/Classcard-Automation)
* [Best-README-Template](https://github.com/othneildrew/Best-README-Template)

<p align="right">(<a href="#readme-top">back to top</a>)</p>
