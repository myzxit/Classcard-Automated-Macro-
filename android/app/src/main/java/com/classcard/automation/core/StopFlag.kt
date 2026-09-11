package com.classcard.automation.core

import kotlinx.coroutines.delay

/**
 * 파이썬 `threading.Event` 대응.
 *
 * 기존 코드의 관용구 `if stop_event.wait(timeout=0.3): break` 를 그대로 옮길 수 있도록
 * [await] 는 "중지되었으면 true" 를 반환한다.
 *
 * [parent] 를 주면 부모가 중지될 때 자식도 중지된 것으로 본다.
 * (AutoAll.run_mode_isolated 의 propagate 스레드 대응 — 자식의 set() 은 부모로 전파되지 않는다.)
 */
class StopFlag(private val parent: StopFlag? = null) {

    @Volatile
    private var stopped = false

    val isSet: Boolean
        get() = stopped || (parent?.isSet ?: false)

    fun set() {
        stopped = true
    }

    /** [ms] 밀리초 동안 대기. 중지되면 즉시 true 를 반환하고 깨어난다. */
    suspend fun await(ms: Long): Boolean {
        if (isSet) return true
        var left = ms
        while (left > 0) {
            val slice = if (left < TICK) left else TICK
            delay(slice)
            left -= slice
            if (isSet) return true
        }
        return isSet
    }

    /** 파이썬의 `time.sleep()` 대응. 중지 여부와 무관하게 자되, 중지되면 일찍 깬다. */
    suspend fun sleep(ms: Long) {
        await(ms)
    }

    private companion object {
        const val TICK = 50L
    }
}
