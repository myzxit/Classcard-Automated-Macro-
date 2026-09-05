package com.classcard.automation.core

import android.annotation.SuppressLint
import android.os.SystemClock
import android.view.KeyEvent
import android.view.MotionEvent
import android.webkit.WebView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import kotlin.coroutines.resume

/**
 * Selenium WebDriver 를 대신하는 WebView 래퍼.
 *
 * 기존 파이썬 코드의 `driver.execute_script(...)` 는 [eval] 로 1:1 대응되므로
 * JS 스니펫과 CSS 셀렉터를 문자 그대로 재사용한다.
 *
 * CDP 로만 가능했던 두 가지도 안드로이드 네이티브로 동등하게 대체한다.
 *  - `Input.dispatchMouseEvent`(trusted 클릭)  -> [trustedClickAt] (MotionEvent 주입)
 *  - `body.send_keys(...)`(trusted 키)         -> [pressKey] (KeyEvent 주입)
 */
class Driver(
    val webView: WebView,
    val tag: String,
    private val logger: (String) -> Unit,
) {

    /** 페이지가 로드될 때마다 증가. 네비게이션 완료 감지에 쓴다. */
    @Volatile
    var loadCounter: Int = 0
        private set

    @Volatile
    var pageFinished: Boolean = true
        private set

    fun onPageStarted() {
        pageFinished = false
    }

    fun onPageFinished() {
        pageFinished = true
        loadCounter++
    }

    fun log(message: String) = logger("$tag $message")

    // ---------------------------------------------------------------- eval

    /**
     * 파이썬 `driver.execute_script(script)` 대응.
     * Selenium 과 동일하게 스크립트는 함수 본문으로 감싸지므로 `return` 을 그대로 쓸 수 있다.
     * 반환값은 JSON 문자열("null" 포함)이며, 실패하면 "null".
     */
    suspend fun eval(script: String): String = withContext(Dispatchers.Main) {
        val wrapped = "(function(){try{$script}catch(e){return null;}})()"
        suspendCancellableCoroutine { cont ->
            try {
                webView.evaluateJavascript(wrapped) { value ->
                    if (cont.isActive) cont.resume(value ?: "null")
                }
            } catch (e: Throwable) {
                if (cont.isActive) cont.resume("null")
            }
        }
    }

    /** 반환값을 무시하는 실행. */
    suspend fun exec(script: String) {
        eval(script)
    }

    suspend fun evalBool(script: String): Boolean = eval(script).trim() == "true"

    suspend fun evalIntOrNull(script: String): Int? {
        val raw = eval(script).trim()
        if (raw == "null" || raw.isEmpty()) return null
        val unquoted = raw.trim('"')
        return unquoted.toIntOrNull() ?: unquoted.toDoubleOrNull()?.toInt()
    }

    suspend fun evalInt(script: String, fallback: Int = 0): Int = evalIntOrNull(script) ?: fallback

    /** JSON 문자열 값을 코틀린 String 으로. JS 가 null 이면 null. */
    suspend fun evalStringOrNull(script: String): String? {
        val raw = eval(script).trim()
        if (raw == "null" || raw.isEmpty() || raw == "undefined") return null
        return try {
            when (val parsed = JSONTokener(raw).nextValue()) {
                JSONObject.NULL -> null
                is String -> parsed
                else -> parsed.toString()
            }
        } catch (e: Throwable) {
            raw.trim('"')
        }
    }

    suspend fun evalObjectOrNull(script: String): JSONObject? {
        val raw = eval(script).trim()
        if (raw == "null" || raw.isEmpty()) return null
        return try {
            JSONObject(raw)
        } catch (e: Throwable) {
            null
        }
    }

    suspend fun evalArrayOrNull(script: String): JSONArray? {
        val raw = eval(script).trim()
        if (raw == "null" || raw.isEmpty()) return null
        return try {
            JSONArray(raw)
        } catch (e: Throwable) {
            null
        }
    }

    /** 문자열 배열을 반환하는 스크립트용. 실패하면 빈 리스트. */
    suspend fun evalStringList(script: String): List<String> {
        val arr = evalArrayOrNull(script) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it, "") }
    }

    // ------------------------------------------------------------ 페이지 상태

    suspend fun currentUrl(): String = withContext(Dispatchers.Main) { webView.url ?: "" }

    suspend fun title(): String = withContext(Dispatchers.Main) { webView.title ?: "" }

    suspend fun loadUrl(url: String) = withContext(Dispatchers.Main) {
        pageFinished = false
        webView.loadUrl(url)
    }

    /** 로드가 끝날 때까지 대기. 이미 끝나 있으면 즉시 true. */
    suspend fun waitForLoad(timeoutMs: Long = 15000): Boolean {
        val ok = withTimeoutOrNull(timeoutMs) {
            while (!pageFinished) delay(100)
            true
        }
        // 렌더/스크립트가 자리 잡을 여유
        delay(250)
        return ok == true
    }

    /**
     * 파이썬 `WebDriverWait(...).until(presence_of_element_located(...))` 대응.
     * 셀렉터에 해당하는 요소가 나타날 때까지 폴링한다.
     */
    suspend fun waitForSelector(selector: String, timeoutMs: Long, stop: StopFlag? = null): Boolean {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        while (SystemClock.uptimeMillis() < deadline) {
            if (stop?.isSet == true) return false
            if (evalBool("return document.querySelectorAll(${selector.jsStr()}).length > 0;")) return true
            if (stop != null) {
                if (stop.await(200)) return false
            } else {
                delay(200)
            }
        }
        return evalBool("return document.querySelectorAll(${selector.jsStr()}).length > 0;")
    }

    /** 보이는(=offsetParent 존재) 요소가 나타날 때까지 대기. */
    suspend fun waitForVisible(selector: String, timeoutMs: Long, stop: StopFlag? = null): Boolean {
        val js = """
            var els = document.querySelectorAll(${selector.jsStr()});
            for (var i = 0; i < els.length; i++) {
                if (els[i].offsetParent !== null) return true;
            }
            return false;
        """
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        while (SystemClock.uptimeMillis() < deadline) {
            if (stop?.isSet == true) return false
            if (evalBool(js)) return true
            if (stop != null) {
                if (stop.await(200)) return false
            } else {
                delay(200)
            }
        }
        return evalBool(js)
    }

    // --------------------------------------------------------------- 클릭

    /**
     * 합성 클릭 (Selenium 의 `driver.execute_script("arguments[0].click()")` 대응).
     * 셀렉터의 [index] 번째 요소를 클릭한다. 클릭했으면 true.
     */
    suspend fun clickIndex(selector: String, index: Int): Boolean = evalBool(
        """
        var e = document.querySelectorAll(${selector.jsStr()});
        if (e[$index]) { e[$index].click(); return true; }
        return false;
        """
    )

    /** 셀렉터의 첫 요소를 클릭. */
    suspend fun clickFirst(selector: String): Boolean = clickIndex(selector, 0)

    /** 보이는 첫 요소를 클릭. */
    suspend fun clickFirstVisible(selector: String): Boolean = evalBool(
        """
        var e = document.querySelectorAll(${selector.jsStr()});
        for (var i = 0; i < e.length; i++) {
            if (e[i].offsetParent !== null) { e[i].click(); return true; }
        }
        return false;
        """
    )

    /**
     * CDP `Input.dispatchMouseEvent` 대응 — **진짜(trusted) 클릭**.
     *
     * 문장 테스트의 스크램블 버튼은 합성 click 을 전부 무시하고 신뢰된 마우스 이벤트에만
     * 반응하므로, 네이티브 MotionEvent 를 WebView 에 직접 주입한다.
     *
     * @param locatorJs `{x, y, w}` (뷰포트 기준 CSS 좌표 + window.innerWidth)를 반환하는 스크립트.
     */
    suspend fun trustedClick(locatorJs: String): Boolean {
        val pos = evalObjectOrNull(locatorJs) ?: return false
        val cssX = pos.optDouble("x", -1.0)
        val cssY = pos.optDouble("y", -1.0)
        val innerWidth = pos.optDouble("w", 0.0)
        if (cssX < 0 || cssY < 0 || innerWidth <= 0) return false
        return trustedClickAt(cssX, cssY, innerWidth)
    }

    /** CSS 뷰포트 좌표를 뷰 픽셀로 환산해 MotionEvent 를 주입한다. */
    @SuppressLint("Recycle")
    suspend fun trustedClickAt(cssX: Double, cssY: Double, innerWidth: Double): Boolean =
        withContext(Dispatchers.Main) {
            val viewWidth = webView.width
            if (viewWidth <= 0 || innerWidth <= 0) return@withContext false
            val scale = viewWidth / innerWidth
            val x = (cssX * scale).toFloat()
            val y = (cssY * scale).toFloat()
            if (x < 0 || y < 0 || x > webView.width || y > webView.height) return@withContext false

            val down = SystemClock.uptimeMillis()
            val downEvent = MotionEvent.obtain(down, down, MotionEvent.ACTION_DOWN, x, y, 0)
            val upEvent = MotionEvent.obtain(down, down + 60, MotionEvent.ACTION_UP, x, y, 0)
            try {
                webView.dispatchTouchEvent(downEvent)
                webView.dispatchTouchEvent(upEvent)
                true
            } finally {
                downEvent.recycle()
                upEvent.recycle()
            }
        }

    // ----------------------------------------------------------------- 키

    /**
     * 파이썬 `body.send_keys(...)` 대응 — 네이티브 KeyEvent 주입(trusted).
     * WebView 가 포커스를 못 잡은 경우에만 합성 KeyboardEvent 로 폴백한다.
     */
    suspend fun pressKey(keyCode: Int, shift: Boolean = false): Boolean {
        val delivered = withContext(Dispatchers.Main) {
            if (!webView.hasFocus()) webView.requestFocus()
            if (!webView.hasFocus()) return@withContext false
            val now = SystemClock.uptimeMillis()
            val meta = if (shift) KeyEvent.META_SHIFT_ON or KeyEvent.META_SHIFT_LEFT_ON else 0
            val down = KeyEvent(now, now, KeyEvent.ACTION_DOWN, keyCode, 0, meta)
            val up = KeyEvent(now, now + 30, KeyEvent.ACTION_UP, keyCode, 0, meta)
            webView.dispatchKeyEvent(down)
            webView.dispatchKeyEvent(up)
            true
        }
        if (delivered) return true
        return dispatchSyntheticKey(keyCode, shift)
    }

    /** 포커스를 못 잡았을 때의 폴백: 페이지에 KeyboardEvent 를 합성해 보낸다. */
    private suspend fun dispatchSyntheticKey(keyCode: Int, shift: Boolean): Boolean {
        val (key, code, which) = when (keyCode) {
            KeyEvent.KEYCODE_SPACE -> Triple(" ", "Space", 32)
            KeyEvent.KEYCODE_ENTER -> Triple("Enter", "Enter", 13)
            in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> {
                val digit = keyCode - KeyEvent.KEYCODE_0
                Triple(digit.toString(), "Digit$digit", 48 + digit)
            }
            else -> return false
        }
        return evalBool(
            """
            var opts = {key: ${key.jsStr()}, code: ${code.jsStr()}, keyCode: $which, which: $which,
                        shiftKey: $shift, bubbles: true, cancelable: true};
            var t = document.activeElement || document.body;
            t.dispatchEvent(new KeyboardEvent('keydown', opts));
            t.dispatchEvent(new KeyboardEvent('keypress', opts));
            t.dispatchEvent(new KeyboardEvent('keyup', opts));
            return true;
            """
        )
    }

    suspend fun pressSpace(): Boolean = pressKey(KeyEvent.KEYCODE_SPACE)

    /** 파이썬 `ActionChains(...).key_down(SHIFT).send_keys(SPACE).key_up(SHIFT)` 대응. */
    suspend fun pressShiftSpace(): Boolean = pressKey(KeyEvent.KEYCODE_SPACE, shift = true)

    suspend fun pressEnter(): Boolean = pressKey(KeyEvent.KEYCODE_ENTER)

    suspend fun pressDigit(digit: Int): Boolean {
        if (digit !in 0..9) return false
        return pressKey(KeyEvent.KEYCODE_0 + digit)
    }

    /** 입력창이 키 이벤트를 받을 수 있도록 포커스를 뺏지 않게 body 로 포커스를 되돌린다. */
    suspend fun blurActiveElement() {
        exec("if (document.activeElement && document.activeElement.blur) document.activeElement.blur();")
    }

}

/** 코틀린 문자열을 JS 리터럴로 안전하게 감싼다. */
internal fun String.jsStr(): String = JSONObject.quote(this)
