package com.classcard.automation

import android.os.Bundle
import android.view.LayoutInflater
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * `.env` 파일을 대신하는 계정 설정 화면.
 * 직접 입력하거나 `.env` 내용을 그대로 붙여넣어 가져올 수 있다.
 */
class AccountsActivity : AppCompatActivity() {

    private lateinit var accountList: LinearLayout
    private lateinit var chkParallel: CheckBox

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_accounts)

        accountList = findViewById(R.id.accountList)
        chkParallel = findViewById(R.id.chkParallel)
        chkParallel.isChecked = AccountStore.isParallel(this)

        val existing = AccountStore.load(this)
        if (existing.isEmpty()) {
            addRow(AccountInfo("", ""))
        } else {
            existing.forEach { addRow(it) }
        }

        findViewById<Button>(R.id.btnAdd).setOnClickListener { addRow(AccountInfo("", "")) }

        findViewById<Button>(R.id.btnImportEnv).setOnClickListener {
            val text = findViewById<EditText>(R.id.envInput).text.toString()
            val parsed = AccountStore.parseEnv(text)
            if (parsed.isEmpty()) {
                Toast.makeText(this, "가져올 계정을 찾지 못했습니다.", Toast.LENGTH_SHORT).show()
            } else {
                accountList.removeAllViews()
                parsed.forEach { addRow(it) }
                Toast.makeText(this, "${parsed.size}개 계정을 가져왔습니다.", Toast.LENGTH_SHORT).show()
            }
        }

        findViewById<Button>(R.id.btnSave).setOnClickListener { saveAndRestart() }
    }

    private fun addRow(account: AccountInfo) {
        val row = LayoutInflater.from(this).inflate(R.layout.item_account, accountList, false)
        row.findViewById<EditText>(R.id.inputId).setText(account.id)
        row.findViewById<EditText>(R.id.inputPw).setText(account.pw)
        row.findViewById<Button>(R.id.btnRemove).setOnClickListener {
            accountList.removeView(row)
        }
        accountList.addView(row)
    }

    private fun collect(): List<AccountInfo> {
        val result = mutableListOf<AccountInfo>()
        for (i in 0 until accountList.childCount) {
            val row = accountList.getChildAt(i)
            val id = row.findViewById<EditText>(R.id.inputId).text.toString().trim()
            val pw = row.findViewById<EditText>(R.id.inputPw).text.toString().trim()
            if (id.isNotEmpty()) result.add(AccountInfo(id, pw))
        }
        return result
    }

    private fun saveAndRestart() {
        val accounts = collect()
        AccountStore.save(this, accounts)
        AccountStore.setParallel(this, chkParallel.isChecked)

        if (accounts.isEmpty()) {
            Toast.makeText(this, R.string.no_accounts, Toast.LENGTH_LONG).show()
            return
        }

        // 계정 구성이 바뀌면 MainActivity 가 onResume 에서 세션을 새로 만든다.
        finish()
    }
}
