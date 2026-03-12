package com.clawpaw.phonecontrol

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.provider.ContactsContract
import android.provider.Telephony
import android.util.Log
import com.google.gson.JsonObject

/**
 * Handles communication commands: sms, contacts, notifications, clipboard.
 */
class CommunicationHandler(private val context: Context) {

    companion object {
        private const val TAG = "CommunicationHandler"
    }

    // ── SMS ───────────────────────────────────────────────────────────────────

    suspend fun sms(params: JsonObject): Any {
        val limit     = params.get("limit")?.takeIf { !it.isJsonNull }?.asInt ?: 10
        val unread    = params.get("unread")?.takeIf { !it.isJsonNull }?.asBoolean ?: false
        val from      = params.get("from")?.takeIf { !it.isJsonNull }?.asString

        val messages  = mutableListOf<Map<String, Any>>()
        val uri       = Telephony.Sms.CONTENT_URI

        var selection = if (unread) "${Telephony.Sms.READ} = 0" else null
        val selectionArgs = mutableListOf<String>()

        if (from != null) {
            selection = (selection?.plus(" AND ") ?: "") + "${Telephony.Sms.ADDRESS} LIKE ?"
            selectionArgs.add("%$from%")
        }

        try {
            context.contentResolver.query(
                uri, null,
                selection,
                selectionArgs.takeIf { it.isNotEmpty() }?.toTypedArray(),
                "${Telephony.Sms.DATE} DESC"
            )?.use { cursor ->
                var count = 0
                while (cursor.moveToNext() && count < limit) {
                    val body = cursor.getString(cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)) ?: ""
                    val msg = mutableMapOf<String, Any>(
                        "id"      to cursor.getLong(cursor.getColumnIndexOrThrow(Telephony.Sms._ID)),
                        "address" to (cursor.getString(cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)) ?: ""),
                        "body"    to body,
                        "date"    to cursor.getLong(cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)),
                        "read"    to (cursor.getInt(cursor.getColumnIndexOrThrow(Telephony.Sms.READ)) == 1),
                        "type"    to cursor.getInt(cursor.getColumnIndexOrThrow(Telephony.Sms.TYPE))
                    )
                    extractVerificationCode(body)?.let { msg["code"] = it }
                    messages.add(msg)
                    count++
                }
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "SMS permission denied", e)
            return listOf(mapOf("error" to "READ_SMS permission required"))
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read SMS", e)
            return listOf(mapOf("error" to (e.message ?: "Unknown error")))
        }

        return messages
    }

    private fun extractVerificationCode(text: String): String? {
        val patterns = listOf(
            """验证码[：:\s]*(\d{4,8})""",
            """code[：:\s]*(\d{4,8})""",
            """[\[【](\d{4,8})[\]】]""",
            """(?<!\d)(\d{6})(?!\d)"""
        )
        for (pattern in patterns) {
            val match = Regex(pattern, RegexOption.IGNORE_CASE).find(text)
            if (match != null) return match.groupValues[1]
        }
        return null
    }

    // ── Contacts ──────────────────────────────────────────────────────────────

    suspend fun contacts(params: JsonObject): Any {
        val search = params.get("search")?.takeIf { !it.isJsonNull }?.asString
        val limit  = params.get("limit")?.takeIf { !it.isJsonNull }?.asInt ?: 50

        val results = mutableListOf<Map<String, Any>>()
        val uri     = ContactsContract.CommonDataKinds.Phone.CONTENT_URI

        val selection = if (search != null)
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ? OR " +
            "${ContactsContract.CommonDataKinds.Phone.NUMBER} LIKE ?"
        else null
        val selectionArgs = if (search != null) arrayOf("%$search%", "%$search%") else null

        try {
            context.contentResolver.query(
                uri, null, selection, selectionArgs,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME
            )?.use { cursor ->
                var count = 0
                val seen  = mutableSetOf<String>()
                while (cursor.moveToNext() && count < limit) {
                    val name  = cursor.getString(cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)) ?: ""
                    val phone = cursor.getString(cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)) ?: ""
                    val key   = "$name:$phone"
                    if (key !in seen) {
                        seen.add(key)
                        results.add(mapOf(
                            "id"    to cursor.getLong(cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.CONTACT_ID)),
                            "name"  to name,
                            "phone" to phone,
                            "type"  to cursor.getInt(cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.TYPE))
                        ))
                        count++
                    }
                }
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "Contacts permission denied", e)
            return listOf(mapOf("error" to "READ_CONTACTS permission required"))
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read contacts", e)
            return listOf(mapOf("error" to (e.message ?: "Unknown error")))
        }

        return results
    }

    // ── Notifications ─────────────────────────────────────────────────────────

    suspend fun notifications(params: JsonObject): Any {
        val limit = params.get("limit")?.takeIf { !it.isJsonNull }?.asInt ?: 50
        return ClawNotificationListener.getNotifications(limit)
    }

    // ── Clipboard ─────────────────────────────────────────────────────────────

    suspend fun clipboard(params: JsonObject): Any {
        val cm   = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val text = params.get("text")?.takeIf { !it.isJsonNull }?.asString

        return if (text != null) {
            cm.setPrimaryClip(ClipData.newPlainText("clawpaw", text))
            mapOf("success" to true)
        } else {
            val clip = cm.primaryClip
            val content = if (clip != null && clip.itemCount > 0)
                clip.getItemAt(0).text?.toString() ?: ""
            else ""
            mapOf("text" to content)
        }
    }
}
