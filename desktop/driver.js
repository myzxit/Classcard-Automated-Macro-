/**
 * PC(exe) 버전의 창 조종기 — 확장의 `extension/engine/driver.js` 와 **같은 메서드 이름·같은 규칙**.
 *
 * 엔진 모듈(extension/engine/modules/**)은 드라이버의 이 인터페이스만 쓰므로,
 * 여기만 Electron 으로 바꿔 주면 12개 모드가 그대로 돈다.
 *
 *  - eval()            -> webContents.executeJavaScript  (확장의 chrome.scripting MAIN world 대응)
 *  - trustedClick()    -> webContents.debugger  `Input.dispatchMouseEvent` (확장의 chrome.debugger 와 같은 CDP)
 *  - pressKey/typeText -> `Input.dispatchKeyEvent`
 *
 * 클래스카드는 합성 클릭·합성 키를 버리는 화면이 많다(리콜 정답, 스펠 입력, 문장 낱말 타일).
 * CDP 로 보내는 입력은 브라우저가 진짜 입력으로 취급하므로(`isTrusted === true`) 전부 통과한다.
 */

import { StopFlag, Driver as ExtensionDriver } from './app/engine/driver.js';

export { StopFlag };

export class ElectronDriver {
  /**
   * @param {import('electron').BrowserWindow} win 조종할 창
   * @param {string} tag 로그 앞에 붙일 표시 (계정 아이디)
   * @param {(msg: string, level?: string) => void} logger
   */
  constructor(win, tag, logger) {
    this.win = win;
    this.tag = tag;
    this.logger = logger;
    this.debuggerAttached = false;
    this.debuggerFailed = false;
  }

  get wc() {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  log(message, level) {
    this.logger(`${this.tag} ${message}`, level);
  }

  // ---------------------------------------------------------------- eval

  /** 확장과 같은 규칙: 스크립트는 함수 본문으로 감싸지므로 `return` 을 그대로 쓴다. 실패는 null. */
  async eval(script) {
    const wc = this.wc;
    if (!wc) return null;
    try {
      const value = await wc.executeJavaScript(
        `(function () { try { return new Function(${JSON.stringify(script)})(); } catch (e) { return null; } })()`,
        true,
      );
      return value === undefined ? null : value;
    } catch (e) {
      // 페이지 이동 중이거나 창이 닫혔으면 null (확장의 except 분기와 같은 취급)
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
    const wc = this.wc;
    try {
      return wc ? wc.getURL() || '' : '';
    } catch (e) {
      return '';
    }
  }

  async title() {
    const wc = this.wc;
    try {
      return wc ? wc.getTitle() || '' : '';
    } catch (e) {
      return '';
    }
  }

  async loadUrl(url) {
    const wc = this.wc;
    if (!wc) return;
    try {
      await wc.loadURL(url);
    } catch (e) {
      // 리다이렉트/중단(ERR_ABORTED)은 흔하다 — 아래 waitForLoad 가 마무리를 기다린다.
    }
    await this.waitForLoad();
  }

  async waitForLoad(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const wc = this.wc;
      if (!wc) return false;
      if (!wc.isLoading()) {
        await new Promise((r) => setTimeout(r, 250));
        return true;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  async waitForSelector(selector, timeoutMs, stop = null) {
    return ExtensionDriver.prototype.waitForSelector.call(this, selector, timeoutMs, stop);
  }

  async waitForVisible(selector, timeoutMs, stop = null) {
    return ExtensionDriver.prototype.waitForVisible.call(this, selector, timeoutMs, stop);
  }

  // --------------------------------------------------------------- 클릭

  async clickSmart(pick) {
    return ExtensionDriver.prototype.clickSmart.call(this, pick);
  }

  async clickIndex(selector, index) {
    return ExtensionDriver.prototype.clickIndex.call(this, selector, index);
  }

  async clickFirst(selector) {
    return ExtensionDriver.prototype.clickFirst.call(this, selector);
  }

  async clickFirstVisible(selector) {
    return ExtensionDriver.prototype.clickFirstVisible.call(this, selector);
  }

  // ------------------------------------------------------- CDP (신뢰된 입력)

  async attachDebugger() {
    if (this.debuggerAttached || this.debuggerFailed) return this.debuggerAttached;
    const wc = this.wc;
    if (!wc) return false;
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      this.debuggerAttached = true;
    } catch (e) {
      const message = String(e && e.message ? e.message : e);
      if (message.includes('already attached')) {
        this.debuggerAttached = true;
      } else {
        this.debuggerFailed = true;
        this.log(`[!] 신뢰된 입력(CDP) 연결 실패: ${message} — 합성 이벤트로 진행합니다.`, 'warn');
      }
    }
    return this.debuggerAttached;
  }

  async detachDebugger() {
    if (!this.debuggerAttached) return;
    const wc = this.wc;
    try {
      if (wc && wc.debugger.isAttached()) wc.debugger.detach();
    } catch (e) {
      // 이미 떨어졌으면 무시
    }
    this.debuggerAttached = false;
  }

  async sendCdp(method, params) {
    if (!this.debuggerAttached) return false;
    const wc = this.wc;
    if (!wc) return false;
    try {
      await wc.debugger.sendCommand(method, params);
      return true;
    } catch (e) {
      return false;
    }
  }

  async trustedClick(locatorJs) {
    return ExtensionDriver.prototype.trustedClick.call(this, locatorJs);
  }

  // ----------------------------------------------------------------- 키

  async pressKey(key, opts) {
    return ExtensionDriver.prototype.pressKey.call(this, key, opts);
  }

  async pressSpace() { return this.pressKey('space'); }
  async pressShiftSpace() { return this.pressKey('space', { shift: true }); }
  async pressEnter() { return this.pressKey('enter'); }

  async pressDigit(digit) {
    if (digit < 0 || digit > 9) return false;
    return this.pressKey(String(digit));
  }

  async typeText(text) {
    return ExtensionDriver.prototype.typeText.call(this, text);
  }

  async blurActiveElement() {
    await this.exec('if (document.activeElement && document.activeElement.blur) document.activeElement.blur();');
  }
}
