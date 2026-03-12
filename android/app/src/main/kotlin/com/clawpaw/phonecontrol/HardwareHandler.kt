package com.clawpaw.phonecontrol

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import com.google.gson.JsonObject

/**
 * Handles hardware control commands dispatched by [CommandDispatcher].
 *
 * Each method receives parsed params and returns a result object (serialised to JSON by dispatcher).
 * Throws on failure — dispatcher converts exceptions to error responses.
 */
class HardwareHandler(private val context: Context) {

    // ── Volume ────────────────────────────────────────────────────────────────

    suspend fun volume(params: JsonObject): Any {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

        val streamName = params.get("stream")?.asString ?: "media"
        val streamType = when (streamName) {
            "ring"         -> AudioManager.STREAM_RING
            "alarm"        -> AudioManager.STREAM_ALARM
            "notification" -> AudioManager.STREAM_NOTIFICATION
            else           -> AudioManager.STREAM_MUSIC   // "media" default
        }

        val level = params.get("level")?.takeIf { !it.isJsonNull }?.asInt

        return if (level != null) {
            // Set volume
            val max = audio.getStreamMaxVolume(streamType)
            val clamped = level.coerceIn(0, max)
            audio.setStreamVolume(streamType, clamped, 0)
            mapOf("stream" to streamName, "level" to clamped, "max" to max)
        } else {
            // Get volume
            val current = audio.getStreamVolume(streamType)
            val max     = audio.getStreamMaxVolume(streamType)
            mapOf("stream" to streamName, "level" to current, "max" to max)
        }
    }

    // ── Brightness ───────────────────────────────────────────────────────────

    suspend fun brightness(params: JsonObject): Any {
        val resolver = context.contentResolver

        val auto  = params.get("auto")?.takeIf { !it.isJsonNull }?.asBoolean
        val level = params.get("level")?.takeIf { !it.isJsonNull }?.asInt

        if (auto != null) {
            Settings.System.putInt(
                resolver,
                Settings.System.SCREEN_BRIGHTNESS_MODE,
                if (auto) Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC
                else      Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL
            )
        }

        if (level != null) {
            val clamped = level.coerceIn(0, 255)
            Settings.System.putInt(resolver, Settings.System.SCREEN_BRIGHTNESS, clamped)
            return mapOf("brightness" to clamped)
        }

        // Get current brightness
        val current = Settings.System.getInt(
            resolver, Settings.System.SCREEN_BRIGHTNESS, -1
        )
        val mode = Settings.System.getInt(
            resolver, Settings.System.SCREEN_BRIGHTNESS_MODE,
            Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL
        )
        return mapOf(
            "brightness" to current,
            "auto" to (mode == Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC)
        )
    }

    // ── Flashlight ───────────────────────────────────────────────────────────

    private var torchCameraId: String? = null

    // Tracks actual torch state via CameraManager.TorchCallback
    @Volatile private var torchOn = false

    private val torchCallback = object : CameraManager.TorchCallback() {
        override fun onTorchModeChanged(cameraId: String, enabled: Boolean) {
            if (cameraId == torchCameraId) torchOn = enabled
        }
        override fun onTorchModeUnavailable(cameraId: String) {
            if (cameraId == torchCameraId) torchOn = false
        }
    }

    init {
        val cm = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        cm.registerTorchCallback(torchCallback, null)
    }

    suspend fun flashlight(params: JsonObject): Any {
        val cm = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager

        // Find a camera with a flash unit (usually back camera)
        if (torchCameraId == null) {
            torchCameraId = cm.cameraIdList.firstOrNull { id ->
                cm.getCameraCharacteristics(id)
                    .get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
            }
        }

        val cameraId = torchCameraId
            ?: throw IllegalStateException("No camera with flash found")

        val on = params.get("on")?.takeIf { !it.isJsonNull }?.asBoolean

        return if (on != null) {
            cm.setTorchMode(cameraId, on)
            mapOf("on" to on)
        } else {
            mapOf("on" to torchOn)
        }
    }

    // ── Vibrate ───────────────────────────────────────────────────────────────

    @Suppress("DEPRECATION")
    suspend fun vibrate(params: JsonObject): Any {
        val durationMs = params.get("duration")?.takeIf { !it.isJsonNull }?.asLong ?: 500L
        val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator

        vibrator.vibrate(
            VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE)
        )

        return mapOf("duration" to durationMs)
    }

    // ── Ringtone Mode ─────────────────────────────────────────────────────────

    suspend fun ringtoneMode(params: JsonObject): Any {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

        val mode = params.get("mode")?.takeIf { !it.isJsonNull }?.asString

        return if (mode != null) {
            val ringerMode = when (mode) {
                "silent"  -> AudioManager.RINGER_MODE_SILENT
                "vibrate" -> AudioManager.RINGER_MODE_VIBRATE
                "normal"  -> AudioManager.RINGER_MODE_NORMAL
                else -> throw IllegalArgumentException("Unknown mode: $mode. Use: silent, vibrate, normal")
            }
            audio.ringerMode = ringerMode
            mapOf("mode" to mode)
        } else {
            val current = when (audio.ringerMode) {
                AudioManager.RINGER_MODE_SILENT  -> "silent"
                AudioManager.RINGER_MODE_VIBRATE -> "vibrate"
                AudioManager.RINGER_MODE_NORMAL  -> "normal"
                else -> "unknown"
            }
            mapOf("mode" to current)
        }
    }
}
