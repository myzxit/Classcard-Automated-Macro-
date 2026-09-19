package com.classcard.automation.core

import android.content.Context
import android.webkit.WebView
import com.classcard.automation.AccountInfo
import com.classcard.automation.LogBus
import com.classcard.automation.SettingsStore
import com.classcard.automation.modules.AutoAll
import com.classcard.automation.modules.Memorize
import com.classcard.automation.modules.FlowFn
import com.classcard.automation.modules.HtmlParser
import com.classcard.automation.modules.ModeFn
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * 파이썬 main.py 의 컨트롤러 부분에 대응.
 * 단축키 한 번이 모든 계정에 fan-out 되던 동작을 버튼 한 번으로 옮겼다.
 */
class Controller(
    private val context: Context,
    private val scope: CoroutineScope,
) {

    /** 열려 있는 세션 (계정 아이디 -> 세션). 순서를 유지한다. */
    private val sessionMap = LinkedHashMap<String, Session>()

    val sessions: List<Session> get() = sessionMap.values.toList()

    /** 세션 목록/상태가 바뀔 때 UI 를 다시 그리기 위한 콜백. */
    var onSessionsChanged: (() -> Unit)? = null

    private var preloadScript: String = ""

    fun setPreloadScript(script: String) {
        preloadScript = script
    }

    fun sessionFor(accountId: String): Session? = sessionMap[accountId]

    val runningCount: Int get() = sessionMap.values.count { it.isRunning }

    // ------------------------------------------------------- 브라우저 열기/닫기

    /**
     * 선택된 계정의 브라우저(WebView)를 연다. 이미 열린 계정은 그대로 둔다.
     * 파이썬 `initialize_browser` + `auto_login` 에 대응.
     */
    fun openBrowsers(accounts: List<AccountInfo>, attach: (Session) -> Unit) {
        if (accounts.isEmpty()) return

        val isolate = SettingsStore.isolateSessions(context)
        val autoLogin = SettingsStore.autoLogin(context)

        for (account in accounts) {
            if (sessionMap.containsKey(account.id)) continue

            val session = Session.createWebView(
                context, account, preloadScript, isolate,
            )
            session.onStateChanged = { onSessionsChanged?.invoke() }
            sessionMap[account.id] = session
            session.setState(SessionState.OPENING, "브라우저 여는 중")
            attach(session)

            scope.launch {
                try {
                    session.driver.loadUrl(Session.LOGIN_URL)
                    session.driver.waitForLoad()
                    if (autoLogin) {
                        autoLogin(session)
                    } else {
                        session.log("자동 로그인이 꺼져 있습니다. 직접 로그인하세요.")
                    }
                    checkViewport(session)
                    if (session.state != SessionState.ERROR) {
                        session.setState(SessionState.READY, "브라우저 열림")
                    }
                } catch (e: Throwable) {
                    session.log("[!] 브라우저 열기 실패: ${e.message}")
                    session.setState(SessionState.ERROR, "브라우저 열기 실패")
                }
            }
        }
        onSessionsChanged?.invoke()

        if (sessionMap.isNotEmpty() && sessionMap.values.none { it.isolated } &&
            sessionMap.size > 1 && isolate
        ) {
            LogBus.warn(
                "[!] 이 기기의 WebView는 계정별 쿠키 격리를 지원하지 않습니다. " +
                    "여러 계정을 동시에 로그인하면 세션이 섞이므로 계정을 하나씩 사용하세요."
            )
        }
    }

    /** 지정한 계정(또는 전체)의 브라우저를 닫는다. */
    fun closeBrowsers(accountIds: Collection<String>? = null) {
        val targets = accountIds?.toSet() ?: sessionMap.keys.toSet()
        for (id in targets) {
            sessionMap.remove(id)?.let { session ->
                session.destroy()
                LogBus.info("[$id] 브라우저를 닫았습니다.")
            }
        }
        onSessionsChanged?.invoke()
    }

    fun destroy() {
        sessionMap.values.toList().forEach { it.destroy() }
        sessionMap.clear()
        onSessionsChanged?.invoke()
    }

    // ------------------------------------------------------------- 화면/로그인

    /** WebView 가 배치된 뒤 CSS 뷰포트가 1280px 이 되도록 스케일을 맞춘다. */
    fun applyDesktopScale(webView: WebView) {
        val widthPx = webView.width
        if (widthPx <= 0) return
        val scale = (widthPx.toFloat() / Session.VIEWPORT_WIDTH * 100f).toInt().coerceIn(1, 100)
        webView.setInitialScale(scale)
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
            delay(300)
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
     * 버튼 한 번으로 선택된 모든 계정에서 동시에 모드를 시작한다.
     * '시작 지연시간'과 '계정별 실행 간격' 설정을 반영한다.
     */
    fun startMode(label: String, modeFn: ModeFn, targets: List<Session>, needsDict: Boolean = true) {
        launchStaggered(targets) { session ->
            session.start(scope, label, onFinished = { finishSession(session) }) { stop ->
                val dict = if (needsDict) {
                    var d = session.ensureAnswerDict()
                    if (d == null) {
                        // 카드 데이터(study_data)는 **학습이 시작된 뒤** 페이지에 채워진다.
                        // 시작 화면이면 시작 버튼을 누르고 한 번 더 읽어 본다.
                        if (Memorize.startStudyIfNeeded(session.driver, stop)) {
                            stop.await(1200)
                            d = session.ensureAnswerDict()
                        }
                    }
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
    fun startFlow(label: String, flowFn: FlowFn, targets: List<Session>) {
        launchStaggered(targets) { session ->
            session.start(scope, label, onFinished = { finishSession(session) }) { stop ->
                flowFn(session.driver, stop)
            }
        }
    }

    fun startFullAutomation(targets: List<Session>) =
        startFlow("전체 자동화", AutoAll.runFullAutomation, targets)

    fun startSingleSet(targets: List<Session>) =
        startFlow("한 세트 자동화", AutoAll.runSingleSet, targets)

    /** 시작 지연 + 계정 간격을 적용해 순서대로 띄운다. */
    private fun launchStaggered(targets: List<Session>, block: (Session) -> Unit) {
        if (targets.isEmpty()) return
        val startDelay = SettingsStore.startDelaySec(context) * 1000L
        val gap = SettingsStore.accountGapSec(context) * 1000L

        scope.launch {
            if (startDelay > 0) {
                LogBus.info("시작 지연시간 ${startDelay / 1000}초 대기…")
                delay(startDelay)
            }
            targets.forEachIndexed { index, session ->
                if (index > 0 && gap > 0) delay(gap)
                block(session)
            }
        }
    }

    /** 자동화 종료 후 '브라우저 유지' 설정에 따라 정리한다. */
    private fun finishSession(session: Session) {
        if (!SettingsStore.keepBrowser(context)) {
            closeBrowsers(listOf(session.account.id))
        }
    }

    /** 파이썬 `stop_automation` (Ctrl+E) 대응. */
    fun stopAll() {
        LogBus.info("[중지] 모든 계정 자동화를 중지합니다...")
        var anyRunning = false
        for (session in sessionMap.values.toList()) {
            if (session.stopAutomation()) anyRunning = true
        }
        if (!anyRunning) LogBus.dim("    현재 실행 중인 자동화가 없습니다.")
        onSessionsChanged?.invoke()
    }

    /** 파이썬 `html_parse` (Ctrl+M) 대응. */
    fun refreshAnswerDicts(targets: List<Session>) {
        if (targets.isEmpty()) {
            LogBus.warn("[단어장 가져오기] 브라우저가 열린 계정이 없습니다.")
            return
        }
        LogBus.info("[단어장 가져오기] 선택한 계정의 단어장을 가져옵니다...")
        for (session in targets) {
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
