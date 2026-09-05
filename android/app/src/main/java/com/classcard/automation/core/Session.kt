package com.classcard.automation.core

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.classcard.automation.AccountInfo
import com.classcard.automation.LogBus
import com.classcard.automation.modules.AnswerDict
import com.classcard.automation.modules.HtmlParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * 계정 1개 = WebView 1개. 파이썬 main.py 의 `Account` 클래스에 대응한다.
 * 계정마다 독립된 driver / answer_dict / 자동화 Job 을 가진다.
 */
class Session(
    val account: AccountInfo,
    val driver: Driver,
    val webView: WebView,
    /** 쿠키/스토리지가 다른 계정과 격리되었는지 (멀티 프로필 지원 여부). */
    val isolated: Boolean,
) {

    var answerDict: AnswerDict? = null

    var job: Job? = null
        private set

    var stop: StopFlag? = null
        private set

    val tag: String get() = "[${account.id}]"

    val isRunning: Boolean get() = job?.isActive == true

    fun log(message: String) = driver.log(message)

    /** 자동화 시작. 이미 실행 중이면 무시(원본 start_one 과 동일). */
    @Synchronized
    fun start(scope: CoroutineScope, block: suspend (StopFlag) -> Unit): Boolean {
        if (isRunning) {
            log("[X] 자동화가 이미 실행 중입니다.")
            return false
        }
        val flag = StopFlag()
        stop = flag
        job = scope.launch {
            try {
                block(flag)
            } catch (e: Throwable) {
                if (!flag.isSet) log("자동화 오류: ${e.message}")
            } finally {
                flag.set()
            }
        }
        log("자동화 시작")
        return true
    }

    @Synchronized
    fun stopAutomation(): Boolean {
        val running = isRunning
        stop?.set()
        job?.cancel()
        job = null
        return running
    }

    /** answer_dict 가 없으면 현재 페이지에서 단어장을 파싱해 계정 전용 딕셔너리를 만든다. */
    suspend fun ensureAnswerDict(): AnswerDict? {
        answerDict?.let { return it }
        return try {
            val data = HtmlParser.getData(driver)
            HtmlParser.dictFromCards(data).also { answerDict = it }
        } catch (e: Throwable) {
            log("단어장 자동 추출 실패: ${e.message}")
            null
        }
    }

    companion object {

        const val LOGIN_URL = "https://www.classcard.net/Login"

        /**
         * 파이썬 버전과 같은 데스크톱 User-Agent.
         * 클래스카드가 모바일 페이지를 내려주지 않게 하는 첫 번째 방어선이다.
         */
        const val DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

        /**
         * 강제할 CSS 뷰포트 너비.
         * 폰 화면 그대로 두면 클래스카드가 'page-small' 모바일 레이아웃으로 바뀌어
         * 스크램블 타일이 일부만 보이는 등 자동화가 깨진다(README 경고와 동일한 이유).
         */
        const val VIEWPORT_WIDTH = 1280

        @SuppressLint("SetJavaScriptEnabled")
        fun createWebView(
            context: Context,
            account: AccountInfo,
            profileIndex: Int,
            preloadScript: String,
        ): Session {
            val webView = WebView(context)

            // 계정별 쿠키/스토리지 격리 (파이썬의 '계정마다 크롬 창 1개'에 대응)
            var isolated = false
            if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
                try {
                    val name = "cc_profile_$profileIndex"
                    ProfileStore.getInstance().getOrCreateProfile(name)
                    WebViewCompat.setProfile(webView, name)
                    isolated = true
                } catch (e: Throwable) {
                    LogBus.log("[${account.id}] [!] 프로필 격리 실패: ${e.message}")
                }
            }

            webView.settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                userAgentString = DESKTOP_UA
                // 데스크톱 레이아웃 유지
                useWideViewPort = true
                loadWithOverviewMode = true
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                javaScriptCanOpenWindowsAutomatically = true
                mediaPlaybackRequiresUserGesture = false
            }

            // CDP addScriptToEvaluateOnNewDocument 대응 — 페이지 스크립트보다 먼저 실행된다.
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                try {
                    WebViewCompat.addDocumentStartJavaScript(webView, preloadScript, setOf("*"))
                } catch (e: Throwable) {
                    LogBus.log("[${account.id}] [!] 사전 주입 실패(무시하고 진행): ${e.message}")
                }
            } else {
                LogBus.log(
                    "[${account.id}] [!] 이 기기의 WebView는 문서 시작 주입을 지원하지 않습니다. " +
                        "문장 리콜 정답 캡처가 불안정할 수 있습니다(크롬/WebView 업데이트 권장)."
                )
            }

            val driver = Driver(webView, "[${account.id}]") { LogBus.log(it) }

            webView.webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                    driver.onPageStarted()
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    driver.onPageFinished()
                    // 문서 시작 주입을 못 쓰는 기기용 폴백
                    if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                        view?.evaluateJavascript(preloadScript, null)
                    }
                }
            }

            // 파이썬은 alert 를 dismiss 했다. 여기서도 모든 JS 대화상자를 자동으로 닫는다.
            webView.webChromeClient = object : WebChromeClient() {
                override fun onJsAlert(v: WebView?, u: String?, m: String?, r: JsResult?): Boolean {
                    r?.cancel(); return true
                }

                override fun onJsConfirm(v: WebView?, u: String?, m: String?, r: JsResult?): Boolean {
                    r?.cancel(); return true
                }

                override fun onJsPrompt(
                    v: WebView?, u: String?, m: String?, def: String?, r: JsPromptResult?,
                ): Boolean {
                    r?.cancel(); return true
                }

                override fun onJsBeforeUnload(v: WebView?, u: String?, m: String?, r: JsResult?): Boolean {
                    r?.confirm(); return true
                }
            }

            return Session(account, driver, webView, isolated)
        }
    }
}
