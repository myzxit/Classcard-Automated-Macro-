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

    @Volatile
    private var paused = false

    val isSet: Boolean
        get() = stopped || (parent?.isSet ?: false)

    /** 일시정지 중인지 (부모가 멈추면 자식도 멈춘다) */
    val isPaused: Boolean
        get() = paused || (parent?.isPaused ?: false)

    fun set() {
        stopped = true
    }

    fun pause() { paused = true }
    fun resume() { paused = false }

    /**
     * [ms] 밀리초 동안 대기. 중지되면 즉시 true 를 반환하고 깨어난다.
     * 일시정지 중이면 재개될 때까지 여기서 멈춘다 — 모든 모듈이 이 함수로 쉬므로 어느 모드든 이 한 곳에서 멈춘다.
     */
    suspend fun await(ms: Long): Boolean {
        if (isSet) return true
        var left = ms
        while (left > 0) {
            val slice = if (left < TICK) left else TICK
            delay(slice)
            left -= slice
            if (isSet) return true
        }
        while (isPaused && !isSet) delay(100)
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
