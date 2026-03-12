package com.clawpaw.phonecontrol

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.WifiManager
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

private const val TAG = "WsService"
private const val CHANNEL_ID = "clawpaw_ws"
private const val NOTIF_ID = 1
private const val ACTION_KEEPALIVE = "com.clawpaw.ACTION_KEEPALIVE"
private const val KEEPALIVE_INTERVAL_MS = 15_000L

/**
 * Foreground Service — keeps the WebSocket connection alive even when
 * the app is in the background or the screen is off.
 *
 * Start with: Intent(context, WsService::class.java).also {
 *     it.putExtra("uid", uid)
 *     startForegroundService(it)
 * }
 * Bind with: bindService(...) to get status callbacks via setStatusListener().
 */
class WsService : Service() {

    inner class LocalBinder : Binder() {
        val service get() = this@WsService
    }

    private val binder = LocalBinder()
    private var wsClient: WsClient? = null
    private var statusListener: ((Boolean) -> Unit)? = null
    private var sshStatusListener: ((SshTunnelManager.State) -> Unit)? = null
    private lateinit var dispatcher: CommandDispatcher
    private val sshTunnel = SshTunnelManager()
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var alarmManager: AlarmManager? = null
    private var keepalivePendingIntent: PendingIntent? = null

    private val keepaliveReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != ACTION_KEEPALIVE) return
            // Re-acquire WakeLock briefly so the SSH heartbeat coroutine gets CPU time
            val wl = (getSystemService(POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ClawPaw::KeepaliveAlarm")
            wl.acquire(10_000L)
            Log.d(TAG, "Keepalive alarm fired — SSH state=${sshTunnel.state}")
            wl.release()
            scheduleNextKeepaliveAlarm()
        }
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        dispatcher = CommandDispatcher(this, onReconnectSsh = { reconnectSsh() })
        autoEnableAccessibility()
        wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ClawPaw::SshKeepAlive")
            .also { it.acquire() }
        wifiLock = (getSystemService(WIFI_SERVICE) as WifiManager)
            .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "ClawPaw::WifiKeepAlive")
            .also { it.acquire() }
        registerReceiver(keepaliveReceiver, IntentFilter(ACTION_KEEPALIVE),
            if (Build.VERSION.SDK_INT >= 33) RECEIVER_NOT_EXPORTED else 0)
        alarmManager = getSystemService(AlarmManager::class.java)
        scheduleNextKeepaliveAlarm()
    }

    /**
     * Auto-enable ClawAccessibilityService using WRITE_SECURE_SETTINGS.
     * This permission is NOT granted at install time — it must be granted once via adb:
     *   adb shell pm grant com.clawpaw.phonecontrol android.permission.WRITE_SECURE_SETTINGS
     * After that, the app can enable its own accessibility service silently on every launch.
     */
    private fun autoEnableAccessibility() {
        val component = "$packageName/.ClawAccessibilityService"
        try {
            val resolver = contentResolver
            val current = Settings.Secure.getString(
                resolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
            if (!current.contains(component)) {
                val updated = if (current.isBlank()) component else "$current:$component"
                Settings.Secure.putString(
                    resolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, updated
                )
                Settings.Secure.putInt(resolver, Settings.Secure.ACCESSIBILITY_ENABLED, 1)
                Log.i(TAG, "AccessibilityService auto-enabled")
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "WRITE_SECURE_SETTINGS not granted — run: adb shell pm grant $packageName android.permission.WRITE_SECURE_SETTINGS")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val uid = intent?.getStringExtra("uid") ?: run {
            Log.e(TAG, "Started without uid, stopping")
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(NOTIF_ID, buildNotification("Connecting…"))

        if (wsClient == null) {
            wsClient = WsClient(
                uid = uid,
                wsBaseUrl = BuildConfig.WS_URL,
                onStatusChange = { connected ->
                    updateNotification(if (connected) "Connected ✓" else "Reconnecting…")
                    statusListener?.invoke(connected)
                },
                onCommand = { raw -> dispatcher.dispatch(raw) }
            )
            wsClient?.connect()
            Log.i(TAG, "WsClient started for uid=$uid")
        }

        // Start SSH reverse tunnel if configured
        val prefs = getSharedPreferences("ssh_config", MODE_PRIVATE)
        val sshHost = prefs.getString("host", "") ?: ""
        if (sshHost.isNotBlank()) {
            val config = SshConfig(
                host = sshHost,
                port = prefs.getInt("port", 22),
                username = prefs.getString("username", "") ?: "",
                password = prefs.getString("password", "") ?: "",
                remoteAdbPort = prefs.getInt("adb_port", 9000),
            )
            sshTunnel.start(config, onStateChange = { state ->
                Log.i(TAG, "SSH tunnel state: $state")
                sshStatusListener?.invoke(state)
            }, onReleaseTunnel = { releaseTunnelOnBackend() })
            Log.i(TAG, "SSH tunnel started → ${config.host}:${config.remoteAdbPort}")
        }

        return START_STICKY   // restart automatically if killed
    }

    override fun onBind(intent: Intent): IBinder = binder

    override fun onDestroy() {
        keepalivePendingIntent?.let { alarmManager?.cancel(it) }
        try { unregisterReceiver(keepaliveReceiver) } catch (_: Exception) {}
        wsClient?.disconnect()
        wsClient = null
        sshTunnel.stop()
        wakeLock?.release()
        wakeLock = null
        wifiLock?.release()
        wifiLock = null
        super.onDestroy()
    }

    // ── Doze-proof keepalive alarm ───────────────────────────────────────────

    private fun scheduleNextKeepaliveAlarm() {
        val intent = Intent(ACTION_KEEPALIVE).setPackage(packageName)
        val pi = PendingIntent.getBroadcast(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        keepalivePendingIntent = pi
        val triggerAt = System.currentTimeMillis() + KEEPALIVE_INTERVAL_MS
        // setExactAndAllowWhileIdle fires even in Doze mode
        alarmManager?.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
    }

    // ── Public API (used by bound Activity) ─────────────────────────────────

    fun setStatusListener(l: ((Boolean) -> Unit)?) { statusListener = l }
    fun setSshStatusListener(l: ((SshTunnelManager.State) -> Unit)?) { sshStatusListener = l }

    fun isConnected() = wsClient?.state == WsClient.State.CONNECTED

    fun reconnectWs() {
        wsClient?.disconnect()
        wsClient?.connect()
    }

    /**
     * POST /api/adb/release_tunnel — backend disconnects its adb session, flips the port slot,
     * and returns { newPort }. We save the new port to shared prefs and return an updated SshConfig.
     * Throws on HTTP error so the caller (heartbeat) can fall back to the old port.
     */
    private fun releaseTunnelOnBackend(): SshConfig {
        val prefs = getSharedPreferences("ssh_config", MODE_PRIVATE)
        val uid = prefs.getString("uid", "") ?: throw IllegalStateException("no uid")
        val secret = prefs.getString("secret", "") ?: throw IllegalStateException("no secret")
        if (uid.isBlank() || secret.isBlank()) throw IllegalStateException("uid/secret blank")

        val httpBaseUrl = BuildConfig.WS_URL
            .replace(Regex("^wss://"), "https://")
            .replace(Regex("^ws://"), "http://")

        val body = JSONObject().apply { put("uid", uid) }
            .toString()
            .toRequestBody("application/json".toMediaType())

        val request = Request.Builder()
            .url("$httpBaseUrl/api/adb/release_tunnel")
            .header("x-clawpaw-secret", secret)
            .post(body)
            .build()

        OkHttpClient().newCall(request).execute().use { resp ->
            Log.i(TAG, "releaseTunnel → HTTP ${resp.code}")
            ConnectionLog.log("WS", "releaseTunnel HTTP ${resp.code}")
            if (!resp.isSuccessful) throw RuntimeException("HTTP ${resp.code}")

            val json = JSONObject(resp.body?.string() ?: "{}")
            val newPort = json.optJSONObject("data")?.optInt("newPort", 0) ?: 0
            if (newPort > 0) {
                prefs.edit().putInt("adb_port", newPort).apply()
                ConnectionLog.log("WS", "releaseTunnel newPort=$newPort saved")
            }

            return SshConfig(
                host = prefs.getString("host", "") ?: "",
                port = prefs.getInt("port", 22),
                username = prefs.getString("username", "") ?: "",
                password = prefs.getString("password", "") ?: "",
                remoteAdbPort = if (newPort > 0) newPort else prefs.getInt("adb_port", 9000),
            )
        }
    }

    fun reconnectSsh() {
        val prefs = getSharedPreferences("ssh_config", MODE_PRIVATE)
        val host = prefs.getString("host", "") ?: ""
        if (host.isNotBlank()) {
            sshTunnel.stop()
            val config = SshConfig(
                host = host,
                port = prefs.getInt("port", 22),
                username = prefs.getString("username", "") ?: "",
                password = prefs.getString("password", "") ?: "",
                remoteAdbPort = prefs.getInt("adb_port", 9000),
            )
            sshTunnel.start(config, onStateChange = { state ->
                sshStatusListener?.invoke(state)
            }, onReleaseTunnel = { releaseTunnelOnBackend() })
        }
    }

    fun sshState() = sshTunnel.state
    fun sshLastError() = sshTunnel.lastError

    fun testSshConnectivity(): String {
        val prefs = getSharedPreferences("ssh_config", MODE_PRIVATE)
        val host = prefs.getString("host", "") ?: ""
        if (host.isBlank()) return "SSH not configured"
        val config = SshConfig(
            host = host,
            port = prefs.getInt("port", 22),
            username = prefs.getString("username", "") ?: "",
            password = prefs.getString("password", "") ?: "",
            remoteAdbPort = prefs.getInt("adb_port", 9000),
        )
        return sshTunnel.testConnectivity(config)
    }

    data class DebugInfo(
        val wsState: String,
        val wsReconnects: Int,
        val wsLastConnected: String,
        val wsLastFailed: String,
        val wsLastError: String,
        val sshState: String,
        val sshReconnects: Int,
        val sshLastConnected: String,
        val sshLastFailed: String,
        val sshLastError: String,
        val sshHost: String,
        val sshRemotePort: Int,
    )

    fun getDebugInfo(): DebugInfo {
        val prefs = getSharedPreferences("ssh_config", MODE_PRIVATE)
        val fmt = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault())
        fun ts(ms: Long) = if (ms == 0L) "—" else fmt.format(java.util.Date(ms))
        val ws = wsClient
        val ssh = sshTunnel
        return DebugInfo(
            wsState        = ws?.state?.name ?: "—",
            wsReconnects   = ws?.reconnectCount ?: 0,
            wsLastConnected = ts(ws?.lastConnectedAt ?: 0L),
            wsLastFailed   = ts(ws?.lastFailedAt ?: 0L),
            wsLastError    = ws?.lastError ?: "—",
            sshState       = ssh.state.name,
            sshReconnects  = ssh.reconnectCount,
            sshLastConnected = ts(ssh.lastConnectedAt),
            sshLastFailed  = ts(ssh.lastFailedAt),
            sshLastError   = ssh.lastError ?: "—",
            sshHost        = prefs.getString("host", "—") ?: "—",
            sshRemotePort  = prefs.getInt("adb_port", 0),
        )
    }

    fun saveSshConfig(host: String, port: Int) {
        val prefs = getSharedPreferences("ssh_config", MODE_PRIVATE)
        prefs.edit().apply {
            putString("host", host)
            putInt("port", port)
            apply()
        }
        // Restart tunnel with new config (username/password/adb_port already stored during provision)
        sshTunnel.stop()
        if (host.isNotBlank()) {
            val config = SshConfig(
                host = host,
                port = port,
                username = prefs.getString("username", "") ?: "",
                password = prefs.getString("password", "") ?: "",
                remoteAdbPort = prefs.getInt("adb_port", 9000),
            )
            sshTunnel.start(config, onStateChange = { state ->
                Log.i(TAG, "SSH tunnel state: $state")
                sshStatusListener?.invoke(state)
            }, onReleaseTunnel = { releaseTunnelOnBackend() })
        }
    }

    // ── Notification ─────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "ClawPaw Connection",
            NotificationManager.IMPORTANCE_LOW   // silent, no sound
        ).apply { description = "Keeps your phone reachable in the background" }

        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(channel)
    }

    private fun buildNotification(status: String): Notification =
        Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("ClawPaw")
            .setContentText(status)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .build()

    private fun updateNotification(status: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIF_ID, buildNotification(status))
    }
}
