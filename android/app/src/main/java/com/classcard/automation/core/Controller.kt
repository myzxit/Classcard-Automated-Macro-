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
    val pausedCount: Int get() = sessionMap.values.count { it.isPaused }

    // ------------------------------------------------------- 일시정지 · 진행 위치 저장 · 이어하기 (확장 background.js 와 같은 규칙)

    /** 저장된 진행 위치 */
    data class ResumeEntry(val modeId: String, val url: String, val progress: Driver.Progress?, val savedAt: Long)

    private val resumePrefs by lazy { context.getSharedPreferences("classcard_resume", Context.MODE_PRIVATE) }
    @Volatile private var lastResumeSaveAt = 0L

    fun resumeAll(): Map<String, ResumeEntry> {
        val out = LinkedHashMap<String, ResumeEntry>()
        val raw = resumePrefs.getString("entries", null) ?: return out
        try {
            val obj = org.json.JSONObject(raw)
            for (key in obj.keys()) {
                val e = obj.getJSONObject(key)
                val pj = e.optJSONObject("progress")
                val p = pj?.let {
                    Driver.Progress(it.optInt("current"), it.optInt("total"), it.optInt("ok"), it.optInt("fail"), it.optInt("skipped"), it.optString("label"))
                }
                out[key] = ResumeEntry(e.optString("modeId"), e.optString("url"), p, e.optLong("savedAt"))
            }
        } catch (_: Throwable) {}
        return out
    }

    private fun writeResumeAll(all: Map<String, ResumeEntry>) {
        val obj = org.json.JSONObject()
        for ((k, e) in all) {
            val ej = org.json.JSONObject().put("modeId", e.modeId).put("url", e.url).put("savedAt", e.savedAt)
            e.progress?.let { p ->
                ej.put("progress", org.json.JSONObject().put("current", p.current).put("total", p.total)
                    .put("ok", p.ok).put("fail", p.fail).put("skipped", p.skipped).put("label", p.label))
            }
            obj.put(k, ej)
        }
        resumePrefs.edit().putString("entries", obj.toString()).apply()
    }

    fun saveResume(session: Session, explicit: Boolean = false) {
        if (session.modeId.isEmpty()) return
        val now = System.currentTimeMillis()
        if (!explicit && now - lastResumeSaveAt < 5000) return
        lastResumeSaveAt = now
        scope.launch {
            val url = try { session.driver.currentUrl() } catch (_: Throwable) { "" }
            val all = LinkedHashMap(resumeAll())
            all[session.account.id] = ResumeEntry(session.modeId, url, session.progress, now)
            writeResumeAll(all)
            if (explicit) {
                val p = session.progress
                session.log("진행 위치를 저장했습니다 — ${session.modeId}${if (p != null) " ${p.current}/${p.total}" else ""} · ${url.replace("https://www.classcard.net", "")}")
                onSessionsChanged?.invoke()
            }
        }
    }

    fun clearResume(accountId: String) {
        val all = LinkedHashMap(resumeAll())
        if (all.remove(accountId) != null) writeResumeAll(all)
    }

    fun pauseAll() {
        var any = false
        for (s in sessionMap.values.toList()) if (s.pause()) any = true
        if (!any) LogBus.dim("    일시정지할 자동화가 없습니다.")
        onSessionsChanged?.invoke()
    }

    fun resumePaused() {
        var any = false
        for (s in sessionMap.values.toList()) if (s.resume()) any = true
        if (!any) LogBus.dim("    재개할 자동화가 없습니다.")
        onSessionsChanged?.invoke()
    }

    fun saveProgress(targets: List<Session>) {
        val savable = targets.filter { it.modeId.isNotEmpty() }
        if (savable.isEmpty()) { LogBus.warn("[진행 위치 저장] 저장할 진행 중인(또는 방금 돌린) 자동화가 없습니다."); return }
        for (s in savable) saveResume(s, explicit = true)
    }

    /**
     * 저장해 둔 진행 위치에서 이어하기: 같은 페이지로 가서 같은 모드를 다시 돌린다.
     * (학습 진행 자체는 사이트가 계정에 저장하므로, 같은 화면에서 다시 시작하면 그 자리부터 이어진다)
     */
    fun resumeRun(targets: List<Session>, run: (modeId: String, session: Session) -> Unit) {
        val all = resumeAll()
        val ids = targets.filter { all.containsKey(it.account.id) }
        if (ids.isEmpty()) { LogBus.warn("[이어하기] 저장된 진행 위치가 없습니다. 먼저 [진행 위치 저장]을 누르거나 자동화를 한 번 돌리세요."); return }
        for (s in ids) {
            val e = all[s.account.id] ?: continue
            scope.launch {
                if (e.url.isNotEmpty() && s.driver.currentUrl() != e.url) {
                    s.driver.loadUrl(e.url)
                    s.driver.waitForLoad()
                }
                val p = e.progress
                s.log("저장된 위치에서 이어합니다 — ${e.modeId}${if (p != null) " (${p.current}/${p.total})" else ""}")
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) { run(e.modeId, s) }
            }
        }
    }

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
            session.onProgressChanged = { onSessionsChanged?.invoke(); saveResume(session) }
            session.onPageLoaded = { url -> maybeAutoDict(session, url) }
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
    fun startMode(label: String, modeFn: ModeFn, targets: List<Session>, needsDict: Boolean = true, modeId: String = "") {
        launchStaggered(targets) { session ->
            session.start(scope, label, onFinished = { finishSession(session) }, modeId = modeId) { stop ->
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
    fun startFlow(label: String, flowFn: FlowFn, targets: List<Session>, modeId: String = "") {
        launchStaggered(targets) { session ->
            session.start(scope, label, onFinished = { finishSession(session) }, modeId = modeId) { stop ->
                flowFn(session.driver, stop)
            }
        }
    }

    fun startFullAutomation(targets: List<Session>) =
        startFlow("전체 자동화", AutoAll.runFullAutomation, targets, modeId = "auto_all")

    fun startSingleSet(targets: List<Session>) =
        startFlow("한 세트 자동화", AutoAll.runSingleSet, targets, modeId = "one_set")

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
        // 끝까지 했으면 이어할 게 없고, 중간에 멈췄으면 그 자리를 남긴다
        val p = session.progress
        if (p != null && p.total > 0 && p.current >= p.total) clearResume(session.account.id) else saveResume(session)
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

    // ------------------------------------------------------------- 학습 페이지 자동 단어장

    private val studyPathRe = Regex("classcard\\.net/(Memorize|Recall|Spell|Test|SetTest|Match|Scramble|Quiz|Learn)[A-Za-z]*/", RegexOption.IGNORE_CASE)
    private val autoDictLast = HashMap<String, String>()   // 계정 -> 마지막으로 가져온 주소

    /**
     * 학습 페이지(암기·리콜·스펠·테스트·매칭…)에 들어가면 그 페이지의 단어장을 알아서 가져온다.
     * (전에는 [단어장 가져오기]를 직접 눌러야 했다) 자동화가 도는 중에는 모드가 스스로 가져오므로 건드리지 않는다.
     */
    private fun maybeAutoDict(session: Session, url: String) {
        if (!studyPathRe.containsMatchIn(url)) return
        if (!SettingsStore.autoDict(context)) return
        if (session.isRunning) return
        if (autoDictLast[session.account.id] == url) return
        autoDictLast[session.account.id] = url
        scope.launch {
            try {
                // 카드 목록이 실릴 시간을 준다 (시작 화면이어도 preload 가 챙긴 __cc_study_data 는 있다)
                var hasCards = false
                for (i in 0 until 6) {
                    kotlinx.coroutines.delay(1000)
                    hasCards = session.driver.evalBool(
                        "return !!(window.__cc_study_data && window.__cc_study_data.length) || (typeof study_data !== 'undefined' && !!study_data) || " +
                            "!!document.querySelector('.CardItem, .flip-card, [name=\"card_idx[]\"], .speed_quiz_row');"
                    )
                    if (hasCards) break
                }
                if (!hasCards) { autoDictLast.remove(session.account.id); return@launch }
                val data = HtmlParser.getData(session.driver, quiet = true)
                val dict = HtmlParser.dictFromCards(data)
                if (dict != null && dict.isNotEmpty()) {
                    session.answerDict = dict
                    session.log("학습 페이지 감지 — 단어장을 자동으로 가져왔습니다 (${dict.size}개)")
                }
            } catch (e: Throwable) {
                // 페이지 전환 중이면 다음 로드 때 다시 시도한다
            }
        }
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
