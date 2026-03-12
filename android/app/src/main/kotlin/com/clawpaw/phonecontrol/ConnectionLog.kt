package com.clawpaw.phonecontrol

import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale

/**
 * In-memory ring buffer of connection state-change events.
 * Thread-safe. Keeps the last MAX_ENTRIES entries.
 */
object ConnectionLog {
    private const val MAX_ENTRIES = 100

    data class Entry(val ts: Long, val tag: String, val event: String)

    private val lock = Any()
    private val entries = ArrayDeque<Entry>(MAX_ENTRIES + 1)

    fun log(tag: String, event: String) {
        synchronized(lock) {
            entries.addLast(Entry(System.currentTimeMillis(), tag, event))
            if (entries.size > MAX_ENTRIES) entries.removeFirst()
        }
    }

    fun dump(): String {
        val fmt = SimpleDateFormat("HH:mm:ss.SSS", Locale.getDefault())
        return synchronized(lock) {
            entries.joinToString("\n") { e ->
                "${fmt.format(Date(e.ts))}  [${e.tag}]  ${e.event}"
            }
        }
    }

    fun clear() = synchronized(lock) { entries.clear() }
}
