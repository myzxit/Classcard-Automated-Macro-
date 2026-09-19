/*
 * 조작 창(팝업 UI)용 브리지.
 *
 * PC 버전은 크롬 확장의 팝업 화면(extension/popup/**)을 **그대로** 띄운다.
 * 팝업 코드는 `chrome.runtime.sendMessage` 로 명령을 보내고 `chrome.runtime.onMessage` 로
 * 로그/상태를 받는데, 여기서 그 두 개를 IPC 로 이어 준다. 렌더러에는 크로미움 자체의
 * `window.chrome` 이 이미 있어 같은 이름으로는 못 올리므로 `ccBridge` 로 올리고, 팝업 쪽이 그걸 집어 쓴다.
 */
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
ipcRenderer.on('msg', (_event, message) => {
  for (const fn of listeners) {
    try { fn(message); } catch (e) { /* 리스너 하나가 죽어도 나머지는 받는다 */ }
  }
});

const manifest = ipcRenderer.sendSync('manifest');

contextBridge.exposeInMainWorld('ccBridge', {
  runtime: {
    ccDesktop: true,
    getManifest: () => manifest,
    sendMessage: (message) => ipcRenderer.invoke('msg', message),
    onMessage: {
      addListener: (fn) => { listeners.add(fn); },
      removeListener: (fn) => { listeners.delete(fn); },
    },
  },
  tabs: {
    // 계정 행을 누르면 그 계정의 창을 앞으로 가져온다
    update: (winId, opts) => {
      if (opts && opts.active) ipcRenderer.invoke('focusWindow', winId);
    },
  },
});
