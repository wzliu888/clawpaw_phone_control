package com.clawpaw.phonecontrol

import android.util.Log
import com.jcraft.jsch.JSch
import com.jcraft.jsch.Session
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.Properties
import kotlin.math.pow

private const val TAG = "SshTunnelManager"

data class SshConfig(
    val host: String,
    val port: Int = 22,
    val username: String,
    val password: String,
    val remoteAdbPort: Int,   // port exposed on server → maps to phone ADB 5555
    val localAdbPort: Int = 5555,
)

class SshTunnelManager {

    enum class State { DISCONNECTED, CONNECTING, CONNECTED, ERROR }

    @Volatile var state: State = State.DISCONNECTED
        private set

    @Volatile var lastError: String? = null
        private set
    @Volatile var reconnectCount: Int = 0
        private set
    @Volatile var lastConnectedAt: Long = 0L
        private set
    @Volatile var lastFailedAt: Long = 0L
        private set

    private var session: Session? = null
    private var heartbeatJob: Job? = null
    private var scope: CoroutineScope? = null

    @Volatile private var shouldReconnect = false

    fun start(
        config: SshConfig,
        onStateChange: ((State) -> Unit)? = null,
        onReleaseTunnel: (suspend () -> SshConfig)? = null,
    ) {
        shouldReconnect = true
        scope?.cancel()
        scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        scope!!.launch {
            connectWithRetry(config, onStateChange, onReleaseTunnel)
        }
    }

    fun stop() {
        shouldReconnect = false
        heartbeatJob?.cancel()
        scope?.cancel()
        scope = null
        disconnect()
        state = State.DISCONNECTED
    }

    fun isConnected(): Boolean {
        val s = session ?: return false
        if (!s.isConnected) return false
        return try { s.sendKeepAliveMsg(); true } catch (e: Exception) { false }
    }

    /** Probe SSH session liveness.
     *  Relies on JSch's built-in ServerAliveInterval (set to 10s) which sends SSH keepalive
     *  packets and disconnects the session after ServerAliveCountMax failures.
     *  So session.isConnected==false reliably means the TCP path is dead.
     *  Does NOT require shell access — works with /bin/false users. */
    fun isTunnelAliveViaSsh(serverHost: String, serverSshPort: Int = 22): Boolean {
        val s = session ?: return false
        return s.isConnected
    }

    /**
     * Active SSH connectivity test — called from the debug panel.
     * Returns a multi-line diagnostic string describing each check.
     */
    fun testConnectivity(config: SshConfig): String {
        val sb = StringBuilder()

        // 1. Check existing session
        val s = session
        if (s == null) {
            sb.appendLine("Session: null (not started)")
        } else {
            sb.appendLine("Session.isConnected: ${s.isConnected}")
            if (s.isConnected) {
                val alive = try { s.sendKeepAliveMsg(); true } catch (e: Exception) { false }
                sb.appendLine("sendKeepAliveMsg: ${if (alive) "ok" else "FAILED"}")
            }
        }

        // 2. Try opening a fresh TCP+SSH connection (proves server port is reachable)
        sb.appendLine("Probe new SSH session → ${config.host}:${config.port} ...")
        try {
            val jsch = JSch()
            val probe = jsch.getSession(config.username, config.host, config.port).apply {
                setPassword(config.password)
                setConfig(Properties().apply {
                    put("StrictHostKeyChecking", "no")
                    put("ServerAliveInterval", "10")
                    put("ServerAliveCountMax", "1")
                })
                connect(8_000)
            }
            sb.appendLine("New session: CONNECTED ✓")
            try { probe.disconnect() } catch (_: Exception) {}
        } catch (e: Exception) {
            sb.appendLine("New session: FAILED — ${e.message}")
        }

        return sb.toString().trimEnd()
    }

    private suspend fun connectWithRetry(config: SshConfig, onStateChange: ((State) -> Unit)?, onReleaseTunnel: (suspend () -> SshConfig)? = null) {
        var attempt = 0
        while (shouldReconnect) {
            try {
                ConnectionLog.log("SSH", "connect attempt ${attempt + 1} → ${config.host}:${config.port}")
                connect(config, onStateChange)
                // connected — start heartbeat and wait
                attempt = 0
                startHeartbeat(config, onStateChange, onReleaseTunnel)
                return
            } catch (e: Exception) {
                Log.e(TAG, "Attempt ${attempt + 1} failed: ${e.message}")
                ConnectionLog.log("SSH", "attempt ${attempt + 1} FAILED: ${e.message}")
                lastError = e.message
            }
            attempt++
            if (shouldReconnect) {
                val delayMs = (500L * 1.5.pow(attempt - 1).toLong()).coerceAtMost(10_000L)
                Log.d(TAG, "Retry in ${delayMs}ms")
                ConnectionLog.log("SSH", "retry in ${delayMs}ms")
                setState(State.CONNECTING, onStateChange)
                delay(delayMs)
            }
        }
    }

    private fun connect(config: SshConfig, onStateChange: ((State) -> Unit)?) {
        setState(State.CONNECTING, onStateChange)
        try {
            val jsch = JSch()
            val s = jsch.getSession(config.username, config.host, config.port).apply {
                setPassword(config.password)
                setConfig(Properties().apply {
                    put("StrictHostKeyChecking", "no")
                    put("ServerAliveInterval", "30")
                    put("ServerAliveCountMax", "10")
                })
                connect(10_000)
                // Reverse tunnel: server:remoteAdbPort → phone:5555
                setPortForwardingR(config.remoteAdbPort, "127.0.0.1", config.localAdbPort)
                Log.i(TAG, "ADB tunnel: ${config.host}:${config.remoteAdbPort} → localhost:${config.localAdbPort}")
            }
            session = s
            lastError = null
            lastConnectedAt = System.currentTimeMillis()
            ConnectionLog.log("SSH", "tunnel up → ${config.host}:${config.remoteAdbPort}")
            setState(State.CONNECTED, onStateChange)
        } catch (e: Exception) {
            lastError = e.message
            lastFailedAt = System.currentTimeMillis()
            reconnectCount++
            setState(State.ERROR, onStateChange)
            disconnect()
            throw e
        }
    }

    private fun startHeartbeat(
        config: SshConfig,
        onStateChange: ((State) -> Unit)?,
        onReleaseTunnel: (suspend () -> SshConfig)? = null,
    ) {
        heartbeatJob?.cancel()
        heartbeatJob = scope!!.launch {
            var probeCount = 0
            while (isActive && shouldReconnect) {
                delay(60_000L)
                probeCount++
                Log.d(TAG, "Heartbeat probe #$probeCount")
                ConnectionLog.log("SSH", "probe #$probeCount")
                val alive = isTunnelAliveViaSsh(config.host, config.port)
                if (!alive) {
                    Log.w(TAG, "SSH probe #$probeCount FAILED — releasing tunnel and reconnecting")
                    ConnectionLog.log("SSH", "probe #$probeCount FAILED — releasing port")
                    setState(State.CONNECTING, onStateChange)
                    disconnect()
                    // Ask backend to release the old port and get the new port to use
                    val nextConfig = try {
                        val c = onReleaseTunnel?.invoke() ?: config
                        ConnectionLog.log("SSH", "backend release_tunnel → newPort=${c.remoteAdbPort}")
                        c
                    } catch (e: Exception) {
                        Log.w(TAG, "Backend port release failed: ${e.message}")
                        ConnectionLog.log("SSH", "backend release_tunnel FAILED: ${e.message} — reusing old port")
                        config
                    }
                    connectWithRetry(nextConfig, onStateChange, onReleaseTunnel)
                    return@launch
                }
                Log.d(TAG, "SSH probe #$probeCount ok")
                ConnectionLog.log("SSH", "probe #$probeCount ok")
            }
        }
    }

    private fun disconnect() {
        try { session?.disconnect() } catch (_: Exception) {}
        session = null
    }

    private fun setState(s: State, onStateChange: ((State) -> Unit)?) {
        ConnectionLog.log("SSH", if (s == State.ERROR) "ERROR: ${lastError ?: "unknown"}" else s.name)
        state = s
        onStateChange?.invoke(s)
    }
}
