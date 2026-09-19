package com.classcard.automation

import android.content.Context

/**
 * '고급 설정' 카드의 값 저장소.
 *
 * PC 버전에서 main.py 상수(WIN_CASCADE 등)나 코드로만 바꿀 수 있던 동작을
 * 화면에서 켜고 끌 수 있게 한 것이다.
 */
object SettingsStore {

    private const val PREFS = "classcard_settings"

    private const val KEY_AUTO_LOGIN = "auto_login"
    private const val KEY_BACKGROUND = "background"
    private const val KEY_ISOLATE = "isolate"
    private const val KEY_KEEP_BROWSER = "keep_browser"
    private const val KEY_START_DELAY = "start_delay"
    private const val KEY_ACCOUNT_GAP = "account_gap"
    private const val KEY_DARK_MODE = "dark_mode"

    /** 저장된 ID/PW로 브라우저를 열 때 바로 로그인. */
    fun autoLogin(c: Context): Boolean = prefs(c).getBoolean(KEY_AUTO_LOGIN, true)
    fun setAutoLogin(c: Context, v: Boolean) = put(c, KEY_AUTO_LOGIN, v)

    /** 포그라운드 서비스 + 이탈 감지 우회로 화면이 꺼져도 계속 실행. */
    fun background(c: Context): Boolean = prefs(c).getBoolean(KEY_BACKGROUND, true)
    fun setBackground(c: Context, v: Boolean) = put(c, KEY_BACKGROUND, v)

    /** 계정별 쿠키/스토리지 분리 (PC 버전의 '창 분리'에 해당). */
    fun isolateSessions(c: Context): Boolean = prefs(c).getBoolean(KEY_ISOLATE, true)
    fun setIsolateSessions(c: Context, v: Boolean) = put(c, KEY_ISOLATE, v)

    /** 자동화가 끝나도 브라우저(WebView)를 살려 둘지. */
    fun keepBrowser(c: Context): Boolean = prefs(c).getBoolean(KEY_KEEP_BROWSER, true)
    fun setKeepBrowser(c: Context, v: Boolean) = put(c, KEY_KEEP_BROWSER, v)

    /** 시작 버튼을 누른 뒤 대기할 시간(초). */
    fun startDelaySec(c: Context): Int = prefs(c).getInt(KEY_START_DELAY, 0)
    fun setStartDelaySec(c: Context, v: Int) =
        prefs(c).edit().putInt(KEY_START_DELAY, v.coerceIn(0, 3600)).apply()

    /** 다계정 병렬 실행 시 계정 사이 간격(초). */
    fun accountGapSec(c: Context): Int = prefs(c).getInt(KEY_ACCOUNT_GAP, 0)
    fun setAccountGapSec(c: Context, v: Int) =
        prefs(c).edit().putInt(KEY_ACCOUNT_GAP, v.coerceIn(0, 3600)).apply()

    /** 다크 모드. 기본값은 켬. */
    fun darkMode(c: Context): Boolean = prefs(c).getBoolean(KEY_DARK_MODE, true)
    fun setDarkMode(c: Context, v: Boolean) = put(c, KEY_DARK_MODE, v)

    private fun put(c: Context, key: String, value: Boolean) =
        prefs(c).edit().putBoolean(key, value).apply()

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
