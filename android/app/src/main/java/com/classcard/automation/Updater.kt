package com.classcard.automation

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * 자동 업데이트.
 *
 * 릴리스에 함께 올라가는 version.json(tools/make_version.mjs)을 보고 새 버전이 있으면
 * APK 를 앱 캐시에 받아 **설치 화면을 바로 띄운다.** 안드로이드는 앱이 스스로를 조용히 덮어쓸 수 없고
 * (기기 관리자 앱만 가능), 사용자가 '설치'를 한 번 눌러야 한다. 그 전까지는 전부 자동이다.
 * APK 는 저장소의 고정 키로 서명되므로 지우지 않고 그대로 덮어 설치된다.
 */
object Updater {

    private const val VERSION_URL =
        "https://github.com/myzxit/Classcard-Automated-Macro-/releases/download/apk-latest/version.json"

    /** 하루에 몇 번씩 같은 안내를 띄우지 않도록, 한 번 설치를 띄운 버전은 기억한다. */
    private const val PREFS = "classcard_update"
    private const val KEY_PROMPTED = "prompted_code"
    private const val KEY_LAST_CHECK = "last_check"
    private const val CHECK_INTERVAL_MS = 6L * 60 * 60 * 1000

    data class Latest(val version: String, val versionCode: Int, val apkUrl: String, val notes: String)

    /**
     * 새 버전을 확인하고, 있으면 받아서 설치 화면을 띄운다.
     * @param force 설정에서 직접 눌렀을 때처럼 간격과 '이미 안내함' 기억을 무시하고 확인
     */
    fun checkAndInstall(context: Context, scope: CoroutineScope, force: Boolean = false) {
        val app = context.applicationContext
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (!force && now - prefs.getLong(KEY_LAST_CHECK, 0L) < CHECK_INTERVAL_MS) return
        prefs.edit().putLong(KEY_LAST_CHECK, now).apply()

        scope.launch(Dispatchers.IO) {
            val latest = fetchLatest()
            if (latest == null) {
                if (force) LogBus.warn("[업데이트] 새 버전 정보를 받지 못했습니다 (인터넷 연결을 확인하세요).")
                return@launch
            }
            if (latest.versionCode <= BuildConfig.VERSION_CODE) {
                if (force) LogBus.info("[업데이트] 지금이 최신 버전입니다 (v${BuildConfig.VERSION_NAME}).")
                return@launch
            }
            if (!force && prefs.getInt(KEY_PROMPTED, 0) == latest.versionCode) return@launch
            LogBus.info("[업데이트] 새 버전 v${latest.version} 이 나왔습니다 — 받는 중…")
            val apk = try {
                download(app, latest.apkUrl)
            } catch (e: Exception) {
                LogBus.error("[업데이트] 받기 실패: ${e.message}")
                return@launch
            }
            prefs.edit().putInt(KEY_PROMPTED, latest.versionCode).apply()
            LogBus.info("[업데이트] v${latest.version} 을 받았습니다 — 설치 화면을 엽니다. '설치'를 누르면 끝납니다.")
            withContext(Dispatchers.Main) { openInstaller(app, apk) }
        }
    }

    private fun fetchLatest(): Latest? {
        return try {
            val text = get(VERSION_URL).toString(Charsets.UTF_8)
            val j = JSONObject(text)
            Latest(
                version = j.optString("version", ""),
                versionCode = j.optInt("versionCode", 0),
                apkUrl = j.optString("apk", ""),
                notes = j.optString("notes", ""),
            )
        } catch (e: Exception) {
            null
        }
    }

    /** GitHub 릴리스 파일은 다른 주소로 한 번 넘어간다(302). 그것까지 따라간다. */
    private fun get(url: String): ByteArray {
        var current = url
        repeat(5) {
            val conn = URL(current).openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 15000
            conn.readTimeout = 60000
            conn.setRequestProperty("User-Agent", "classcard-automation/${BuildConfig.VERSION_NAME}")
            val code = conn.responseCode
            if (code in 300..399) {
                val loc = conn.getHeaderField("Location") ?: throw IllegalStateException("redirect without Location")
                conn.disconnect()
                current = URL(URL(current), loc).toString()
                return@repeat
            }
            if (code != 200) throw IllegalStateException("HTTP $code")
            return conn.inputStream.use { it.readBytes() }
        }
        throw IllegalStateException("too many redirects")
    }

    private fun download(app: Context, url: String): File {
        val dir = File(app.cacheDir, "updates").apply { mkdirs() }
        val file = File(dir, "classcard-automation.apk")
        val bytes = get(url)
        if (bytes.size < 1_000_000) throw IllegalStateException("받은 파일이 너무 작습니다 (${bytes.size} bytes)")
        file.writeBytes(bytes)
        return file
    }

    private fun openInstaller(app: Context, apk: File) {
        val uri: Uri = FileProvider.getUriForFile(app, app.packageName + ".fileprovider", apk)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            app.startActivity(intent)
        } catch (e: Exception) {
            LogBus.error("[업데이트] 설치 화면을 열지 못했습니다: ${e.message}")
        }
    }
}
