/**
 * 배경 스크립트(서비스 워커)를 깨어 있게 붙잡아 둔다.
 *
 * MV3 의 서비스 워커는 **들어오는 이벤트가 30초 동안 없으면** 크롬이 꺼 버린다.
 * 우리가 부르는 `chrome.scripting.executeScript` 같은 '호출'은 이 30초 시계를 되돌리지 못한다.
 * 그리고 `chrome.alarms` 의 최소 주기(0.5분)는 크롬이 더 길게 깎아 버리는 경우가 있어
 * 알람만으로는 30초 안에 확실히 닿지 못한다.
 *
 * 그래서 겪던 증상: 스피킹의 마이크 단계처럼 한 카드에서 몇 초씩 기다리는 모드에서
 * 기다리는 사이에 워커가 꺼지고, 자동화가 **로그도 오류도 없이** 그 자리에서 조용히 멈췄다.
 * (오래 '마지막 카드에서 멈춘다'고 본 것은 착각이었다 — 카드 수를 늘리면 두 번째 카드에서 멈춘다.
 *  마지막 카드가 아니라 '시작하고 30초쯤'이 기준이었다.)
 *
 * 열린 포트 하나는 이야기가 다르다 — 포트가 연결되어 있는 동안 크롬은 워커를 살려 둔다.
 * 그래서 학습 페이지가 열려 있는 동안 포트를 붙잡고 10초마다 한 번씩 말을 건다.
 * (이 스크립트는 페이지의 코드와 섞이지 않는 ISOLATED 세계에서 돈다 — chrome.runtime 이 필요하다)
 */

let port = null;

function connect() {
  try {
    port = chrome.runtime.connect({ name: 'cc-keepalive' });
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connect, 1000);
    });
  } catch (e) {
    port = null;
    setTimeout(connect, 2000);
  }
}

connect();

// 10초마다 한 번 — 30초 시계가 다 돌지 못하게 한다
setInterval(() => {
  try {
    if (port) port.postMessage({ t: Date.now() });
    else connect();
  } catch (e) {
    connect();
  }
  // 포트 메시지만으로는 30초 시계가 되돌아가지 않는 크롬이 있다.
  // 보통 메시지(chrome.runtime.onMessage)는 확실한 '이벤트'라 시계를 되돌린다.
  try { chrome.runtime.sendMessage({ type: 'keepalive' }).catch(() => {}); } catch (e) { /* 무시 */ }
}, 10000);

// 크롬은 오래된 포트를 5분쯤에 끊는다 — 그 전에 새로 맺어 둔다
setInterval(connect, 4 * 60 * 1000);
