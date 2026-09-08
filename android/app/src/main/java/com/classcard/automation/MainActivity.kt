package com.classcard.automation

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.text.Editable
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextWatcher
import android.text.style.ForegroundColorSpan
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.AdapterView
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.appcompat.widget.SwitchCompat
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.classcard.automation.core.Controller
import com.classcard.automation.core.Session
import com.classcard.automation.core.SessionState
import com.classcard.automation.modules.Grammar
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
 * 단축키가 버튼이 되었을 뿐, 동작(선택한 계정 전부에 동시 fan-out)은 같다.
 */
class MainActivity : AppCompatActivity() {

    /** 학습 모드 한 칸. */
    private sealed class Mode(val id: String, val labelRes: Int, val helpRes: Int) {
        /** 단어장 없이 도는 흐름 (전체 자동화 / 한 세트 자동화). */
        class Flow(id: String, labelRes: Int, helpRes: Int, val start: (Controller, List<Session>) -> Unit) :
            Mode(id, labelRes, helpRes)

        /** 개별 학습 모드. */
        class Single(
            id: String,
            labelRes: Int,
            val fn: ModeFn,
            helpRes: Int = R.string.modes_help_single,
            /** 단어장 없이도 돌아가는 모드인지 (문법훈련은 정답표 없이도 푼다). */
            val needsDict: Boolean = true,
        ) : Mode(id, labelRes, helpRes)

        /** 단어장 가져오기 (즉시 실행). */
        class Fetch(id: String, labelRes: Int) : Mode(id, labelRes, R.string.modes_help_fetch)
    }

    private val modes: List<Mode> by lazy {
        listOf(
            Mode.Flow("auto_all", R.string.mode_auto_all, R.string.modes_help_all) { c, t ->
                c.startFullAutomation(t)
            },
            Mode.Flow("one_set", R.string.mode_one_set, R.string.modes_help_one_set) { c, t ->
                c.startSingleSet(t)
            },
            Mode.Single("memorize", R.string.mode_memorize, Memorize.run),
            Mode.Single("recall", R.string.mode_recall, Recall.run),
            Mode.Single("spell", R.string.mode_spell, Spell.run),
            Mode.Single("memorize_sentence", R.string.mode_memorize_sentence, MemorizeSentence.run),
            Mode.Single("recall_sentence", R.string.mode_recall_sentence, RecallSentence.run),
            Mode.Single("test", R.string.mode_test, Test.run),
            Mode.Single("test_sentence", R.string.mode_test_sentence, TestSentence.run),
            Mode.Single("matching", R.string.mode_matching, Matching.run),
            Mode.Single("scramble", R.string.mode_scramble, Scramble.run),
            Mode.Single(
                "grammar", R.string.mode_grammar, Grammar.run,
                R.string.modes_help_grammar, needsDict = false,
            ),
            Mode.Fetch("fetch", R.string.mode_fetch),
        )
    }

    private lateinit var controller: Controller

    // 헤더 / 탭
    private lateinit var versionBadge: TextView
    private lateinit var tabMainLabel: TextView
    private lateinit var tabLogLabel: TextView
    private lateinit var tabMainIndicator: View
    private lateinit var tabLogIndicator: View
    private lateinit var statusDot: TextView
    private lateinit var statusText: TextView

    // 페이지
    private lateinit var pageMain: View
    private lateinit var pageLog: View
    private lateinit var pageBrowser: View

    // 계정
    private lateinit var inputNewId: EditText
    private lateinit var inputNewPw: EditText
    private lateinit var inputSearch: EditText
    private lateinit var accountToolRows: LinearLayout
    private lateinit var accountList: LinearLayout
    private lateinit var accountSummary: TextView

    // 모드 / 설정 / 실행
    private lateinit var modeGrid: LinearLayout
    private lateinit var modeHelp: TextView
    private lateinit var advancedCard: View
    private lateinit var advancedList: LinearLayout
    private lateinit var btnRun: TextView

    // 로그
    private lateinit var logDateSpinner: Spinner
    private lateinit var logScroll: ScrollView
    private lateinit var logText: TextView

    // 브라우저
    private lateinit var webContainer: FrameLayout
    private lateinit var browserTitle: TextView

    private var accounts = mutableListOf<AccountInfo>()
    private var selectedModeId: String = "auto_all"
    private var searchQuery: String = ""
    private var currentLogDate: String = ""
    private var shownBrowserAccountId: String? = null

    /** LOG 탭 본문 버퍼 (줄이 늘어도 매번 다시 만들지 않도록 재사용). */
    private val logBuilder = SpannableStringBuilder()

    private val logListener: (LogLine) -> Unit = { line ->
        if (line.date == currentLogDate) {
            appendLogLine(line)
        } else {
            refreshLogDates()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // 테마는 화면을 그리기 전에 정해야 첫 프레임부터 다크로 뜬다.
        applyNightMode(SettingsStore.darkMode(this))
        super.onCreate(savedInstanceState)
        LogBus.init(this)
        setContentView(R.layout.activity_main)

        bindViews()

        controller = Controller(this, lifecycleScope)
        controller.setPreloadScript(
            assets.open("preload.js").bufferedReader().use { it.readText() }
        )
        controller.onSessionsChanged = { runOnUiThread { renderAccounts(); renderStatus() } }

        versionBadge.text = "v" + BuildConfig.VERSION_NAME

        accounts = AccountStore.load(this).toMutableList()

        buildAccountTools()
        buildModeGrid()
        buildAdvancedSettings()
        setupTabs()
        setupLogTab()

        inputSearch.addTextChangedListener(simpleWatcher {
            searchQuery = it.trim()
            renderAccounts()
        })
        findViewById<View>(R.id.btnAddAccount).setOnClickListener { addAccountFromInputs() }
        findViewById<View>(R.id.btnBrowserBack).setOnClickListener { showPage(Page.MAIN) }
        findViewById<View>(R.id.btnGear).setOnClickListener {
            advancedCard.visibility =
                if (advancedCard.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }
        btnRun.setOnClickListener { onRunClicked() }

        requestNotificationPermissionIfNeeded()

        renderAccounts()
        renderStatus()
        renderModeSelection()

        LogBus.addListener(logListener)
        LogBus.info("클래스카드 자동화 v${BuildConfig.VERSION_NAME} 시작")
        if (accounts.isEmpty()) LogBus.warn(getString(R.string.msg_no_accounts))
    }

    private fun bindViews() {
        versionBadge = findViewById(R.id.versionBadge)
        tabMainLabel = findViewById(R.id.tabMainLabel)
        tabLogLabel = findViewById(R.id.tabLogLabel)
        tabMainIndicator = findViewById(R.id.tabMainIndicator)
        tabLogIndicator = findViewById(R.id.tabLogIndicator)
        statusDot = findViewById(R.id.statusDot)
        statusText = findViewById(R.id.statusText)

        pageMain = findViewById(R.id.pageMain)
        pageLog = findViewById(R.id.pageLog)
        pageBrowser = findViewById(R.id.pageBrowser)

        inputNewId = findViewById(R.id.inputNewId)
        inputNewPw = findViewById(R.id.inputNewPw)
        inputSearch = findViewById(R.id.inputSearch)
        accountToolRows = findViewById(R.id.accountToolRows)
        accountList = findViewById(R.id.accountList)
        accountSummary = findViewById(R.id.accountSummary)

        modeGrid = findViewById(R.id.modeGrid)
        modeHelp = findViewById(R.id.modeHelp)
        advancedCard = findViewById(R.id.advancedCard)
        advancedList = findViewById(R.id.advancedList)
        btnRun = findViewById(R.id.btnRun)

        logDateSpinner = findViewById(R.id.logDateSpinner)
        logScroll = findViewById(R.id.logScroll)
        logText = findViewById(R.id.logText)

        webContainer = findViewById(R.id.webContainer)
        browserTitle = findViewById(R.id.browserTitle)
    }

    // ============================================================ 탭 / 페이지

    private enum class Page { MAIN, LOG, BROWSER }

    private fun setupTabs() {
        findViewById<View>(R.id.tabMain).setOnClickListener { showPage(Page.MAIN) }
        findViewById<View>(R.id.tabLog).setOnClickListener { showPage(Page.LOG) }
        showPage(Page.MAIN)
    }

    private fun showPage(page: Page) {
        pageMain.visibility = if (page == Page.MAIN) View.VISIBLE else View.GONE
        pageLog.visibility = if (page == Page.LOG) View.VISIBLE else View.GONE
        // 브라우저 페이지는 GONE 으로 두면 안 된다. GONE 이면 레이아웃에서 빠져
        // WebView 너비가 0 이 되고, 그러면 데스크톱 스케일 계산과 (문장 테스트가 쓰는)
        // 좌표 기반 네이티브 터치 주입이 모두 깨진다. INVISIBLE 은 그리지만 않고
        // 측정/배치는 그대로 하므로 자동화가 뒤에서도 정상 동작한다.
        pageBrowser.visibility = if (page == Page.BROWSER) View.VISIBLE else View.INVISIBLE

        val activeTab = if (page == Page.LOG) 1 else 0
        tabMainLabel.setTextColor(color(if (activeTab == 0) R.color.primary else R.color.text_secondary))
        tabLogLabel.setTextColor(color(if (activeTab == 1) R.color.primary else R.color.text_secondary))
        tabMainIndicator.visibility = if (activeTab == 0) View.VISIBLE else View.INVISIBLE
        tabLogIndicator.visibility = if (activeTab == 1) View.VISIBLE else View.INVISIBLE
    }

    // ============================================================ 계정

    private fun buildAccountTools() {
        accountToolRows.removeAllViews()
        val tools = listOf(
            R.string.btn_import_env to { importEnvDialog() },
            R.string.btn_save_accounts to { saveAccounts() },
            R.string.btn_open_browser to { openBrowsersForSelected() },
            R.string.btn_close_browser to { closeBrowsersForSelected() },
            R.string.btn_select_all to { toggleSelectAll() },
            R.string.btn_delete_selected to { deleteSelected() },
        )
        tools.chunked(2).forEach { pair ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = dp(5) }
            }
            pair.forEachIndexed { index, (labelRes, action) ->
                val button = TextView(this).apply {
                    text = getString(labelRes)
                    textSize = 11f
                    gravity = android.view.Gravity.CENTER
                    setTextColor(
                        color(if (labelRes == R.string.btn_delete_selected) R.color.danger else R.color.text_primary)
                    )
                    setBackgroundResource(R.drawable.tool_button_bg)
                    setOnClickListener { action() }
                }
                row.addView(
                    button,
                    LinearLayout.LayoutParams(0, dp(34), 1f).apply {
                        if (index == 1) marginStart = dp(5)
                    },
                )
            }
            accountToolRows.addView(row)
        }
    }

    private fun renderAccounts() {
        accountList.removeAllViews()
        val inflater = LayoutInflater.from(this)

        val visible = accounts.filter {
            searchQuery.isEmpty() || it.id.contains(searchQuery, ignoreCase = true)
        }

        for (account in visible) {
            val row = inflater.inflate(R.layout.item_account_row, accountList, false)
            val check = row.findViewById<CheckBox>(R.id.accountCheck)
            val name = row.findViewById<TextView>(R.id.accountName)
            val state = row.findViewById<TextView>(R.id.accountState)
            val chip = row.findViewById<TextView>(R.id.accountChip)

            name.text = account.id
            check.isChecked = account.enabled
            check.setOnCheckedChangeListener { _, checked ->
                val index = accounts.indexOfFirst { it.id == account.id }
                if (index >= 0) {
                    accounts[index] = accounts[index].copy(enabled = checked)
                    AccountStore.save(this, accounts)
                    renderStatus()
                }
            }

            val session = controller.sessionFor(account.id)
            val sessionState = session?.state ?: SessionState.OFF
            state.text = when (sessionState) {
                SessionState.OFF -> getString(R.string.acc_state_off)
                SessionState.OPENING -> getString(R.string.acc_state_opening)
                SessionState.READY -> session?.detail?.takeIf { it.isNotEmpty() }
                    ?: getString(R.string.acc_state_ready)
                SessionState.RUNNING -> getString(R.string.acc_state_running, session?.detail ?: "")
                SessionState.ERROR -> session?.detail?.takeIf { it.isNotEmpty() }
                    ?: getString(R.string.acc_state_error)
            }
            applyChip(chip, sessionState)

            // 계정 줄을 누르면 그 계정의 브라우저 화면으로 이동
            row.setOnClickListener {
                val target = controller.sessionFor(account.id)
                if (target == null) {
                    Toast.makeText(this, R.string.acc_state_off, Toast.LENGTH_SHORT).show()
                } else {
                    showBrowser(target)
                }
            }

            accountList.addView(row)
        }

        val running = controller.runningCount
        accountSummary.text = getString(R.string.account_summary, accounts.size, running)
    }

    private fun applyChip(chip: TextView, state: SessionState) {
        val (textRes, bgRes, fgRes) = when (state) {
            SessionState.OFF -> Triple(R.string.chip_off, R.drawable.chip_off, R.color.chip_off_fg)
            SessionState.OPENING -> Triple(R.string.chip_opening, R.drawable.chip_ready, R.color.chip_ready_fg)
            SessionState.READY -> Triple(R.string.chip_ready, R.drawable.chip_ready, R.color.chip_ready_fg)
            SessionState.RUNNING -> Triple(R.string.chip_running, R.drawable.chip_running, R.color.chip_running_fg)
            SessionState.ERROR -> Triple(R.string.chip_error, R.drawable.chip_error, R.color.chip_error_fg)
        }
        chip.setText(textRes)
        chip.setBackgroundResource(bgRes)
        chip.setTextColor(color(fgRes))
    }

    private fun addAccountFromInputs() {
        val id = inputNewId.text.toString().trim()
        val pw = inputNewPw.text.toString().trim()
        if (id.isEmpty()) {
            Toast.makeText(this, R.string.msg_no_accounts, Toast.LENGTH_SHORT).show()
            return
        }
        accounts.removeAll { it.id == id }
        accounts.add(AccountInfo(id, pw, enabled = true))
        AccountStore.save(this, accounts)
        inputNewId.setText("")
        inputNewPw.setText("")
        LogBus.info("계정 추가: $id")
        renderAccounts()
        renderStatus()
    }

    private fun saveAccounts() {
        AccountStore.save(this, accounts)
        Toast.makeText(this, getString(R.string.msg_saved, accounts.size), Toast.LENGTH_SHORT).show()
        LogBus.success("계정 ${accounts.size}개를 저장했습니다.")
    }

    private fun importEnvDialog() {
        val input = EditText(this).apply {
            hint = getString(R.string.env_dialog_hint)
            setLines(5)
            gravity = android.view.Gravity.TOP or android.view.Gravity.START
            textSize = 12f
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.env_dialog_title)
            .setView(input)
            .setPositiveButton(R.string.ok) { _, _ ->
                val parsed = AccountStore.parseEnv(input.text.toString())
                if (parsed.isEmpty()) {
                    Toast.makeText(this, R.string.msg_import_failed, Toast.LENGTH_SHORT).show()
                    LogBus.warn(getString(R.string.msg_import_failed))
                } else {
                    for (account in parsed) {
                        accounts.removeAll { it.id == account.id }
                        accounts.add(account)
                        LogBus.info("계정 추가: ${account.id}")
                    }
                    AccountStore.save(this, accounts)
                    renderAccounts()
                    renderStatus()
                    Toast.makeText(
                        this, getString(R.string.msg_imported, parsed.size), Toast.LENGTH_SHORT,
                    ).show()
                }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun toggleSelectAll() {
        val allChecked = accounts.isNotEmpty() && accounts.all { it.enabled }
        accounts = accounts.map { it.copy(enabled = !allChecked) }.toMutableList()
        AccountStore.save(this, accounts)
        renderAccounts()
        renderStatus()
    }

    private fun deleteSelected() {
        val doomed = accounts.filter { it.enabled }.map { it.id }
        if (doomed.isEmpty()) {
            Toast.makeText(this, R.string.msg_no_selected, Toast.LENGTH_SHORT).show()
            return
        }
        controller.closeBrowsers(doomed)
        accounts.removeAll { it.enabled }
        AccountStore.save(this, accounts)
        LogBus.info("계정 삭제: ${doomed.joinToString(", ")}")
        renderAccounts()
        renderStatus()
    }

    private fun selectedAccounts(): List<AccountInfo> = accounts.filter { it.enabled }

    /** 선택된 계정 중 브라우저가 열려 있는 세션들. */
    private fun selectedSessions(): List<Session> =
        selectedAccounts().mapNotNull { controller.sessionFor(it.id) }

    private fun openBrowsersForSelected() {
        val targets = selectedAccounts()
        if (targets.isEmpty()) {
            Toast.makeText(this, R.string.msg_no_selected, Toast.LENGTH_SHORT).show()
            return
        }
        LogBus.info("브라우저 열기: ${targets.joinToString(", ") { it.id }}")
        controller.openBrowsers(targets) { session -> attachWebView(session) }
        if (SettingsStore.background(this)) {
            ContextCompat.startForegroundService(
                this, Intent(this, AutomationService::class.java),
            )
        }
    }

    private fun closeBrowsersForSelected() {
        val targets = selectedAccounts().map { it.id }
        if (targets.isEmpty()) {
            Toast.makeText(this, R.string.msg_no_selected, Toast.LENGTH_SHORT).show()
            return
        }
        controller.closeBrowsers(targets)
        if (controller.sessions.isEmpty()) {
            stopService(Intent(this, AutomationService::class.java))
            showPage(Page.MAIN)
        }
    }

    /** WebView 를 화면 밖 컨테이너에 붙여 두고, 볼 때만 앞으로 꺼낸다. */
    private fun attachWebView(session: Session) {
        session.webView.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
        )
        // 화면에 보이지 않는 계정도 INVISIBLE 로 둔다(GONE 이면 배치가 안 돼 자동화가 깨짐).
        session.webView.visibility = View.INVISIBLE
        webContainer.addView(session.webView)
        // 너비가 정해지는 순간(그리고 바뀔 때마다) 데스크톱 스케일을 다시 맞춘다.
        session.webView.addOnLayoutChangeListener { view, l, _, r, _, oldL, _, oldR, _ ->
            if (r - l > 0 && (r - l) != (oldR - oldL)) {
                controller.applyDesktopScale(view as android.webkit.WebView)
            }
        }
        session.webView.post { controller.applyDesktopScale(session.webView) }
    }

    private fun showBrowser(session: Session) {
        shownBrowserAccountId = session.account.id
        for (child in 0 until webContainer.childCount) {
            val view = webContainer.getChildAt(child)
            view.visibility = if (view === session.webView) View.VISIBLE else View.INVISIBLE
        }
        session.webView.bringToFront()
        browserTitle.text = getString(R.string.browser_title, session.account.id)
        showPage(Page.BROWSER)
        session.webView.post { controller.applyDesktopScale(session.webView) }
    }

    // ============================================================ 학습 모드

    private fun buildModeGrid() {
        modeGrid.removeAllViews()
        val inflater = LayoutInflater.from(this)
        modes.chunked(2).forEach { pair ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = dp(6) }
            }
            pair.forEachIndexed { index, mode ->
                val button = inflater.inflate(R.layout.item_mode_button, row, false) as TextView
                button.text = getString(mode.labelRes)
                button.tag = mode.id
                button.setOnClickListener { onModeClicked(mode) }
                row.addView(
                    button,
                    LinearLayout.LayoutParams(0, dp(42), 1f).apply {
                        if (index == 1) marginStart = dp(6)
                    },
                )
            }
            modeGrid.addView(row)
        }
    }

    private fun onModeClicked(mode: Mode) {
        if (mode is Mode.Fetch) {
            // 즉시 실행되는 동작이라 선택 상태로 두지 않는다.
            controller.refreshAnswerDicts(selectedSessions())
            return
        }
        selectedModeId = mode.id
        renderModeSelection()
    }

    private fun renderModeSelection() {
        for (i in 0 until modeGrid.childCount) {
            val row = modeGrid.getChildAt(i) as LinearLayout
            for (j in 0 until row.childCount) {
                val button = row.getChildAt(j) as TextView
                val selected = button.tag == selectedModeId
                button.isSelected = selected
                button.setTextColor(color(if (selected) R.color.primary_dark else R.color.text_primary))
                button.setTypeface(null, if (selected) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
            }
        }
        modes.firstOrNull { it.id == selectedModeId }?.let { modeHelp.setText(it.helpRes) }
    }

    // ============================================================ 고급 설정

    private fun buildAdvancedSettings() {
        advancedList.removeAllViews()
        val inflater = LayoutInflater.from(this)

        fun addToggle(
            titleRes: Int,
            subRes: Int,
            checked: Boolean,
            enabled: Boolean = true,
            onChange: (Boolean) -> Unit,
        ) {
            val row = inflater.inflate(R.layout.item_setting_toggle, advancedList, false)
            row.findViewById<TextView>(R.id.settingTitle).setText(titleRes)
            row.findViewById<TextView>(R.id.settingSub).setText(subRes)
            val switch = row.findViewById<SwitchCompat>(R.id.settingSwitch)
            switch.isChecked = checked
            switch.isEnabled = enabled
            if (!enabled) row.alpha = 0.5f
            switch.setOnCheckedChangeListener { _, value -> onChange(value) }
            advancedList.addView(row)
        }

        fun addNumber(titleRes: Int, subRes: Int, value: Int, onChange: (Int) -> Unit) {
            val row = inflater.inflate(R.layout.item_setting_number, advancedList, false)
            row.findViewById<TextView>(R.id.settingTitle).setText(titleRes)
            row.findViewById<TextView>(R.id.settingSub).setText(subRes)
            val field = row.findViewById<EditText>(R.id.settingValue)
            field.setText(value.toString())
            field.addTextChangedListener(simpleWatcher { text ->
                onChange(text.trim().toIntOrNull() ?: 0)
            })
            advancedList.addView(row)
        }

        // 화면 테마: 다크 / 화이트 두 가지 중 하나를 고른다.
        fun addChoice(
            titleRes: Int,
            subRes: Int,
            labelARes: Int,
            labelBRes: Int,
            selectedIsA: Boolean,
            onSelect: (Boolean) -> Unit,
        ) {
            val row = inflater.inflate(R.layout.item_setting_choice, advancedList, false)
            row.findViewById<TextView>(R.id.settingTitle).setText(titleRes)
            row.findViewById<TextView>(R.id.settingSub).setText(subRes)
            val a = row.findViewById<TextView>(R.id.choiceA)
            val b = row.findViewById<TextView>(R.id.choiceB)
            a.setText(labelARes)
            b.setText(labelBRes)

            fun paint(isA: Boolean) {
                for ((button, on) in listOf(a to isA, b to !isA)) {
                    button.isSelected = on
                    button.setTextColor(color(if (on) R.color.primary_dark else R.color.text_primary))
                    button.setTypeface(
                        null,
                        if (on) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL,
                    )
                }
            }
            paint(selectedIsA)

            a.setOnClickListener { paint(true); onSelect(true) }
            b.setOnClickListener { paint(false); onSelect(false) }
            advancedList.addView(row)
        }

        addChoice(
            R.string.set_theme, R.string.set_theme_sub,
            R.string.theme_dark, R.string.theme_light,
            SettingsStore.darkMode(this),
        ) { dark ->
            if (dark != SettingsStore.darkMode(this)) {
                SettingsStore.setDarkMode(this, dark)
                // 테마를 바꾸면 액티비티가 다시 만들어지며 새 색이 적용된다.
                applyNightMode(dark)
            }
        }

        addToggle(
            R.string.set_auto_login, R.string.set_auto_login_sub,
            SettingsStore.autoLogin(this),
        ) { SettingsStore.setAutoLogin(this, it) }

        addToggle(
            R.string.set_background, R.string.set_background_sub,
            SettingsStore.background(this),
        ) { value ->
            SettingsStore.setBackground(this, value)
            if (value) {
                if (controller.sessions.isNotEmpty()) {
                    ContextCompat.startForegroundService(
                        this, Intent(this, AutomationService::class.java),
                    )
                }
            } else {
                stopService(Intent(this, AutomationService::class.java))
            }
        }

        addToggle(
            R.string.set_isolate, R.string.set_isolate_sub,
            SettingsStore.isolateSessions(this),
        ) { SettingsStore.setIsolateSessions(this, it) }

        addToggle(
            R.string.set_keep_browser, R.string.set_keep_browser_sub,
            SettingsStore.keepBrowser(this),
        ) { SettingsStore.setKeepBrowser(this, it) }

        // 안드로이드에는 전역 단축키가 없다. 목업과 같이 꺼진 채 비활성으로 둔다.
        addToggle(
            R.string.set_hotkey, R.string.set_hotkey_sub,
            checked = false, enabled = false,
        ) { }

        addNumber(
            R.string.set_start_delay, R.string.set_start_delay_sub,
            SettingsStore.startDelaySec(this),
        ) { SettingsStore.setStartDelaySec(this, it) }

        addNumber(
            R.string.set_account_gap, R.string.set_account_gap_sub,
            SettingsStore.accountGapSec(this),
        ) { SettingsStore.setAccountGapSec(this, it) }
    }

    // ============================================================ 실행 / 중지

    private fun onRunClicked() {
        if (controller.runningCount > 0) {
            controller.stopAll()
            renderStatus()
            return
        }

        val targets = selectedAccounts()
        if (targets.isEmpty()) {
            Toast.makeText(this, R.string.msg_no_selected, Toast.LENGTH_SHORT).show()
            return
        }

        // 브라우저가 아직 안 열린 계정은 먼저 연다.
        val notOpen = targets.filter { controller.sessionFor(it.id) == null }
        if (notOpen.isNotEmpty()) {
            LogBus.info("브라우저가 닫혀 있어 먼저 엽니다: ${notOpen.joinToString(", ") { it.id }}")
            controller.openBrowsers(notOpen) { session -> attachWebView(session) }
            Toast.makeText(this, R.string.msg_open_first, Toast.LENGTH_LONG).show()
            if (SettingsStore.background(this)) {
                ContextCompat.startForegroundService(
                    this, Intent(this, AutomationService::class.java),
                )
            }
            renderStatus()
            return
        }

        val mode = modes.firstOrNull { it.id == selectedModeId }
        if (mode == null) {
            Toast.makeText(this, R.string.msg_pick_mode, Toast.LENGTH_SHORT).show()
            return
        }

        val sessions = selectedSessions()
        when (mode) {
            is Mode.Flow -> mode.start(controller, sessions)
            is Mode.Single -> controller.startMode(
                getString(mode.labelRes), mode.fn, sessions, mode.needsDict,
            )
            is Mode.Fetch -> controller.refreshAnswerDicts(sessions)
        }
        renderStatus()
    }

    private fun renderStatus() {
        val running = controller.runningCount
        if (running > 0) {
            statusDot.setTextColor(color(R.color.primary))
            statusText.text = getString(R.string.status_running, running)
            btnRun.setText(R.string.btn_run_stop)
            btnRun.setBackgroundResource(R.drawable.danger_button_bg)
        } else {
            statusDot.setTextColor(color(R.color.text_tertiary))
            statusText.setText(R.string.status_idle)
            btnRun.setText(R.string.btn_run_start)
            btnRun.setBackgroundResource(R.drawable.primary_button_bg)
        }
        accountSummary.text = getString(R.string.account_summary, accounts.size, running)
    }

    // ============================================================ 로그 탭

    private fun setupLogTab() {
        findViewById<View>(R.id.btnSaveLog).setOnClickListener {
            val file = LogBus.export(currentLogDate)
            if (file != null) {
                Toast.makeText(this, getString(R.string.msg_log_saved, file.absolutePath), Toast.LENGTH_LONG).show()
            }
        }
        findViewById<View>(R.id.btnClearLog).setOnClickListener {
            LogBus.clear(currentLogDate)
            logText.text = ""
            refreshLogDates()
        }
        logDateSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: AdapterView<*>?, v: View?, position: Int, id: Long) {
                val date = logDateSpinner.getItemAtPosition(position) as? String ?: return
                if (date != currentLogDate) {
                    currentLogDate = date
                    renderLogBody()
                }
            }

            override fun onNothingSelected(p: AdapterView<*>?) = Unit
        }
        currentLogDate = LogBus.today()
        refreshLogDates()
    }

    private fun refreshLogDates() {
        val dates = LogBus.dates().ifEmpty { listOf(LogBus.today()) }
        if (currentLogDate !in dates) currentLogDate = dates.first()
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, dates)
        logDateSpinner.adapter = adapter
        logDateSpinner.setSelection(dates.indexOf(currentLogDate).coerceAtLeast(0))
        renderLogBody()
    }

    private fun renderLogBody() {
        logBuilder.clear()
        for (line in LogBus.linesFor(currentLogDate)) appendLine(logBuilder, line)
        logText.text = logBuilder
        logScroll.post { logScroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun appendLogLine(line: LogLine) {
        appendLine(logBuilder, line)
        logText.text = logBuilder
        logScroll.post { logScroll.fullScroll(View.FOCUS_DOWN) }
    }

    /** `[10:30:44] 메시지` 형태로, 성격에 따라 색을 입혀 붙인다. */
    private fun appendLine(builder: SpannableStringBuilder, line: LogLine) {
        val start = builder.length
        builder.append("[${line.time}] ${line.message}\n")
        val colorInt = when (line.level) {
            LogLevel.SUCCESS -> color(R.color.log_green)
            LogLevel.ERROR -> color(R.color.log_red)
            LogLevel.WARN -> color(R.color.log_yellow)
            LogLevel.DIM -> color(R.color.log_dim)
            LogLevel.INFO -> color(R.color.log_text)
        }
        builder.setSpan(
            ForegroundColorSpan(colorInt), start, builder.length,
            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
        // 시각 부분은 항상 흐리게
        builder.setSpan(
            ForegroundColorSpan(color(R.color.log_dim)), start, start + line.time.length + 2,
            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
    }

    // ============================================================ 기타

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this, android.Manifest.permission.POST_NOTIFICATIONS,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!granted) {
            ActivityCompat.requestPermissions(
                this, arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1001,
            )
        }
    }

    private fun applyNightMode(dark: Boolean) {
        AppCompatDelegate.setDefaultNightMode(
            if (dark) AppCompatDelegate.MODE_NIGHT_YES else AppCompatDelegate.MODE_NIGHT_NO,
        )
    }

    private fun color(res: Int): Int = ContextCompat.getColor(this, res)

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun simpleWatcher(onText: (String) -> Unit) = object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) = Unit
        override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) = Unit
        override fun afterTextChanged(s: Editable?) = onText(s?.toString() ?: "")
    }

    override fun onDestroy() {
        LogBus.removeListener(logListener)
        controller.destroy()
        stopService(Intent(this, AutomationService::class.java))
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (pageBrowser.visibility == View.VISIBLE) {
            val session = shownBrowserAccountId?.let { controller.sessionFor(it) }
            if (session != null && session.webView.canGoBack()) {
                session.webView.goBack()
            } else {
                showPage(Page.MAIN)
            }
            return
        }
        if (pageLog.visibility == View.VISIBLE) {
            showPage(Page.MAIN)
            return
        }
        super.onBackPressed()
    }
}
