package com.clawpaw.phonecontrol

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonObject

private const val TAG = "CommandDispatcher"

/**
 * Parses incoming WebSocket messages from the backend and dispatches them
 * to the appropriate command handler.
 *
 * Protocol (backend → phone):
 *   { "jsonrpc": "2.0", "id": "<id>", "method": "<method>", "params": { ... } }
 *
 * Response (phone → backend):
 *   { "id": "<id>", "result": <any> }          on success
 *   { "id": "<id>", "error": { "message": "..." } }  on failure
 */
class CommandDispatcher(
    private val context: Context,
    private val onReconnectSsh: (() -> Unit)? = null,
) {

    private val gson                  = Gson()
    private val hardwareHandler       = HardwareHandler(context)
    private val uiHandler             = UiHandler()
    private val deviceHandler         = DeviceHandler(context)
    private val appsHandler           = AppsHandler(context)
    private val mediaHandler          = MediaHandler(context)
    private val communicationHandler  = CommunicationHandler(context)
    private val filesHandler          = FilesHandler()

    /** All registered method → handler mappings */
    private val handlers: Map<String, suspend (JsonObject) -> Any> = mapOf(
        // Hardware
        "volume"        to hardwareHandler::volume,
        "brightness"    to hardwareHandler::brightness,
        "flashlight"    to hardwareHandler::flashlight,
        "vibrate"       to hardwareHandler::vibrate,
        "ringtone_mode" to hardwareHandler::ringtoneMode,
        // UI
        "screenshot"    to uiHandler::screenshot,
        "snapshot"      to uiHandler::snapshot,
        "tap"           to uiHandler::tap,
        "long_press"    to uiHandler::longPress,
        "swipe"         to uiHandler::swipe,
        "type_text"     to uiHandler::typeText,
        "press_key"     to uiHandler::pressKey,
        // Device
        "battery"       to deviceHandler::battery,
        "location"      to deviceHandler::location,
        "network"       to deviceHandler::network,
        "storage"       to deviceHandler::storage,
        "screen_state"  to deviceHandler::screenState,
        // Apps
        "list_apps"     to appsHandler::listApps,
        "launch_app"    to appsHandler::launchApp,
        "shell"         to appsHandler::shell,
        // Media
        "camera_snap"   to mediaHandler::cameraSnap,
        "audio_record"  to mediaHandler::audioRecord,
        "audio_status"  to mediaHandler::audioStatus,
        "sensors"       to mediaHandler::sensors,
        // Communication
        "sms"           to communicationHandler::sms,
        "contacts"      to communicationHandler::contacts,
        "notifications" to communicationHandler::notifications,
        "clipboard"     to communicationHandler::clipboard,
        // Files
        "files"         to filesHandler::files,
        "write_file"    to filesHandler::writeFile,
        // System
        "reconnect_ssh" to ::reconnectSsh,
    )

    /**
     * Dispatch a raw JSON string received from the WebSocket.
     * @return JSON string to send back to the backend, or null if message is not dispatchable.
     */
    suspend fun dispatch(raw: String): String? {
        val msg = try {
            gson.fromJson(raw, JsonObject::class.java)
        } catch (e: Exception) {
            Log.w(TAG, "Non-JSON message: $raw")
            return null
        }

        val id     = msg.get("id")?.takeIf { !it.isJsonNull }?.asString ?: return null
        val method = msg.get("method")?.asString ?: return null
        val params = msg.getAsJsonObject("params") ?: JsonObject()

        Log.i(TAG, "dispatch id=$id method=$method")

        val handler = handlers[method]
        if (handler == null) {
            Log.w(TAG, "Unknown method: $method")
            return errorResponse(id, "Unknown method: $method")
        }

        return try {
            val result = handler(params)
            successResponse(id, result)
        } catch (e: Exception) {
            Log.e(TAG, "Handler error for $method: ${e.message}")
            errorResponse(id, e.message ?: "Handler error")
        }
    }

    private suspend fun reconnectSsh(@Suppress("UNUSED_PARAMETER") params: JsonObject): Any {
        onReconnectSsh?.invoke()
        return mapOf("triggered" to true)
    }

    private fun successResponse(id: String, result: Any): String =
        gson.toJson(mapOf("id" to id, "result" to result))

    private fun errorResponse(id: String, message: String): String =
        gson.toJson(mapOf("id" to id, "error" to mapOf("message" to message)))
}
