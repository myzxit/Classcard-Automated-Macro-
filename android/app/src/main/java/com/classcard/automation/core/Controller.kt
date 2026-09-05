package com.classcard.automation.core

import android.content.Context
import android.webkit.WebView
import com.classcard.automation.AccountInfo
import com.classcard.automation.LogBus
import com.classcard.automation.modules.AutoAll
import com.classcard.automation.modules.FlowFn
import com.classcard.automation.modules.HtmlParser
import com.classcard.automation.modules.ModeFn
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * 파이썬 main.py 의 컨트롤러 부분에 대응.
 * 단축키 한 번이 모든 계정에 fan-out 되던 동작을 버튼 한 번으로 옮겼다.
 */
class Controller(
    private val context: Context,
    private val scope: CoroutineScope,
) {

    val sessions = mutableListOf<Session>()

    /** 계정 목록으로 세션(WebView)들을 만든다. 이미 있으면 먼저 정리한다. */
    fun createSessions(accounts: List<AccountInfo>, preloadScript: String): List<Session> {
        destroy()
        accounts.forEachIndexed { index, account ->
            val session = Session.createWebView(context, account, index, preloadScript)
            sessions.add(session)
        }
        if (sessions.isNotEmpty() && sessions.none { it.isolated }) {
            LogBus.log(
                "[!] 이 기기의 WebView는 계정별 쿠키 격리(멀티 프로필)를 지원하지 않습니다. " +
                    "여러 계정을 동시에 로그인하면 세션이 섞이므로 계정을 하나씩 사용하세요."
            )
        }
        return sessions
    }

    fun destroy() {
        sessions.forEach {
            it.stopAutomation()
            try {
                it.webView.stopLoading()
                it.webView.destroy()
            } catch (e: Throwable) {
                // 이미 정리된 경우 무시
            }
        }
        sessions.clear()
    }

    /** WebView 가 배치된 뒤 CSS 뷰포트가 1280px 이 되도록 스케일을 맞춘다. */
    fun applyDesktopScale(webView: WebView) {
        val widthPx = webView.width
        if (widthPx <= 0) return
        val scale = (widthPx.toFloat() / Session.VIEWPORT_WIDTH * 100f).toInt().coerceIn(1, 100)
        webView.setInitialScale(scale)
    }

    /** 로그인 페이지를 열고 자동 로그인한다. (파이썬 initialize_browser + auto_login) */
    fun launch(session: Session) {
        scope.launch {
            session.driver.loadUrl(Session.LOGIN_URL)
            session.driver.waitForLoad()
            autoLogin(session)
            checkViewport(session)
        }
    }

    /** main.py 의 `auto_login` 이식. */
    private suspend fun autoLogin(session: Session) {
        val d = session.driver
        val account = session.account
        if (account.id.isBlank() || account.pw.isBlank()) {
            d.log("[!] 아이디/비밀번호가 없습니다. 수동 로그인하세요.")
            return
        }

        val idSelector =
            "input[type='text'][name*='id' i], input[type='text'][name*='Id' i], " +
                "input#userId, input[placeholder*='아이디']"

        if (!d.waitForSelector(idSelector, 10_000)) {
            d.log("[!] 자동 로그인 실패: 로그인 폼을 찾지 못했습니다. 수동으로 로그인해 주세요.")
            return
        }

        val filled = d.evalBool(
            """
            function setValue(el, v) {
                var setter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value').set;
                setter.call(el, v);
                el.dispatchEvent(new Event('input', {bubbles: true}));
                el.dispatchEvent(new Event('change', {bubbles: true}));
            }
            var idInput = document.querySelector(${idSelector.jsStr()});
            var pwInput = document.querySelector("input[type='password']");
            if (!idInput || !pwInput) return false;
            setValue(idInput, ${account.id.jsStr()});
            setValue(pwInput, ${account.pw.jsStr()});
            return true;
            """
        )
        if (!filled) {
            d.log("[!] 자동 로그인 실패: 입력창을 찾지 못했습니다. 수동으로 로그인해 주세요.")
            return
        }

        val beforeUrl = d.currentUrl()
        val clicked = d.evalBool(
            """
            var btn = document.querySelector('a.btn-login');
            if (!btn) return false;
            btn.click();
            return true;
            """
        )
        if (!clicked) {
            d.log("[!] 자동 로그인 실패: 로그인 버튼을 찾지 못했습니다. 수동으로 로그인해 주세요.")
            return
        }

        // URL 이 바뀔 때까지 대기 (원본 wait.until(EC.url_changes(URL)))
        val deadline = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < deadline) {
            if (d.currentUrl() != beforeUrl) {
                d.waitForLoad()
                d.log("[O] 로그인 성공")
                return
            }
            kotlinx.coroutines.delay(300)
        }
        d.log("[!] 자동 로그인 실패(시간 초과). 수동으로 로그인해 주세요.")
    }

    /** 뷰포트가 좁아 모바일 레이아웃으로 떨어졌는지 진단하고, 그렇다면 스케일을 다시 맞춘다. */
    suspend fun checkViewport(session: Session) {
        val info = session.driver.evalObjectOrNull(
            "return window.__ccViewportInfo ? window.__ccViewportInfo() : null;"
        ) ?: return
        val innerWidth = info.optInt("innerWidth", 0)
        val pageSmall = info.optBoolean("pageSmall", false)
        if (innerWidth in 1 until 1200 || pageSmall) {
            session.log("[!] 뷰포트가 좁습니다(innerWidth=$innerWidth). 데스크톱 레이아웃을 다시 적용합니다.")
            applyDesktopScale(session.webView)
            session.driver.exec(
                """
                var metas = document.querySelectorAll('meta[name="viewport"]');
                for (var i = 0; i < metas.length; i++) {
                    metas[i].setAttribute('content', 'width=${Session.VIEWPORT_WIDTH}');
                }
                """
            )
        }
    }

    // ------------------------------------------------------------ fan-out

    /**
     * 파이썬 `make_starter(module_func, needs_dict)` 대응.
     * 버튼 한 번으로 모든 계정에서 동시에 모드를 시작한다.
     */
    fun startMode(modeFn: ModeFn, needsDict: Boolean = true) {
        for (session in sessions) {
            session.start(scope) { stop ->
                val dict = if (needsDict) {
                    val d = session.ensureAnswerDict()
                    if (d == null) {
                        session.log("[!] 단어장이 없습니다. 학습 페이지로 이동 후 [단어장 가져오기]를 누르세요.")
                        return@start
                    }
                    d
                } else {
                    session.answerDict
                }
                modeFn(session.driver, dict, stop)
            }
        }
    }

    /** 전체 자동화 / 한 세트 자동화처럼 단어장이 필요 없는 흐름. */
    fun startFlow(flowFn: FlowFn) {
        for (session in sessions) {
            session.start(scope) { stop -> flowFn(session.driver, stop) }
        }
    }

    fun startFullAutomation() = startFlow(AutoAll.runFullAutomation)

    fun startSingleSet() = startFlow(AutoAll.runSingleSet)

    /** 파이썬 `stop_automation` (Ctrl+E) 대응. */
    fun stopAll() {
        LogBus.log("[중지] 모든 계정 자동화를 중지합니다...")
        var anyRunning = false
        for (session in sessions) {
            if (session.stopAutomation()) anyRunning = true
        }
        if (!anyRunning) LogBus.log("    현재 실행 중인 자동화가 없습니다.")
    }

    /** 파이썬 `html_parse` (Ctrl+M) 대응. */
    fun refreshAnswerDicts() {
        LogBus.log("[단어장 가져오기] 모든 계정의 단어장을 가져옵니다...")
        for (session in sessions) {
            scope.launch {
                try {
                    val data = HtmlParser.getData(session.driver)
                    val dict = HtmlParser.dictFromCards(data)
                    if (dict != null && dict.isNotEmpty()) {
                        session.answerDict = dict
                        session.log("단어장 갱신 완료 (${dict.size}개)")
                    } else {
                        session.log("단어장 추출 실패 (학습 페이지가 맞는지 확인)")
                    }
                } catch (e: Throwable) {
                    session.log("단어장 추출 오류: ${e.message}")
                }
            }
        }
    }
}
