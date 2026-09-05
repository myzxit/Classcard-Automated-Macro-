package com.classcard.automation

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** 계정 하나. 파이썬 `.env` 의 CLASSCARD_ID / CLASSCARD_PW 한 쌍에 대응. */
data class AccountInfo(val id: String, val pw: String)

/**
 * `.env` 파일을 대신하는 계정 저장소.
 * 파일 대신 SharedPreferences 를 쓰고, `.env` 텍스트 붙여넣기 임포트도 지원한다.
 */
object AccountStore {

    private const val PREFS = "classcard_accounts"
    private const val KEY_ACCOUNTS = "accounts"
    private const val KEY_PARALLEL = "parallel"

    fun load(context: Context): List<AccountInfo> {
        val raw = prefs(context).getString(KEY_ACCOUNTS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val id = o.optString("id", "").trim()
                val pw = o.optString("pw", "")
                if (id.isEmpty()) null else AccountInfo(id, pw)
            }
        } catch (e: Throwable) {
            emptyList()
        }
    }

    fun save(context: Context, accounts: List<AccountInfo>) {
        val arr = JSONArray()
        // 파이썬 parse_accounts 와 동일하게 아이디 중복은 순서를 유지한 채 제거한다.
        val seen = HashSet<String>()
        for (a in accounts) {
            if (a.id.isBlank() || !seen.add(a.id)) continue
            arr.put(JSONObject().put("id", a.id).put("pw", a.pw))
        }
        prefs(context).edit().putString(KEY_ACCOUNTS, arr.toString()).apply()
    }

    /** 여러 계정을 동시에(병렬로) 돌릴지 여부. 기본 true. */
    fun isParallel(context: Context): Boolean = prefs(context).getBoolean(KEY_PARALLEL, true)

    fun setParallel(context: Context, value: Boolean) {
        prefs(context).edit().putBoolean(KEY_PARALLEL, value).apply()
    }

    /**
     * `.env` 형식 텍스트를 파싱한다. 파이썬 `parse_accounts()` 와 같은 규칙:
     *  - CLASSCARD_ID / CLASSCARD_PW 에 쉼표로 여러 개
     *  - CLASSCARD_ID_2 / CLASSCARD_PW_2, _3 ... 번호 형식
     */
    fun parseEnv(text: String): List<AccountInfo> {
        val values = HashMap<String, String>()
        for (rawLine in text.lines()) {
            val line = rawLine.trim()
            if (line.isEmpty() || line.startsWith("#")) continue
            val eq = line.indexOf('=')
            if (eq <= 0) continue
            val key = line.substring(0, eq).trim().uppercase()
            val value = line.substring(eq + 1).trim().trim('"', '\'')
            values[key] = value
        }

        val pairs = mutableListOf<AccountInfo>()

        val ids = (values["CLASSCARD_ID"] ?: "").split(",").map { it.trim() }.filter { it.isNotEmpty() }
        val pws = (values["CLASSCARD_PW"] ?: "").split(",").map { it.trim() }.filter { it.isNotEmpty() }
        for (i in 0 until minOf(ids.size, pws.size)) pairs.add(AccountInfo(ids[i], pws[i]))

        var n = 2
        while (true) {
            val id = values["CLASSCARD_ID_$n"]?.trim()
            val pw = values["CLASSCARD_PW_$n"]?.trim()
            if (id.isNullOrEmpty() || pw.isNullOrEmpty()) break
            pairs.add(AccountInfo(id, pw))
            n++
        }

        // 중복 제거(순서 유지)
        val seen = HashSet<String>()
        return pairs.filter { seen.add(it.id) }
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
