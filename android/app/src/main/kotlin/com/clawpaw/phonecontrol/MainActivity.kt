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
import java.time.Duration
import java.time.Instant
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

        // Splash entrance: logo scales up + fades in, then name + tagline stagger in
        val dp = resources.displayMetrics.density
        val logo = findViewById<View>(R.id.ivLogo)
        val tvName = findViewById<View>(R.id.tvAppName)
        val tvTag = findViewById<View>(R.id.tvTagline)
        logo.scaleX = 0.6f; logo.scaleY = 0.6f
        logo.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(420)
            .setInterpolator(android.view.animation.OvershootInterpolator(1.4f)).setStartDelay(80).start()
        tvName.translationY = dp * 12
        tvName.animate().alpha(1f).translationY(0f).setDuration(340)
            .setInterpolator(android.view.animation.DecelerateInterpolator()).setStartDelay(260).start()
        tvTag.translationY = dp * 10
        tvTag.animate().alpha(1f).translationY(0f).setDuration(300)
            .setInterpolator(android.view.animation.DecelerateInterpolator()).setStartDelay(380).start()

        val prefs = getSharedPreferences("ssh_config", MODE_PRIVATE)
        val savedUid = prefs.getString("uid", null)

        if (savedUid != null) {
            // Already registered — check VIP before starting services
            Log.i(TAG, "Found saved uid=$savedUid, skipping login")
            val savedSecret = prefs.getString("secret", null)
            val hasUsername = !prefs.getString("username", "").isNullOrBlank()

            showLoading("Starting…")

            lifecycleScope.launch {
                // Only enforce VIP if using default host
                val savedHost = prefs.getString("host", "").orEmpty()
                val usingDefaultHost = savedHost.isBlank() || savedHost == BuildConfig.SSH_HOST
                if (usingDefaultHost) {
                    val vipStatus = try {
                        withContext(Dispatchers.IO) { authRepository.getVipStatus(savedUid) }
                    } catch (e: Exception) {
                        Log.w(TAG, "VIP check failed, allowing start: ${e.message}")
                        null // network error — allow through rather than blocking user
                    }
                    val isValid = vipStatus == null || isVipStillValid(vipStatus)
                    if (!isValid) {
                        Log.w(TAG, "VIP expired on cold start with default host, blocking services")
                        onLoginSuccess(savedUid, savedSecret, startService = false)
                        val ivSshSettings = findViewById<android.widget.ImageView>(R.id.ivSshSettings)
                        ivSshSettings.setColorFilter(0xFFFFCC44.toInt(), android.graphics.PorterDuff.Mode.SRC_IN)
                        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                            showSshSettingsDialog(showUpgradeHint = true)
                        }, 600)
                        return@launch
                    }
                }
                onLoginSuccess(savedUid, savedSecret, startService = true)
            }

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
                                putString("host", BuildConfig.SSH_HOST)
                                putInt("port", 22)
                            }
                            apply()
                        }
                        Log.i(TAG, "SSH re-provisioned: user=${creds.username}")
                        wsService?.saveSshConfig(
                            prefs.getString("host", BuildConfig.SSH_HOST) ?: BuildConfig.SSH_HOST,
                            prefs.getInt("port", 22)
                        )
                    } catch (e: Exception) {
                        if (e.message == "vip_required") {
                            Log.w(TAG, "SSH re-provision blocked: VIP required")
                            Toast.makeText(this@MainActivity, "VIP subscription required to use Default host", Toast.LENGTH_LONG).show()
                        } else {
                            Log.w(TAG, "SSH re-provision failed: ${e.message}")
                        }
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
        val btn = findViewById<Button>(R.id.btnConnect)
        btn.animate().alpha(0f).setDuration(180).withEndAction { btn.visibility = View.GONE; btn.alpha = 1f }.start()
        val layout = findViewById<View>(R.id.layoutLoading)
        layout.alpha = 0f
        layout.visibility = View.VISIBLE
        layout.animate().alpha(1f).setDuration(300).setStartDelay(120).start()
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
                            putString("host", BuildConfig.SSH_HOST)
                            putInt("port", 22)
                        }
                        apply()
                    }
                    Log.i(TAG, "SSH provisioned: user=${creds.username}")
                } catch (e: Exception) {
                    if (e.message == "vip_required") {
                        Log.w(TAG, "SSH provision blocked: VIP required")
                        Toast.makeText(this@MainActivity, "VIP subscription required to use Default host", Toast.LENGTH_LONG).show()
                    } else {
                        Log.w(TAG, "SSH provision failed (non-fatal): ${e.message}")
                    }
                }
                setLoadingText("Almost there…")
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

    private fun onLoginSuccess(uid: String, secret: String?, startService: Boolean = true) {
        currentUid = uid
        hideLoading()
        findViewById<Button>(R.id.btnConnect).visibility = View.GONE
        val layoutLoggedIn = findViewById<View>(R.id.layoutLoggedIn)
        val dp2 = resources.displayMetrics.density
        layoutLoggedIn.alpha = 0f
        layoutLoggedIn.translationY = dp2 * 24
        layoutLoggedIn.visibility = View.VISIBLE
        layoutLoggedIn.animate().alpha(1f).translationY(0f).setDuration(380)
            .setInterpolator(android.view.animation.DecelerateInterpolator()).setStartDelay(60).start()

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

        // SSH advanced settings
        findViewById<android.widget.ImageView>(R.id.ivSshSettings).setOnClickListener {
            showSshSettingsDialog()
        }

        // Debug info (only in debug builds)
        val btnDebug = findViewById<Button>(R.id.btnDebug)
        if (BuildConfig.DEBUG) {
            btnDebug.visibility = android.view.View.VISIBLE
            btnDebug.setOnClickListener { showDebugDialog() }
        } else {
            btnDebug.visibility = android.view.View.GONE
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

        // Start foreground service (skipped if VIP expired)
        if (startService) {
            val intent = Intent(this, WsService::class.java).apply { putExtra("uid", uid) }
            startForegroundService(intent)
            bindService(intent, serviceConnection, BIND_AUTO_CREATE)
        }
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

    // ── SSH advanced settings dialog ─────────────────────────────────────────

    private fun showSshSettingsDialog(showUpgradeHint: Boolean = false) {
        val prefs = getSharedPreferences("ssh_config", MODE_PRIVATE)
        val dp = resources.displayMetrics.density
        val savedHost = prefs.getString("host", "") ?: ""
        var useCustom = savedHost.isNotBlank() && savedHost != BuildConfig.SSH_HOST
        val uid = currentUid

        fun optionBg(selected: Boolean) = android.graphics.drawable.GradientDrawable().apply {
            setColor(if (selected) 0xFF1E1E26.toInt() else 0xFF0A0A0F.toInt())
            cornerRadius = 10 * dp
            setStroke((1 * dp).toInt(), if (selected) 0xFFDC3232.toInt() else 0xFF2A2A35.toInt())
        }

        val root = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setBackgroundColor(0xFF131318.toInt())
            setPadding((24 * dp).toInt(), (24 * dp).toInt(), (24 * dp).toInt(), (20 * dp).toInt())
        }

        root.addView(TextView(this).apply {
            text = "SSH Tunnel"
            textSize = 16f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(0, 0, 0, (16 * dp).toInt())
        })

        // ── Option: Default host (contains VIP status row at bottom) ─────────
        val optionDefault = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            background = optionBg(!useCustom)
            setPadding((14 * dp).toInt(), (12 * dp).toInt(), (14 * dp).toInt(), (12 * dp).toInt())
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.bottomMargin = (8 * dp).toInt() }
            isClickable = true
            isFocusable = true
        }

        // Top row: radio + labels
        val topRow = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        val radioDefault = android.widget.RadioButton(this).apply {
            isChecked = !useCustom
            isClickable = false
            isFocusable = false
            buttonTintList = android.content.res.ColorStateList.valueOf(0xFFDC3232.toInt())
        }
        topRow.addView(radioDefault)
        topRow.addView(android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.marginStart = (10 * dp).toInt() }
            addView(TextView(this@MainActivity).apply {
                text = "Default host"
                textSize = 13f
                setTextColor(0xFFFFFFFF.toInt())
            })
            addView(TextView(this@MainActivity).apply {
                text = "Powered by ClawPaw"
                textSize = 11f
                setTextColor(0xFF666666.toInt())
                setPadding(0, (2 * dp).toInt(), 0, 0)
            })
        })
        optionDefault.addView(topRow)

        // Divider
        val vipDivider = android.view.View(this).apply {
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                (1 * dp).toInt()
            ).also { it.topMargin = (10 * dp).toInt(); it.bottomMargin = (10 * dp).toInt() }
            setBackgroundColor(0xFF2A2A35.toInt())
        }
        optionDefault.addView(vipDivider)

        // VIP status row: label on left, Upgrade button on right
        val vipRow = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        val tvVipStatus = TextView(this).apply {
            text = "…"
            textSize = 11f
            setTextColor(0xFF888888.toInt())
            layoutParams = android.widget.LinearLayout.LayoutParams(0, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .also { it.marginStart = (4 * dp).toInt() }
        }
        val btnUpgrade = Button(this).apply {
            text = "Upgrade"
            tag = "vip_upgrade_btn"
            textSize = 10f
            setTextColor(0xFFFFFFFF.toInt())
            isAllCaps = false
            visibility = View.GONE
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(0xFFDC3232.toInt())
                cornerRadius = 20 * dp
            }
            setPadding((10 * dp).toInt(), (3 * dp).toInt(), (10 * dp).toInt(), (3 * dp).toInt())
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        vipRow.addView(tvVipStatus)
        vipRow.addView(btnUpgrade)
        optionDefault.addView(vipRow)

        // Hide VIP section if custom is already selected on open
        if (useCustom) {
            vipDivider.visibility = android.view.View.GONE
            vipRow.visibility = android.view.View.GONE
        }

        root.addView(optionDefault)

        // Declared here so it's available to the VIP load block below
        val dialog = AlertDialog.Builder(this).setView(root).create()

        fun showUpgradeOverlay() {
            // btnUpgrade is already VISIBLE when this is called; post to get final coords
            btnUpgrade.post {
                val decorView = dialog.window?.decorView as? android.view.ViewGroup ?: return@post

                // getLocationInWindow gives coords relative to the dialog's window (decorView origin)
                val btnLoc = IntArray(2)
                btnUpgrade.getLocationInWindow(btnLoc)
                val bx = btnLoc[0].toFloat() - dp * 10
                val by = btnLoc[1].toFloat() - dp * 6
                val bw = btnUpgrade.width.toFloat() + dp * 20
                val bh = btnUpgrade.height.toFloat() + dp * 12
                val btnCenterX = bx + bw / 2

                var bounceOffset = 0f
                var bounceAnim: android.animation.ValueAnimator? = null

                val overlayView = object : android.view.View(this@MainActivity) {
                    val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
                    override fun onDraw(canvas: android.graphics.Canvas) {
                        // Semi-transparent scrim (lighter)
                        paint.style = android.graphics.Paint.Style.FILL
                        paint.color = 0x88000000.toInt()
                        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)

                        // Outer glow ring
                        paint.style = android.graphics.Paint.Style.STROKE
                        paint.strokeWidth = dp * 8
                        paint.color = 0x44FFCC44
                        canvas.drawRoundRect(bx - dp * 4, by - dp * 4, bx + bw + dp * 4, by + bh + dp * 4, dp * 24, dp * 24, paint)

                        // Gold border
                        paint.strokeWidth = dp * 2.5f
                        paint.color = 0xFFFFCC44.toInt()
                        canvas.drawRoundRect(bx, by, bx + bw, by + bh, dp * 20, dp * 20, paint)

                        // Bouncing arrow
                        val arrowTipY = by - dp * 14 + bounceOffset
                        val arrowBaseY = arrowTipY - dp * 22
                        paint.strokeWidth = dp * 3
                        paint.strokeCap = android.graphics.Paint.Cap.ROUND
                        paint.strokeJoin = android.graphics.Paint.Join.ROUND
                        paint.color = 0xFFFFCC44.toInt()
                        val path = android.graphics.Path().apply {
                            moveTo(btnCenterX, arrowTipY); lineTo(btnCenterX, arrowBaseY)
                            moveTo(btnCenterX - dp * 10, arrowTipY - dp * 11)
                            lineTo(btnCenterX, arrowTipY)
                            lineTo(btnCenterX + dp * 10, arrowTipY - dp * 11)
                        }
                        canvas.drawPath(path, paint)

                        // Label
                        paint.style = android.graphics.Paint.Style.FILL
                        paint.textSize = dp * 13
                        paint.textAlign = android.graphics.Paint.Align.CENTER
                        paint.color = 0xFFFFCC44.toInt()
                        canvas.drawText("Tap to renew VIP", btnCenterX, arrowBaseY - dp * 8, paint)
                    }
                }.also { v ->
                    v.layoutParams = android.widget.FrameLayout.LayoutParams(
                        android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                        android.widget.FrameLayout.LayoutParams.MATCH_PARENT
                    )
                    v.setOnClickListener {
                        bounceAnim?.cancel()
                        (v.parent as? android.view.ViewGroup)?.removeView(v)
                    }
                }

                bounceAnim = android.animation.ValueAnimator.ofFloat(0f, -dp * 8, 0f).apply {
                    duration = 900
                    repeatCount = android.animation.ValueAnimator.INFINITE
                    interpolator = android.view.animation.AccelerateDecelerateInterpolator()
                    addUpdateListener { bounceOffset = it.animatedValue as Float; overlayView.invalidate() }
                }

                // Add directly to decorView (already full-screen), NOT to android.R.id.content
                // which would stretch the dialog
                decorView.addView(overlayView)
                bounceAnim.start()
            }
        }

        // Load VIP status async
        if (uid != null) {
            lifecycleScope.launch {
                Log.d(TAG, "[VIP] starting load for uid=$uid httpBaseUrl=$httpBaseUrl")
                try {
                    val status = withContext(Dispatchers.IO) { authRepository.getVipStatus(uid) }
                    Log.d(TAG, "[VIP] status=${status.status} days_left=${status.days_left}")
                    tvVipStatus.text = when (status.status) {
                        "trial" -> {
                            val label = formatVipTrialRemaining(status.trial_ends_at)
                            if (label == null) "Trial ended" else "Trial · $label"
                        }
                        "active" -> {
                            val d = status.days_left ?: 0
                            "⚡ VIP Active  ·  Renews in ${if (d <= 1) "today" else "$d days"}"
                        }
                        "canceled", "expired" -> "VIP Expired"
                        else -> "—"
                    }
                    tvVipStatus.setTextColor(when (status.status) {
                        "active" -> 0xFFFFCC44.toInt()
                        "trial" -> 0xFF888888.toInt()
                        else -> 0xFF555555.toInt()
                    })
                    if (status.status == "active") {
                        val goldBg = android.graphics.drawable.GradientDrawable().apply {
                            setColor(0xFF1A1400.toInt())
                            cornerRadius = 10 * dp
                            setStroke((2 * dp).toInt(), 0xFFFFCC44.toInt())
                        }
                        optionDefault.background = goldBg

                        // Animate both background fill and border together
                        val bgAnim = android.animation.ValueAnimator.ofArgb(
                            0xFF0F0C00.toInt(), 0xFF2E2000.toInt(), 0xFF0F0C00.toInt()
                        ).apply {
                            duration = 2000
                            repeatCount = android.animation.ValueAnimator.INFINITE
                            interpolator = android.view.animation.AccelerateDecelerateInterpolator()
                            addUpdateListener { goldBg.setColor(it.animatedValue as Int) }
                        }
                        val borderAnim = android.animation.ValueAnimator.ofArgb(
                            0xFF886600.toInt(), 0xFFFFEE44.toInt(), 0xFF886600.toInt()
                        ).apply {
                            duration = 2000
                            repeatCount = android.animation.ValueAnimator.INFINITE
                            interpolator = android.view.animation.AccelerateDecelerateInterpolator()
                            addUpdateListener { goldBg.setStroke((2 * dp).toInt(), it.animatedValue as Int) }
                        }
                        android.animation.AnimatorSet().apply {
                            playTogether(bgAnim, borderAnim)
                        }.start()
                    }
                    if (status.status != "active") {
                        Log.d(TAG, "[VIP] showing upgrade button")
                        btnUpgrade.visibility = View.VISIBLE
                        btnUpgrade.setOnClickListener {
                            btnUpgrade.isEnabled = false
                            btnUpgrade.text = "…"
                            val loadUrl = openCheckoutDialog()
                            lifecycleScope.launch {
                                try {
                                    val checkoutUrl = withContext(Dispatchers.IO) {
                                        authRepository.createVipCheckout(uid, httpBaseUrl.trimEnd('/'))
                                    }
                                    loadUrl(checkoutUrl)
                                } catch (e: Exception) {
                                    Toast.makeText(this@MainActivity, "Failed: ${e.message}", Toast.LENGTH_SHORT).show()
                                } finally {
                                    btnUpgrade.isEnabled = true
                                    btnUpgrade.text = "Upgrade"
                                }
                            }
                        }
                        if (showUpgradeHint) showUpgradeOverlay()
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "[VIP] load failed: ${e.message}", e)
                    tvVipStatus.text = "—"
                    btnUpgrade.visibility = View.VISIBLE
                    btnUpgrade.setOnClickListener {
                        btnUpgrade.isEnabled = false
                        btnUpgrade.text = "…"
                        val loadUrl = openCheckoutDialog()
                        lifecycleScope.launch {
                            try {
                                val checkoutUrl = withContext(Dispatchers.IO) {
                                    authRepository.createVipCheckout(uid, httpBaseUrl.trimEnd('/'))
                                }
                                loadUrl(checkoutUrl)
                            } catch (ex: Exception) {
                                Toast.makeText(this@MainActivity, "Failed: ${ex.message}", Toast.LENGTH_SHORT).show()
                            } finally {
                                btnUpgrade.isEnabled = true
                                btnUpgrade.text = "Upgrade"
                            }
                        }
                    }
                    if (showUpgradeHint) showUpgradeOverlay()
                }
            }
        } else {
            Log.w(TAG, "[VIP] uid is null, skipping load")
        }

        // ── Option: Custom ───────────────────────────────────────────────────
        val optionCustom = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            background = optionBg(useCustom)
            setPadding((14 * dp).toInt(), (12 * dp).toInt(), (14 * dp).toInt(), (12 * dp).toInt())
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            )
            isClickable = true
            isFocusable = true
        }
        val radioCustom = android.widget.RadioButton(this).apply {
            isChecked = useCustom
            isClickable = false
            isFocusable = false
            buttonTintList = android.content.res.ColorStateList.valueOf(0xFFDC3232.toInt())
        }
        optionCustom.addView(radioCustom)
        optionCustom.addView(TextView(this).apply {
            text = "Custom"
            textSize = 13f
            setTextColor(0xFFFFFFFF.toInt())
            layoutParams = android.widget.LinearLayout.LayoutParams(0, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .also { it.marginStart = (10 * dp).toInt() }
        })

        root.addView(optionCustom)

        // ── Custom fields (host + port) ──────────────────────────────────────
        val customFields = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            visibility = if (useCustom) android.view.View.VISIBLE else android.view.View.GONE
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.topMargin = (16 * dp).toInt() }
        }

        fun inputBg() = android.graphics.drawable.GradientDrawable().apply {
            setColor(0xFF0A0A0F.toInt())
            cornerRadius = 8 * dp
            setStroke((1 * dp).toInt(), 0xFF333333.toInt())
        }

        customFields.addView(TextView(this).apply {
            text = "Host"
            textSize = 11f
            setTextColor(0xFF888888.toInt())
            setPadding(0, 0, 0, (4 * dp).toInt())
        })
        val etHost = android.widget.EditText(this).apply {
            setText(if (useCustom) savedHost else "")
            hint = "e.g. 192.168.1.100"
            textSize = 13f
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF555555.toInt())
            background = inputBg()
            setPadding((12 * dp).toInt(), (10 * dp).toInt(), (12 * dp).toInt(), (10 * dp).toInt())
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.bottomMargin = (12 * dp).toInt() }
        }
        customFields.addView(etHost)

        customFields.addView(TextView(this).apply {
            text = "Port"
            textSize = 11f
            setTextColor(0xFF888888.toInt())
            setPadding(0, 0, 0, (4 * dp).toInt())
        })
        val etPort = android.widget.EditText(this).apply {
            setText(prefs.getInt("port", 22).toString())
            hint = "22"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            textSize = 13f
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF555555.toInt())
            background = inputBg()
            setPadding((12 * dp).toInt(), (10 * dp).toInt(), (12 * dp).toInt(), (10 * dp).toInt())
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        customFields.addView(etPort)
        root.addView(customFields)

        // ── Toggle logic ─────────────────────────────────────────────────────
        optionDefault.setOnClickListener {
            useCustom = false
            radioDefault.isChecked = true
            radioCustom.isChecked = false
            optionDefault.background = optionBg(true)
            optionCustom.background = optionBg(false)
            customFields.visibility = android.view.View.GONE
            vipDivider.visibility = android.view.View.VISIBLE
            vipRow.visibility = android.view.View.VISIBLE
        }
        optionCustom.setOnClickListener {
            useCustom = true
            radioDefault.isChecked = false
            radioCustom.isChecked = true
            optionDefault.background = optionBg(false)
            optionCustom.background = optionBg(true)
            customFields.visibility = android.view.View.VISIBLE
            vipDivider.visibility = android.view.View.GONE
            vipRow.visibility = android.view.View.GONE
        }

        // ── Buttons ──────────────────────────────────────────────────────────
        val btnRow = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.END
            setPadding(0, (20 * dp).toInt(), 0, 0)
        }

        btnRow.addView(Button(this).apply {
            text = "Cancel"
            textSize = 13f
            setTextColor(0xFF666666.toInt())
            background = null
            isAllCaps = false
            setOnClickListener { dialog.dismiss() }
        })

        btnRow.addView(Button(this).apply {
            text = "Save & Reconnect"
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
                val host = if (useCustom) etHost.text.toString().trim().ifBlank { BuildConfig.SSH_HOST } else BuildConfig.SSH_HOST
                val port = if (useCustom) etPort.text.toString().trim().toIntOrNull() ?: 22 else 22
                prefs.edit().putString("host", host).putInt("port", port).apply()
                wsService?.saveSshConfig(host, port)
                dialog.dismiss()
                Toast.makeText(this@MainActivity, "SSH config saved, reconnecting…", Toast.LENGTH_SHORT).show()
            }
        })

        root.addView(btnRow)

        dialog.window?.apply {
            setBackgroundDrawable(android.graphics.drawable.GradientDrawable().apply {
                setColor(0xFF131318.toInt())
                cornerRadius = 20 * dp
            })
            val params = attributes
            params.width = (resources.displayMetrics.widthPixels * 0.88).toInt()
            attributes = params
        }

        dialog.show()

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

    private fun parseIsoInstant(value: String?): Instant? {
        if (value.isNullOrBlank()) return null
        return try {
            Instant.parse(value)
        } catch (e: Exception) {
            Log.w(TAG, "[VIP] failed to parse instant: $value - ${e.message}")
            null
        }
    }

    private fun isVipStillValid(status: AuthRepository.VipStatus): Boolean {
        val now = Instant.now()
        val trialOk = status.status == "trial" &&
            parseIsoInstant(status.trial_ends_at)?.isAfter(now) == true
        val subOk = status.status == "active" &&
            parseIsoInstant(status.current_period_end)?.isAfter(now) == true
        return trialOk || subOk
    }

    private fun formatVipTrialRemaining(iso: String?): String? {
        val instant = parseIsoInstant(iso) ?: return null
        val now = Instant.now()
        if (!instant.isAfter(now)) return null
        val minutes = Duration.between(now, instant).toMinutes()
        return when {
            minutes <= 0L -> null
            minutes < 60L -> "$minutes min left"
            else -> {
                val hours = minutes / 60
                "$hours h left"
            }
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

    /**
     * Open the checkout WebView dialog immediately (shows loading animation),
     * and return a lambda that loads the URL once it's ready.
     * Call the returned lambda from a coroutine after fetching the checkout URL.
     */
    private fun openCheckoutDialog(): (String) -> Unit {
        val dp = resources.displayMetrics.density

        // Root container
        val container = android.widget.FrameLayout(this)

        val webView = android.webkit.WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            layoutParams = android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT
            )
            visibility = View.INVISIBLE
        }

        // Loading overlay
        val loadingOverlay = android.widget.FrameLayout(this).apply {
            setBackgroundColor(0xFF0A0A0F.toInt())
            layoutParams = android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        // Two pulse rings behind the logo
        val ring1 = android.view.View(this).apply {
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(0x00DC3232)
                setStroke((2 * dp).toInt(), 0x55DC3232)
            }
            val size = (120 * dp).toInt()
            layoutParams = android.widget.FrameLayout.LayoutParams(size, size, android.view.Gravity.CENTER)
        }
        val ring2 = android.view.View(this).apply {
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(0x00DC3232)
                setStroke((2 * dp).toInt(), 0x33DC3232)
            }
            val size = (160 * dp).toInt()
            layoutParams = android.widget.FrameLayout.LayoutParams(size, size, android.view.Gravity.CENTER)
        }

        // Logo image
        val logo = android.widget.ImageView(this).apply {
            setImageResource(R.drawable.logo)
            val size = (64 * dp).toInt()
            layoutParams = android.widget.FrameLayout.LayoutParams(size, size, android.view.Gravity.CENTER)
        }

        // "Loading payment…" label
        val loadingText = android.widget.TextView(this).apply {
            text = "Loading payment…"
            textSize = 13f
            setTextColor(0xFF666666.toInt())
            gravity = android.view.Gravity.CENTER
            layoutParams = android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
                android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
                android.view.Gravity.CENTER
            ).also { it.topMargin = (110 * dp).toInt() }
        }

        loadingOverlay.addView(ring2)
        loadingOverlay.addView(ring1)
        loadingOverlay.addView(logo)
        loadingOverlay.addView(loadingText)

        // Pulse animation on rings + logo
        val pulse1 = android.animation.ObjectAnimator.ofPropertyValuesHolder(
            ring1,
            android.animation.PropertyValuesHolder.ofFloat("scaleX", 1f, 1.3f, 1f),
            android.animation.PropertyValuesHolder.ofFloat("scaleY", 1f, 1.3f, 1f),
            android.animation.PropertyValuesHolder.ofFloat("alpha", 0.8f, 0f, 0.8f)
        ).apply { duration = 1600; repeatCount = android.animation.ValueAnimator.INFINITE
            interpolator = android.view.animation.AccelerateDecelerateInterpolator() }

        val pulse2 = android.animation.ObjectAnimator.ofPropertyValuesHolder(
            ring2,
            android.animation.PropertyValuesHolder.ofFloat("scaleX", 1f, 1.2f, 1f),
            android.animation.PropertyValuesHolder.ofFloat("scaleY", 1f, 1.2f, 1f),
            android.animation.PropertyValuesHolder.ofFloat("alpha", 0.5f, 0f, 0.5f)
        ).apply { duration = 1600; startDelay = 200; repeatCount = android.animation.ValueAnimator.INFINITE
            interpolator = android.view.animation.AccelerateDecelerateInterpolator() }

        val logoPulse = android.animation.ObjectAnimator.ofPropertyValuesHolder(
            logo,
            android.animation.PropertyValuesHolder.ofFloat("scaleX", 1f, 1.08f, 1f),
            android.animation.PropertyValuesHolder.ofFloat("scaleY", 1f, 1.08f, 1f)
        ).apply { duration = 1600; repeatCount = android.animation.ValueAnimator.INFINITE
            interpolator = android.view.animation.AccelerateDecelerateInterpolator() }

        val pulseSet = android.animation.AnimatorSet().apply { playTogether(pulse1, pulse2, logoPulse) }

        container.addView(webView)
        container.addView(loadingOverlay)

        val dialog = android.app.Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        dialog.setContentView(container)
        dialog.setOnDismissListener { pulseSet.cancel() }

        pulseSet.start()

        webView.webViewClient = object : android.webkit.WebViewClient() {
            override fun onPageFinished(view: android.webkit.WebView, url: String) {
                pulseSet.cancel()
                // Fade out overlay, fade in webview
                loadingOverlay.animate().alpha(0f).setDuration(300).withEndAction {
                    loadingOverlay.visibility = View.GONE
                }.start()
                webView.alpha = 0f
                webView.visibility = View.VISIBLE
                webView.animate().alpha(1f).setDuration(300).start()
            }
            override fun shouldOverrideUrlLoading(view: android.webkit.WebView, request: android.webkit.WebResourceRequest): Boolean {
                val uri = request.url.toString()
                if (uri.contains("vip=success") || uri.contains("vip=cancel")) {
                    dialog.dismiss()
                    if (uri.contains("vip=success")) {
                        Toast.makeText(this@MainActivity, "VIP activated!", Toast.LENGTH_SHORT).show()
                    }
                    return true
                }
                return false
            }
        }

        dialog.show()

        return { url -> webView.loadUrl(url) }
    }
}
