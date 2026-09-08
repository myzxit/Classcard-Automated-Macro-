/**
 * Selenium WebDriver 를 대신하는 탭 조종기.
 *
 * 파이썬 원본의 두 축을 그대로 옮겼다.
 *  - `driver.execute_script(...)`            -> eval()  (chrome.scripting, world: MAIN)
 *  - CDP `Input.dispatchMouseEvent` / 키 입력 -> chrome.debugger (원본과 '같은' CDP다)
 *
 * 페이지가 이동해도 이 객체는 백그라운드에 살아 있으므로, AutoAll 처럼
 * 여러 페이지를 오가는 흐름도 그대로 동작한다.
 */

/** 파이썬 `threading.Event` 대응. await(ms) 는 "중지되었으면 true". */
export class StopFlag {
  constructor(parent = null) {
    this.parent = parent;
    this.stopped = false;
  }

  get isSet() {
    return this.stopped || (this.parent ? this.parent.isSet : false);
  }

  set() {
    this.stopped = true;
  }

  async await(ms) {
    if (this.isSet) return true;
    const tick = 50;
    let left = ms;
    while (left > 0) {
      await new Promise((r) => setTimeout(r, Math.min(tick, left)));
      left -= tick;
      if (this.isSet) return true;
    }
    return this.isSet;
  }

  async sleep(ms) {
    await this.await(ms);
  }
}

export class Driver {
  /**
   * @param {number} tabId 조종할 탭
   * @param {string} tag 로그 앞에 붙일 표시 (계정 아이디)
   * @param {(msg: string, level?: string) => void} logger
   */
  constructor(tabId, tag, logger) {
    this.tabId = tabId;
    this.tag = tag;
    this.logger = logger;
    this.debuggerAttached = false;
    this.debuggerFailed = false;
  }

  log(message, level) {
    this.logger(`${this.tag} ${message}`, level);
  }

  // ---------------------------------------------------------------- eval

  /**
   * 파이썬 `driver.execute_script(script)` 대응.
   * Selenium 과 동일하게 스크립트는 함수 본문으로 감싸지므로 `return` 을 그대로 쓴다.
   * 페이지 전역(study_data, card_list, window.__cc_answers)에 닿아야 하므로 MAIN world.
   */
  async eval(script) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: this.tabId },
        world: 'MAIN',
        args: [script],
        func: (src) => {
          try {
            // eslint-disable-next-line no-new-func
            return new Function(src)();
          } catch (e) {
            return null;
          }
        },
      });
      const value = results && results[0] ? results[0].result : null;
      return value === undefined ? null : value;
    } catch (e) {
      // 탭이 닫혔거나 이동 중이면 null (원본의 except 분기와 같은 취급)
      return null;
    }
  }

  async exec(script) {
    await this.eval(script);
  }

  async evalBool(script) {
    return (await this.eval(script)) === true;
  }

  async evalIntOrNull(script) {
    const value = await this.eval(script);
    if (value === null || value === undefined || value === '') return null;
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? null : n;
  }

  async evalStringOrNull(script) {
    const value = await this.eval(script);
    if (value === null || value === undefined) return null;
    return String(value);
  }

  async evalList(script) {
    const value = await this.eval(script);
    return Array.isArray(value) ? value : [];
  }

  // ------------------------------------------------------------ 페이지 상태

  async currentUrl() {
    try {
      const tab = await chrome.tabs.get(this.tabId);
      return tab.url || '';
    } catch (e) {
      return '';
    }
  }

  async title() {
    try {
      const tab = await chrome.tabs.get(this.tabId);
      return tab.title || '';
    } catch (e) {
      return '';
    }
  }

  async loadUrl(url) {
    await chrome.tabs.update(this.tabId, { url });
    await this.waitForLoad();
  }

  /** 탭 로딩이 끝날 때까지 대기. */
  async waitForLoad(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const tab = await chrome.tabs.get(this.tabId);
        if (tab.status === 'complete') {
          await new Promise((r) => setTimeout(r, 250));
          return true;
        }
      } catch (e) {
        return false;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  /** 파이썬 `WebDriverWait(...).until(presence_of_element_located(...))` 대응. */
  async waitForSelector(selector, timeoutMs, stop = null) {
    const script = `return document.querySelectorAll(${JSON.stringify(selector)}).length > 0;`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (stop && stop.isSet) return false;
      if (await this.evalBool(script)) return true;
      if (stop) {
        if (await stop.await(200)) return false;
      } else {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    return this.evalBool(script);
  }

  /** 보이는(offsetParent 존재) 요소가 나타날 때까지 대기. */
  async waitForVisible(selector, timeoutMs, stop = null) {
    const script = `
      var els = document.querySelectorAll(${JSON.stringify(selector)});
      for (var i = 0; i < els.length; i++) {
        if (els[i].offsetParent !== null) return true;
      }
      return false;`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (stop && stop.isSet) return false;
      if (await this.evalBool(script)) return true;
      if (stop) {
        if (await stop.await(200)) return false;
      } else {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    return this.evalBool(script);
  }

  // --------------------------------------------------------------- 클릭

  /** 합성 클릭 — selector 의 index 번째 요소. */
  async clickIndex(selector, index) {
    return this.evalBool(`
      var e = document.querySelectorAll(${JSON.stringify(selector)});
      if (e[${index}]) { e[${index}].click(); return true; }
      return false;`);
  }

  async clickFirst(selector) {
    return this.clickIndex(selector, 0);
  }

  async clickFirstVisible(selector) {
    return this.evalBool(`
      var e = document.querySelectorAll(${JSON.stringify(selector)});
      for (var i = 0; i < e.length; i++) {
        if (e[i].offsetParent !== null) { e[i].click(); return true; }
      }
      return false;`);
  }

  // ------------------------------------------------------- CDP (신뢰된 입력)

  /** 자동화 시작 시 한 번 붙인다. 실패해도 합성 이벤트로 계속 진행한다. */
  async attachDebugger() {
    if (this.debuggerAttached || this.debuggerFailed) return this.debuggerAttached;
    try {
      await chrome.debugger.attach({ tabId: this.tabId }, '1.3');
      this.debuggerAttached = true;
    } catch (e) {
      const message = String(e && e.message ? e.message : e);
      // 이미 붙어 있으면 그대로 쓴다.
      if (message.includes('already attached')) {
        this.debuggerAttached = true;
      } else {
        this.debuggerFailed = true;
        this.log(
          `[!] 신뢰된 입력(CDP) 연결 실패: ${message} — 합성 이벤트로 진행합니다. ` +
            '문장 테스트는 이 경우 동작하지 않을 수 있습니다.',
          'warn',
        );
      }
    }
    return this.debuggerAttached;
  }

  async detachDebugger() {
    if (!this.debuggerAttached) return;
    try {
      await chrome.debugger.detach({ tabId: this.tabId });
    } catch (e) {
      // 이미 떨어졌으면 무시
    }
    this.debuggerAttached = false;
  }

  async sendCdp(method, params) {
    if (!this.debuggerAttached) return false;
    try {
      await chrome.debugger.sendCommand({ tabId: this.tabId }, method, params);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * CDP `Input.dispatchMouseEvent` — 원본 `_cdp_click` 과 완전히 동일한 경로.
   * @param {string} locatorJs `{x, y}` (뷰포트 기준 CSS 좌표)를 반환하는 스크립트
   */
  async trustedClick(locatorJs) {
    const pos = await this.eval(locatorJs);
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return false;
    if (!this.debuggerAttached) return false;

    const { x, y } = pos;
    const ok1 = await this.sendCdp('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, buttons: 0,
    });
    const ok2 = await this.sendCdp('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
    });
    const ok3 = await this.sendCdp('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1,
    });
    return ok1 && ok2 && ok3;
  }

  // ----------------------------------------------------------------- 키

  /**
   * 파이썬 `body.send_keys(...)` 대응.
   * CDP 가 붙어 있으면 신뢰된 키 이벤트, 아니면 합성 KeyboardEvent 로 폴백.
   */
  async pressKey(key, { shift = false } = {}) {
    const spec = KEY_SPECS[key];
    if (!spec) return false;

    if (this.debuggerAttached) {
      const modifiers = shift ? 8 : 0;
      const base = {
        modifiers,
        key: spec.key,
        code: spec.code,
        windowsVirtualKeyCode: spec.keyCode,
        nativeVirtualKeyCode: spec.keyCode,
      };
      const down = await this.sendCdp('Input.dispatchKeyEvent', {
        ...base,
        type: spec.text ? 'keyDown' : 'rawKeyDown',
        text: spec.text || '',
      });
      const up = await this.sendCdp('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
      if (down && up) return true;
    }

    return this.evalBool(`
      var opts = {key: ${JSON.stringify(spec.key)}, code: ${JSON.stringify(spec.code)},
                  keyCode: ${spec.keyCode}, which: ${spec.keyCode},
                  shiftKey: ${shift}, bubbles: true, cancelable: true};
      var t = document.activeElement || document.body;
      t.dispatchEvent(new KeyboardEvent('keydown', opts));
      t.dispatchEvent(new KeyboardEvent('keypress', opts));
      t.dispatchEvent(new KeyboardEvent('keyup', opts));
      return true;`);
  }

  async pressSpace() {
    return this.pressKey('space');
  }

  /** 파이썬 `ActionChains(...).key_down(SHIFT).send_keys(SPACE)` 대응. */
  async pressShiftSpace() {
    return this.pressKey('space', { shift: true });
  }

  async pressEnter() {
    return this.pressKey('enter');
  }

  async pressDigit(digit) {
    if (digit < 0 || digit > 9) return false;
    return this.pressKey(String(digit));
  }

  async blurActiveElement() {
    await this.exec('if (document.activeElement && document.activeElement.blur) document.activeElement.blur();');
  }
}

const KEY_SPECS = {
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  0: { key: '0', code: 'Digit0', keyCode: 48, text: '0' },
  1: { key: '1', code: 'Digit1', keyCode: 49, text: '1' },
  2: { key: '2', code: 'Digit2', keyCode: 50, text: '2' },
  3: { key: '3', code: 'Digit3', keyCode: 51, text: '3' },
  4: { key: '4', code: 'Digit4', keyCode: 52, text: '4' },
  5: { key: '5', code: 'Digit5', keyCode: 53, text: '5' },
  6: { key: '6', code: 'Digit6', keyCode: 54, text: '6' },
  7: { key: '7', code: 'Digit7', keyCode: 55, text: '7' },
  8: { key: '8', code: 'Digit8', keyCode: 56, text: '8' },
  9: { key: '9', code: 'Digit9', keyCode: 57, text: '9' },
};
