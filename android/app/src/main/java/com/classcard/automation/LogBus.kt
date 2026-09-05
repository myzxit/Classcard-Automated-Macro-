package com.classcard.automation

import android.os.Handler
import android.os.Looper
import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 파이썬 버전의 터미널 `print()` 를 대신하는 로그 버스.
 * 화면 하단 로그 패널과 logcat 양쪽으로 보낸다.
 */
object LogBus {

    private const val TAG = "ClasscardAutomation"
    private const val MAX_LINES = 500

    private val lines = ArrayDeque<String>()
    private val main = Handler(Looper.getMainLooper())
    private val listeners = mutableListOf<(String) -> Unit>()
    private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.KOREA)

    @Synchronized
    fun log(message: String) {
        val line = "${timeFormat.format(Date())}  $message"
        lines.addLast(line)
        while (lines.size > MAX_LINES) lines.removeFirst()
        Log.i(TAG, message)
        main.post {
            synchronized(this) { listeners.toList() }.forEach { it(line) }
        }
    }

    @Synchronized
    fun snapshot(): List<String> = lines.toList()

    @Synchronized
    fun clear() {
        lines.clear()
    }

    @Synchronized
    fun addListener(listener: (String) -> Unit) {
        listeners.add(listener)
    }

    @Synchronized
    fun removeListener(listener: (String) -> Unit) {
        listeners.remove(listener)
    }
}
