package com.classcard.automation

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 로그 한 줄의 성격. 콘솔 색을 정하는 데 쓴다. */
enum class LogLevel { INFO, SUCCESS, WARN, ERROR, DIM }

/** 로그 한 줄. */
data class LogLine(
    val time: String,
    val date: String,
    val message: String,
    val level: LogLevel,
)

/**
 * 파이썬 버전의 터미널 `print()` 를 대신하는 로그 버스.
 *
 * - 화면의 LOG 탭(날짜별로 골라 보기)
 * - 앱 내부 파일(날짜별 .log) — 앱을 껐다 켜도 남는다
 * - logcat
 */
object LogBus {

    private const val TAG = "ClasscardAutomation"
    private const val MAX_LINES_PER_DATE = 3000

    private val main = Handler(Looper.getMainLooper())
    private val listeners = mutableListOf<(LogLine) -> Unit>()
    private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.KOREA)
    private val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.KOREA)

    /** 날짜 -> 그 날의 로그 줄들. */
    private val byDate = LinkedHashMap<String, MutableList<LogLine>>()

    private var appContext: Context? = null

    fun init(context: Context) {
        appContext = context.applicationContext
        loadFromDisk()
    }

    fun info(message: String) = log(message, LogLevel.INFO)
    fun success(message: String) = log(message, LogLevel.SUCCESS)
    fun warn(message: String) = log(message, LogLevel.WARN)
    fun error(message: String) = log(message, LogLevel.ERROR)
    fun dim(message: String) = log(message, LogLevel.DIM)

    /** 메시지 내용으로 성격을 추정해 기록한다(모듈들이 쓰는 기본 경로). */
    @Synchronized
    fun log(message: String, level: LogLevel = guessLevel(message)) {
        val now = Date()
        val line = LogLine(timeFormat.format(now), dateFormat.format(now), message, level)

        val list = byDate.getOrPut(line.date) { mutableListOf() }
        list.add(line)
        while (list.size > MAX_LINES_PER_DATE) list.removeAt(0)

        Log.i(TAG, message)
        appendToDisk(line)

        main.post {
            synchronized(this) { listeners.toList() }.forEach { it(line) }
        }
    }

    /** `[!]`, `오류`, `실패` 같은 표시로 색을 정한다. */
    private fun guessLevel(message: String): LogLevel = when {
        message.contains("[!]") || message.contains("오류") ||
            message.contains("실패") || message.contains("Error") -> LogLevel.ERROR
        message.contains("[O]") || message.contains("성공") ||
            message.contains("완료") -> LogLevel.SUCCESS
        message.contains("스킵") || message.contains("건너") -> LogLevel.WARN
        else -> LogLevel.INFO
    }

    @Synchronized
    fun dates(): List<String> = byDate.keys.sortedDescending()

    @Synchronized
    fun today(): String = dateFormat.format(Date())

    @Synchronized
    fun linesFor(date: String): List<LogLine> = byDate[date]?.toList() ?: emptyList()

    @Synchronized
    fun clear(date: String) {
        byDate.remove(date)
        logFile(date)?.delete()
    }

    @Synchronized
    fun addListener(listener: (LogLine) -> Unit) {
        listeners.add(listener)
    }

    @Synchronized
    fun removeListener(listener: (LogLine) -> Unit) {
        listeners.remove(listener)
    }

    /**
     * 해당 날짜 로그를 공유 가능한 파일로 내보낸다.
     * @return 저장된 파일 (실패하면 null)
     */
    @Synchronized
    fun export(date: String): File? {
        val ctx = appContext ?: return null
        return try {
            val dir = File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "logs")
            dir.mkdirs()
            val out = File(dir, "classcard-$date.log")
            out.writeText(
                linesFor(date).joinToString("\n") { "[${it.time}] ${it.message}" }
            )
            out
        } catch (e: Throwable) {
            Log.w(TAG, "로그 내보내기 실패", e)
            null
        }
    }

    // ------------------------------------------------------------ 디스크

    private fun logDir(): File? {
        val ctx = appContext ?: return null
        val dir = File(ctx.filesDir, "logs")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun logFile(date: String): File? = logDir()?.let { File(it, "$date.log") }

    private fun appendToDisk(line: LogLine) {
        val file = logFile(line.date) ?: return
        try {
            file.appendText("${line.time}\t${line.level.name}\t${line.message}\n")
        } catch (e: Throwable) {
            // 저장 실패는 화면 로그에 영향을 주지 않도록 무시한다.
        }
    }

    private fun loadFromDisk() {
        val dir = logDir() ?: return
        val files = dir.listFiles { f -> f.name.endsWith(".log") } ?: return
        for (file in files.sortedBy { it.name }) {
            val date = file.name.removeSuffix(".log")
            val list = mutableListOf<LogLine>()
            try {
                file.forEachLine { raw ->
                    val parts = raw.split("\t", limit = 3)
                    if (parts.size == 3) {
                        val level = runCatching { LogLevel.valueOf(parts[1]) }.getOrDefault(LogLevel.INFO)
                        list.add(LogLine(parts[0], date, parts[2], level))
                    }
                }
            } catch (e: Throwable) {
                continue
            }
            if (list.isNotEmpty()) {
                while (list.size > MAX_LINES_PER_DATE) list.removeAt(0)
                byDate[date] = list
            }
        }
    }
}
