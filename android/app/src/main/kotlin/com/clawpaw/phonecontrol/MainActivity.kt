package com.clawpaw.phonecontrol

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.IBinder
import android.util.Log
import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.Button
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val TAG = "MainActivity"

class MainActivity : AppCompatActivity() {

    private var currentUid: String? = null

    private val httpBaseUrl by lazy {
        BuildConfig.WS_URL
            .replace(Regex("^wss://"), "https://")
            .replace(Regex("^ws://"), "http://")
    }
    private val authRepository by lazy { AuthRepository(httpBaseUrl) }

    // ── Service binding ──────────────────────────────────────────────────────

    private var wsService: WsService? = null
    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            wsService = (binder as WsService.LocalBinder).service
            wsService?.setStatusListener { connected ->
                runOnUiThread { updateWsStatus(connected) }
            }
            wsService?.setSshStatusListener { state ->
                runOnUiThread { updateSshStatus(state) }
            }
            runOnUiThread {
                updateWsStatus(wsService?.isConnected() == true)
                updateSshStatus(wsService?.sshState() ?: SshTunnelManager.State.DISCONNECTED)
                loadSshConfig()
            }
        }
        override fun onServiceDisconnected(name: ComponentName) {
            wsService = null
        }
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val prefs = getSharedPreferences("ssh_config", MODE_PRIVATE)
        val savedUid = prefs.getString("uid", null)

        if (savedUid != null) {
            // Already registered — go straight to logged-in UI
            Log.i(TAG, "Found saved uid=$savedUid, skipping login")
            val savedSecret = prefs.getString("secret", null)
            val hasUsername = !prefs.getString("username", "").isNullOrBlank()
            onLoginSuccess(savedUid, savedSecret)
            // If SSH credentials are missing, re-provision in background
            if (!hasUsername && savedSecret != null && savedSecret != "null") {
                lifecycleScope.launch {
                    try {
                        val creds = withContext(Dispatchers.IO) {
                            authRepository.provisionSsh(savedUid, savedSecret)
                        }
                        getSharedPreferences("ssh_config", MODE_PRIVATE).edit().apply {
                            putString("username", creds.username)
                            putString("password", creds.password)
                            putInt("adb_port", creds.adbPort)
                            if (prefs.getString("host", "").isNullOrBlank()) {
                                putString("host", "47.250.13.82")
                                putInt("port", 22)
                            }
                            apply()
                        }
                        Log.i(TAG, "SSH re-provisioned: user=${creds.username}")
                        wsService?.saveSshConfig(
                            prefs.getString("host", "47.250.13.82") ?: "47.250.13.82",
                            prefs.getInt("port", 22)
                        )
                    } catch (e: Exception) {
                        Log.w(TAG, "SSH re-provision failed: ${e.message}")
                    }
                }
            }
        } else {
            // First launch — show Connect button
            findViewById<Button>(R.id.btnConnect).setOnClickListener {
                registerAnonymous()
            }
        }
    }

    override fun onDestroy() {
        wsService?.setStatusListener(null)
        wsService?.setSshStatusListener(null)
        breathAnimators.values.forEach { it.cancel() }
        breathAnimators.clear()
        runCatching { unbindService(serviceConnection) }
        super.onDestroy()
    }

    // ── Loading animation ─────────────────────────────────────────────────────

    private var pulseAnimator: AnimatorSet? = null

    private fun startPulseAnimation() {
        val ring1 = findViewById<View>(R.id.pulseRing1)
        val ring2 = findViewById<View>(R.id.pulseRing2)

        // Infinite repeat on each animator individually
        listOf(ring1, ring2).forEachIndexed { i, ring ->
            val delay = (i * 700L)
            val interp = AccelerateDecelerateInterpolator()
            val sx = ObjectAnimator.ofFloat(ring, "scaleX", 0.3f, 1.8f).also {
                it.duration = 1400; it.startDelay = delay; it.repeatCount = ObjectAnimator.INFINITE
                it.interpolator = interp
            }
            val sy = ObjectAnimator.ofFloat(ring, "scaleY", 0.3f, 1.8f).also {
                it.duration = 1400; it.startDelay = delay; it.repeatCount = ObjectAnimator.INFINITE
                it.interpolator = interp
            }
            val al = ObjectAnimator.ofFloat(ring, "alpha", 0.7f, 0f).also {
                it.duration = 1400; it.startDelay = delay; it.repeatCount = ObjectAnimator.INFINITE
                it.interpolator = interp
            }
            AnimatorSet().also { set ->
                set.playTogether(sx, sy, al)
                set.start()
                if (i == 0) pulseAnimator = set
            }
        }
    }

    private fun stopPulseAnimation() {
        pulseAnimator?.cancel()
        pulseAnimator = null
        findViewById<View>(R.id.pulseRing1).alpha = 0f
        findViewById<View>(R.id.pulseRing2).alpha = 0f
    }

    private fun showLoading(text: String) {
        findViewById<Button>(R.id.btnConnect).visibility = View.GONE
        val layout = findViewById<View>(R.id.layoutLoading)
        layout.visibility = View.VISIBLE
        layout.animate().alpha(1f).setDuration(300).start()
        setLoadingText(text)
        startPulseAnimation()
    }

    private fun hideLoading() {
        stopPulseAnimation()
        findViewById<View>(R.id.layoutLoading).visibility = View.GONE
    }

    private fun setLoadingText(text: String) {
        val tv = findViewById<TextView>(R.id.tvLoadingStatus)
        tv.animate().alpha(0f).setDuration(150).withEndAction {
            tv.text = text
            tv.animate().alpha(1f).setDuration(150).start()
        }.start()
    }

    // ── Anonymous registration ────────────────────────────────────────────────

    private fun registerAnonymous() {
        showLoading("Connecting…")
        lifecycleScope.launch {
            try {
                val loginResult = withContext(Dispatchers.IO) {
                    authRepository.loginAnonymous()
                }
                // Persist uid + secret (both returned by the registration endpoint)
                getSharedPreferences("ssh_config", MODE_PRIVATE).edit().apply {
                    putString("uid", loginResult.uid)
                    putString("secret", loginResult.secret)
                    apply()
                }
                val secret = loginResult.secret
                setLoadingText("Provisioning SSH tunnel…")
                try {
                    val creds = withContext(Dispatchers.IO) {
                        authRepository.provisionSsh(loginResult.uid, secret)
                    }
                    getSharedPreferences("ssh_config", MODE_PRIVATE).edit().apply {
                        putString("username", creds.username)
                        putString("password", creds.password)
                        putInt("adb_port", creds.adbPort)
                        val prefs2 = getSharedPreferences("ssh_config", MODE_PRIVATE)
                        if (prefs2.getString("host", "").isNullOrBlank()) {
                            putString("host", "47.250.13.82")
                            putInt("port", 22)
                        }
                        apply()
                    }
                    Log.i(TAG, "SSH provisioned: user=${creds.username}")
                } catch (e: Exception) {
                    Log.w(TAG, "SSH provision failed (non-fatal): ${e.message}")
                }
                setLoadingText("Almost there…")
                hideLoading()
                onLoginSuccess(loginResult.uid, secret)
            } catch (e: Exception) {
                Log.e(TAG, "Register failed: ${e.message}")
                hideLoading()
                findViewById<Button>(R.id.btnConnect).visibility = View.VISIBLE
                Toast.makeText(this@MainActivity, "Connect failed: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    // ── Post-login ───────────────────────────────────────────────────────────

    private fun onLoginSuccess(uid: String, secret: String?) {
        currentUid = uid
        findViewById<Button>(R.id.btnConnect).visibility = View.GONE
        findViewById<View>(R.id.layoutLoggedIn).visibility = View.VISIBLE

        findViewById<TextView>(R.id.tvUid).text = uid
        updateSecretDisplay(secret)

        // MCP config row → show MCP config dialog
        val openMcpDialog = View.OnClickListener {
            val s = getSharedPreferences("ssh_config", MODE_PRIVATE).getString("secret", null)
            val u = currentUid
            if (s != null && u != null) showMcpConfigDialog(u, s)
        }
        findViewById<View>(R.id.layoutMcpConfig).setOnClickListener(openMcpDialog)
        findViewById<View>(R.id.ivMcpIcon).setOnClickListener(openMcpDialog)

        // Reset secret — warn that existing MCP connections will break
        findViewById<View>(R.id.ivResetSecret).setOnClickListener {
            val uid2 = currentUid ?: return@setOnClickListener
            AlertDialog.Builder(this)
                .setTitle("Reset Secret?")
                .setMessage("Any MCP client currently using the old secret will stop working. You'll need to update your MCP config with the new secret.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Reset") { _, _ ->
                    lifecycleScope.launch {
                        try {
                            val newSecret = withContext(Dispatchers.IO) {
                                authRepository.generateSecret(uid2)
                            }
                            getSharedPreferences("ssh_config", MODE_PRIVATE).edit()
                                .putString("secret", newSecret).apply()
                            updateSecretDisplay(newSecret)
                        } catch (e: Exception) {
                            Toast.makeText(this@MainActivity, "Failed: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
                .show()
        }

        // Debug info
        findViewById<Button>(R.id.btnDebug).setOnClickListener {
            showDebugDialog()
        }

        // Logout
        findViewById<Button>(R.id.btnLogout).setOnClickListener {
            logout()
        }

        // Retry buttons
        findViewById<Button>(R.id.btnRetryWs).setOnClickListener {
            wsService?.reconnectWs()
        }
        findViewById<Button>(R.id.btnRetrySsh).setOnClickListener {
            wsService?.reconnectSsh()
        }

        // Start foreground service
        val intent = Intent(this, WsService::class.java).apply { putExtra("uid", uid) }
        startForegroundService(intent)
        bindService(intent, serviceConnection, BIND_AUTO_CREATE)
    }

    private fun logout() {
        currentUid = null
        // Keep uid/secret so the same uid is restored on next launch
        wsService?.let {
            runCatching { unbindService(serviceConnection) }
            stopService(Intent(this, WsService::class.java))
        }
        wsService = null
        getSharedPreferences("ssh_config", MODE_PRIVATE).edit()
            .remove("uid").remove("secret").apply()
        findViewById<View>(R.id.layoutLoggedIn).visibility = View.GONE
        findViewById<Button>(R.id.btnConnect).visibility = View.VISIBLE
    }

    private fun loadSshConfig() {
        // SSH config is auto-provisioned; no UI fields needed
    }

    private fun updateSecretDisplay(secret: String?) {
        findViewById<TextView>(R.id.tvSecret).text = secret ?: "—"
    }

    private fun showMcpConfigDialog(uid: String, secret: String) {
        val config = """
{
  "mcpServers": {
    "clawpaw": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/mcp/dist/index.js"],
      "env": {
        "CLAWPAW_BACKEND_URL": "https://www.clawpaw.me",
        "CLAWPAW_UID": "$uid",
        "CLAWPAW_SECRET": "$secret"
      }
    }
  }
}""".trimIndent()

        val dp = resources.displayMetrics.density

        // Root container
        val root = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setBackgroundColor(0xFF131318.toInt())
            setPadding((24 * dp).toInt(), (24 * dp).toInt(), (24 * dp).toInt(), (20 * dp).toInt())
        }

        // Title
        root.addView(TextView(this).apply {
            text = "MCP Configuration"
            textSize = 18f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(0xFFFFFFFF.toInt())
        })

        // Subtitle
        root.addView(TextView(this).apply {
            text = "Add to ~/.claude.json — secret copied to clipboard"
            textSize = 12f
            setTextColor(0xFF888888.toInt())
            setPadding(0, (8 * dp).toInt(), 0, (16 * dp).toInt())
        })

        // Code block
        val codeContainer = android.widget.FrameLayout(this).apply {
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(0xFF0A0A0F.toInt())
                cornerRadius = 12 * dp
            }
            setPadding((16 * dp).toInt(), (14 * dp).toInt(), (16 * dp).toInt(), (14 * dp).toInt())
        }
        codeContainer.addView(TextView(this).apply {
            text = config
            typeface = android.graphics.Typeface.MONOSPACE
            textSize = 11f
            setTextColor(0xFFCCCCCC.toInt())
            setTextIsSelectable(true)
        })
        root.addView(ScrollView(this).apply {
            addView(codeContainer)
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                (200 * dp).toInt()
            )
        })

        // Buttons row
        val btnRow = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.END
            setPadding(0, (16 * dp).toInt(), 0, 0)
        }

        // Close — borderless ghost button
        btnRow.addView(Button(this).apply {
            text = "Close"
            textSize = 13f
            setTextColor(0xFF666666.toInt())
            background = null
            isAllCaps = false
            setPadding((12 * dp).toInt(), 0, (12 * dp).toInt(), 0)
            setOnClickListener { (parent as? android.app.Dialog)?.dismiss() }
        })

        // Copy Config — filled pill button
        btnRow.addView(Button(this).apply {
            text = "Copy Config"
            textSize = 13f
            setTextColor(0xFFFFFFFF.toInt())
            isAllCaps = false
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(0xFFDC3232.toInt())
                cornerRadius = 24 * dp
            }
            setPadding((20 * dp).toInt(), (10 * dp).toInt(), (20 * dp).toInt(), (10 * dp).toInt())
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.marginStart = (8 * dp).toInt() }
            setOnClickListener {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("MCP Config", config))
                Toast.makeText(this@MainActivity, "Config copied!", Toast.LENGTH_SHORT).show()
            }
        })

        root.addView(btnRow)

        val dialog = AlertDialog.Builder(this)
            .setView(root)
            .create()

        // Rounded corners on dialog window
        dialog.window?.apply {
            setBackgroundDrawable(android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT))
            val params = attributes
            params.width = (resources.displayMetrics.widthPixels * 0.92).toInt()
            attributes = params
        }

        // Wire Close button to dialog
        root.findViewWithTag<Button?>(null)

        // Re-attach close button click after dialog is created
        (btnRow.getChildAt(0) as Button).setOnClickListener { dialog.dismiss() }

        dialog.show()

        // Apply rounded background after show
        dialog.window?.setBackgroundDrawable(android.graphics.drawable.GradientDrawable().apply {
            setColor(0xFF131318.toInt())
            cornerRadius = 20 * dp
        })
    }

    // ── Status dot breath animation ───────────────────────────────────────────

    private val breathAnimators = mutableMapOf<android.widget.ImageView, android.animation.ValueAnimator>()

    private fun startBreathAnimation(dot: android.widget.ImageView) {
        if (breathAnimators[dot]?.isRunning == true) return
        val anim = android.animation.ValueAnimator.ofFloat(1f, 0.45f, 1f).apply {
            duration = 2200
            repeatCount = android.animation.ValueAnimator.INFINITE
            interpolator = android.view.animation.AccelerateDecelerateInterpolator()
            addUpdateListener { dot.alpha = it.animatedValue as Float }
        }
        breathAnimators[dot] = anim
        anim.start()
    }

    private fun stopBreathAnimation(dot: android.widget.ImageView) {
        breathAnimators.remove(dot)?.cancel()
        dot.alpha = 1f
    }

    // ── Status updates ────────────────────────────────────────────────────────

    private fun updateSshStatus(state: SshTunnelManager.State) {
        val dot = findViewById<android.widget.ImageView>(R.id.ivSshStatusDot)
        val tv = findViewById<TextView>(R.id.tvSshStatus)
        val btn = findViewById<Button>(R.id.btnRetrySsh)
        when (state) {
            SshTunnelManager.State.CONNECTED -> {
                dot.setImageResource(R.drawable.ic_status_connected)
                tv.text = "Active"
                btn.visibility = View.GONE
                startBreathAnimation(dot)
            }
            SshTunnelManager.State.CONNECTING -> {
                dot.setImageResource(R.drawable.ic_status_connecting)
                tv.text = "Establishing tunnel…"
                btn.visibility = View.GONE
                stopBreathAnimation(dot)
            }
            SshTunnelManager.State.ERROR -> {
                dot.setImageResource(R.drawable.ic_status_disconnected)
                val err = wsService?.sshLastError()
                tv.text = if (err != null) "Error: $err" else "Failed to connect"
                btn.visibility = View.VISIBLE
                stopBreathAnimation(dot)
            }
            SshTunnelManager.State.DISCONNECTED -> {
                dot.setImageResource(R.drawable.ic_status_disconnected)
                tv.text = "Disconnected"
                btn.visibility = View.VISIBLE
                stopBreathAnimation(dot)
            }
        }
    }

    private fun updateWsStatus(connected: Boolean) {
        val dot = findViewById<android.widget.ImageView>(R.id.ivWsStatusDot)
        val tv = findViewById<TextView>(R.id.tvWsStatus)
        val btn = findViewById<Button>(R.id.btnRetryWs)
        if (connected) {
            dot.setImageResource(R.drawable.ic_status_connected)
            tv.text = "Connected"
            btn.visibility = View.GONE
            startBreathAnimation(dot)
        } else {
            dot.setImageResource(R.drawable.ic_status_connecting)
            tv.text = "Reconnecting…"
            btn.visibility = View.GONE
            stopBreathAnimation(dot)
        }
    }

    private fun showDebugDialog() {
        val info = wsService?.getDebugInfo()
        val timeline = ConnectionLog.dump()
        val dp = resources.displayMetrics.density

        val summary = if (info == null) "Service not bound\n" else buildString {
            appendLine("── WebSocket ──────────────")
            appendLine("State:       ${info.wsState}")
            appendLine("Reconnects:  ${info.wsReconnects}")
            appendLine("Connected:   ${info.wsLastConnected}")
            appendLine("Last fail:   ${info.wsLastFailed}")
            appendLine("Last error:  ${info.wsLastError}")
            appendLine()
            appendLine("── SSH Tunnel ──────────────")
            appendLine("State:       ${info.sshState}")
            appendLine("Reconnects:  ${info.sshReconnects}")
            appendLine("Connected:   ${info.sshLastConnected}")
            appendLine("Last fail:   ${info.sshLastFailed}")
            appendLine("Last error:  ${info.sshLastError}")
            appendLine("Host:        ${info.sshHost}")
            appendLine("Remote port: ${info.sshRemotePort}")
        }

        val fullText = buildString {
            append(summary)
            appendLine()
            appendLine("── Timeline ────────────────")
            append(if (timeline.isBlank()) "(no events yet)" else timeline)
        }

        val root = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setBackgroundColor(0xFF131318.toInt())
            setPadding((24 * dp).toInt(), (24 * dp).toInt(), (24 * dp).toInt(), (20 * dp).toInt())
        }

        root.addView(TextView(this).apply {
            this.text = "Debug Info"
            textSize = 16f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(0, 0, 0, (16 * dp).toInt())
        })

        root.addView(ScrollView(this).apply {
            addView(TextView(this@MainActivity).apply {
                this.text = fullText
                typeface = android.graphics.Typeface.MONOSPACE
                textSize = 11f
                setTextColor(0xFFCCCCCC.toInt())
                setTextIsSelectable(true)
            })
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                (360 * dp).toInt()
            )
        })

        // SSH test result area (hidden until button tapped)
        val tvSshTest = TextView(this).apply {
            typeface = android.graphics.Typeface.MONOSPACE
            textSize = 11f
            setTextColor(0xFFAAFFAA.toInt())
            setTextIsSelectable(true)
            visibility = View.GONE
            setPadding(0, (8 * dp).toInt(), 0, 0)
        }
        root.addView(tvSshTest)

        val btnRow = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.END
            setPadding(0, (16 * dp).toInt(), 0, 0)
        }

        val dialog = AlertDialog.Builder(this).setView(root).create()

        // Close
        btnRow.addView(Button(this).apply {
            this.text = "Close"
            textSize = 13f
            setTextColor(0xFF666666.toInt())
            background = null
            isAllCaps = false
            setOnClickListener { dialog.dismiss() }
        })

        // Test SSH
        btnRow.addView(Button(this).apply {
            this.text = "Test SSH"
            textSize = 13f
            setTextColor(0xFFFFFFFF.toInt())
            isAllCaps = false
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(0xFF2255CC.toInt())
                cornerRadius = 24 * dp
            }
            setPadding((20 * dp).toInt(), (8 * dp).toInt(), (20 * dp).toInt(), (8 * dp).toInt())
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.marginStart = (8 * dp).toInt() }
            setOnClickListener {
                tvSshTest.text = "Testing…"
                tvSshTest.setTextColor(0xFFAAAAAA.toInt())
                tvSshTest.visibility = View.VISIBLE
                isEnabled = false
                lifecycleScope.launch {
                    val result = withContext(Dispatchers.IO) {
                        wsService?.testSshConnectivity() ?: "Service not bound"
                    }
                    tvSshTest.text = result
                    tvSshTest.setTextColor(
                        if (result.contains("FAILED") || result.contains("null")) 0xFFFF6666.toInt()
                        else 0xFF66FF99.toInt()
                    )
                    isEnabled = true
                }
            }
        })

        // Copy
        btnRow.addView(Button(this).apply {
            this.text = "Copy"
            textSize = 13f
            setTextColor(0xFFFFFFFF.toInt())
            isAllCaps = false
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(0xFFDC3232.toInt())
                cornerRadius = 24 * dp
            }
            setPadding((20 * dp).toInt(), (8 * dp).toInt(), (20 * dp).toInt(), (8 * dp).toInt())
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.marginStart = (8 * dp).toInt() }
            setOnClickListener {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                clipboard.setPrimaryClip(android.content.ClipData.newPlainText("ClawPaw Debug", fullText))
                Toast.makeText(this@MainActivity, "Copied!", Toast.LENGTH_SHORT).show()
            }
        })

        root.addView(btnRow)

        dialog.window?.apply {
            setBackgroundDrawable(android.graphics.drawable.GradientDrawable().apply {
                setColor(0xFF131318.toInt())
                cornerRadius = 20 * dp
            })
            val params = attributes
            params.width = (resources.displayMetrics.widthPixels * 0.92).toInt()
            attributes = params
        }

        dialog.show()

        dialog.window?.setBackgroundDrawable(android.graphics.drawable.GradientDrawable().apply {
            setColor(0xFF131318.toInt())
            cornerRadius = 20 * dp
        })
    }
}
