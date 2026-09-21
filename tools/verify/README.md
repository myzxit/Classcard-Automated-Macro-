# 검증 도구

매크로가 실제 사이트 규칙대로 끝까지 도는지 확인하는 도구 모음. CI 와 자동 점검(Routine)이 이걸 돌린다.

## 모의 화면 회귀 (인터넷·계정 불필요)

```bash
bash tools/verify/run.sh                 # 23종 전부 (약 11분)
bash tools/verify/run.sh run_gstreak     # 하나만
```

`shots/mock_*.html` 은 실제 사이트 스크립트에서 확인한 규칙을 그대로 흉내 낸 화면이다:
합성 클릭·키를 버리는 리콜/스펠/문장 낱말, 자동 재생이 막힌 개념 톡, '5 연속 정답' 축하 화면,
채점 결과 화면, 클래스 페이지의 잠금/완료 상태, '지금 보는 탭 사용' + 자동 로그인 …
각 러너(`shots/run_*.mjs`)는 크롬 확장을 실제로 띄워 그 모드를 돌리고 `결과:` 한 줄을 찍는다.
`✗` 가 하나라도 있으면 실패(exit 1). 결과는 `last_result.txt` 에 남는다.

## 실제 사이트 (계정 필요)

```bash
CC_ID=아이디 CC_PW=비밀번호 node tools/verify/shots/run_live.mjs /GClass/124338 grammar 600
CC_ID=아이디 CC_PW=비밀번호 node tools/verify/shots/run_live.mjs /Recall/1593581/1 recall 240
```

진짜 세션·진짜 소리로 돌리며 이동 기록, 서버에 보낸 요청, 소리를 끝까지 들었는지, 확장 로그를 찍는다.
(브라우저가 프록시를 못 타는 환경용으로 요청을 curl 로 중계한다 — `live_fetch.mjs`.)
**학습 기록이 실제 계정에 남는다.** 자격증명은 환경변수로만 넘기고 어디에도 적지 않는다.

## PC 앱

```bash
cd desktop && CC_NO_SANDBOX=1 xvfb-run -a node test/smoke.mjs /tmp/shots/mock_recall2.html recall
```
