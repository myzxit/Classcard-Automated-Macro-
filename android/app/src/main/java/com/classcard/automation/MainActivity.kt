package com.classcard.automation

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.classcard.automation.core.Controller
import com.classcard.automation.modules.Matching
import com.classcard.automation.modules.Memorize
import com.classcard.automation.modules.MemorizeSentence
import com.classcard.automation.modules.ModeFn
import com.classcard.automation.modules.Recall
import com.classcard.automation.modules.RecallSentence
import com.classcard.automation.modules.Scramble
import com.classcard.automation.modules.Spell
import com.classcard.automation.modules.Test
import com.classcard.automation.modules.TestSentence

/**
 * 파이썬 main.py 의 콘솔 컨트롤러를 화면으로 옮긴 것.
 * 단축키가 버튼이 되었을 뿐, 동작(모든 계정에 동시 fan-out)은 같다.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var controller: Controller
    private lateinit var webContainer: FrameLayout
    private lateinit var accountSpinner: Spinner
    private lateinit var logScroll: ScrollView
    private lateinit var logText: TextView

    private var currentIndex = 0

    /** 지금 띄워 둔 세션이 어떤 계정 구성인지. 설정 화면에서 바뀌면 세션을 다시 만든다. */
    private var sessionSignature: String? = null

    private val logListener: (String) -> Unit = { line ->
        logText.append(line + "\n")
        logScroll.post { logScroll.fullScroll(View.FOCUS_DOWN) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webContainer = findViewById(R.id.webContainer)
        accountSpinner = findViewById(R.id.accountSpinner)
        logScroll = findViewById(R.id.logScroll)
        logText = findViewById(R.id.logText)

        controller = Controller(this, lifecycleScope)

        findViewById<Button>(R.id.btnAccounts).setOnClickListener {
            startActivity(Intent(this, AccountsActivity::class.java))
        }
        findViewById<Button>(R.id.btnToggleLog).setOnClickListener {
            logScroll.visibility =
                if (logScroll.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }

        requestNotificationPermissionIfNeeded()
        buildControlPanel()

        logText.text = LogBus.snapshot().joinToString("\n").let { if (it.isEmpty()) "" else it + "\n" }
        LogBus.addListener(logListener)

        accountSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: AdapterView<*>?, v: View?, position: Int, id: Long) {
                showSession(position)
            }

            override fun onNothingSelected(p: AdapterView<*>?) = Unit
        }

        startSessions()
    }

    /** 포그라운드 서비스 알림을 띄우려면 Android 13+ 에서 권한이 필요하다. */
    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this, android.Manifest.permission.POST_NOTIFICATIONS
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!granted) {
            ActivityCompat.requestPermissions(
                this, arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1001
            )
        }
    }

    /** 계정 목록을 읽어 WebView 들을 만들고 로그인시킨다. */
    private fun startSessions() {
        val accounts = AccountStore.load(this)
        if (accounts.isEmpty()) {
            LogBus.log(getString(R.string.no_accounts))
            Toast.makeText(this, R.string.no_accounts, Toast.LENGTH_LONG).show()
            return
        }

        val useAccounts =
            if (AccountStore.isParallel(this)) accounts else accounts.take(1)
        sessionSignature = signatureOf(useAccounts)

        val preload = assets.open("preload.js").bufferedReader().use { it.readText() }
        val sessions = controller.createSessions(useAccounts, preload)

        LogBus.log("총 ${sessions.size}개 계정으로 시작합니다: ${useAccounts.joinToString(", ") { it.id }}")

        webContainer.removeAllViews()
        for (session in sessions) {
            val params = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            session.webView.layoutParams = params
            session.webView.visibility = View.GONE
            webContainer.addView(session.webView)

            // 레이아웃이 잡힌 뒤에 CSS 뷰포트 1280px 스케일을 적용한다.
            session.webView.post {
                controller.applyDesktopScale(session.webView)
                controller.launch(session)
            }
        }

        accountSpinner.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            sessions.map { it.account.id + if (it.isolated) "" else " (격리 미지원)" },
        )
        showSession(0)

        ContextCompat.startForegroundService(this, Intent(this, AutomationService::class.java))
    }

    private fun signatureOf(accounts: List<AccountInfo>): String =
        accounts.joinToString("|") { it.id + ":" + it.pw.hashCode() } +
            "|parallel=" + AccountStore.isParallel(this)

    override fun onResume() {
        super.onResume()
        // 계정 설정이 바뀌었으면 (진행 중인 자동화를 멈추고) 세션을 다시 만든다.
        val accounts = AccountStore.load(this)
        val useAccounts = if (AccountStore.isParallel(this)) accounts else accounts.take(1)
        if (useAccounts.isNotEmpty() && signatureOf(useAccounts) != sessionSignature) {
            LogBus.log("계정 설정이 변경되어 세션을 다시 시작합니다.")
            startSessions()
        }
    }

    /** 선택한 계정의 WebView 만 화면에 보여준다. 나머지는 뒤에서 계속 동작한다. */
    private fun showSession(index: Int) {
        currentIndex = index
        controller.sessions.forEachIndexed { i, session ->
            session.webView.visibility = if (i == index) View.VISIBLE else View.GONE
        }
        controller.sessions.getOrNull(index)?.webView?.let { web ->
            web.post { controller.applyDesktopScale(web) }
        }
    }

    /** 파이썬 단축키 표를 그대로 버튼으로 옮긴다. */
    private fun buildControlPanel() {
        val rowPrimary = findViewById<LinearLayout>(R.id.rowPrimary)
        val rowModes = findViewById<LinearLayout>(R.id.rowModes)

        addButton(rowPrimary, R.string.btn_auto_all) { controller.startFullAutomation() }
        addButton(rowPrimary, R.string.btn_single_set) { controller.startSingleSet() }
        addButton(rowPrimary, R.string.btn_fetch) { controller.refreshAnswerDicts() }
        addButton(rowPrimary, R.string.btn_stop) { controller.stopAll() }
        addButton(rowPrimary, R.string.btn_quit) { quit() }

        val modes: List<Pair<Int, ModeFn>> = listOf(
            R.string.btn_memorize to Memorize.run,
            R.string.btn_recall to Recall.run,
            R.string.btn_spell to Spell.run,
            R.string.btn_memorize_sentence to MemorizeSentence.run,
            R.string.btn_recall_sentence to RecallSentence.run,
            R.string.btn_test to Test.run,
            R.string.btn_test_sentence to TestSentence.run,
            R.string.btn_matching to Matching.run,
            R.string.btn_scramble to Scramble.run,
        )
        for ((labelRes, fn) in modes) {
            addButton(rowModes, labelRes) { controller.startMode(fn, needsDict = true) }
        }
    }

    private fun addButton(parent: LinearLayout, labelRes: Int, onClick: () -> Unit) {
        val button = Button(this).apply {
            text = getString(labelRes)
            textSize = 12f
            isAllCaps = false
            setOnClickListener { onClick() }
        }
        parent.addView(
            button,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
    }

    /** 파이썬 `Ctrl + Esc` (프로그램 전체 종료) 대응. */
    private fun quit() {
        LogBus.log("[종료] 자동화를 멈추고 앱을 종료합니다...")
        controller.stopAll()
        controller.destroy()
        stopService(Intent(this, AutomationService::class.java))
        finish()
    }

    override fun onDestroy() {
        LogBus.removeListener(logListener)
        controller.destroy()
        stopService(Intent(this, AutomationService::class.java))
        super.onDestroy()
    }

    override fun onBackPressed() {
        val web: WebView? = controller.sessions.getOrNull(currentIndex)?.webView
        if (web != null && web.canGoBack()) {
            web.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

}
