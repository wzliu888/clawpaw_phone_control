package com.clawpaw.phonecontrol

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

/**
 * NotificationListenerService — collects incoming notifications into a ring buffer.
 *
 * Must be enabled by the user via: Settings → Notifications → Special app access → Notification access
 */
class ClawNotificationListener : NotificationListenerService() {

    companion object {
        private const val TAG      = "ClawNotifListener"
        private const val MAX_SIZE = 200

        private val recent = ArrayDeque<Map<String, Any>>(MAX_SIZE)

        fun getNotifications(limit: Int): List<Map<String, Any>> {
            synchronized(recent) {
                return recent.takeLast(limit.coerceAtMost(recent.size))
                    .reversed()   // most recent first
            }
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val extras = sbn.notification.extras
        val title  = extras.getCharSequence("android.title")?.toString() ?: ""
        val text   = extras.getCharSequence("android.text")?.toString()  ?: ""
        val bigText = extras.getCharSequence("android.bigText")?.toString() ?: ""

        val entry = mapOf(
            "pkg"      to sbn.packageName,
            "id"       to sbn.id,
            "title"    to title,
            "text"     to (bigText.ifEmpty { text }),
            "time"     to sbn.postTime,
            "ongoing"  to sbn.isOngoing,
        )

        Log.d(TAG, "notification: pkg=${sbn.packageName} title=$title")

        synchronized(recent) {
            if (recent.size >= MAX_SIZE) recent.removeFirst()
            recent.addLast(entry)
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) { /* no-op */ }
}
