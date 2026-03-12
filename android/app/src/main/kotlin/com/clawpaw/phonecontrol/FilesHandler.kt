package com.clawpaw.phonecontrol

import android.util.Log
import com.google.gson.JsonObject
import java.io.File

/**
 * Handles file system commands: files (list/read), write_file.
 */
class FilesHandler {

    companion object {
        private const val TAG = "FilesHandler"
    }

    suspend fun files(params: JsonObject): Any {
        val path = params.get("path")?.takeIf { !it.isJsonNull }?.asString
            ?: return mapOf("error" to "path parameter required")

        return try {
            val file = File(path)
            when {
                !file.exists() -> mapOf("error" to "Not found: $path")
                file.isDirectory -> {
                    val entries = file.listFiles()?.map { f ->
                        mapOf(
                            "name"         to f.name,
                            "path"         to f.absolutePath,
                            "isDirectory"  to f.isDirectory,
                            "size"         to f.length(),
                            "lastModified" to f.lastModified(),
                        )
                    } ?: emptyList<Map<String, Any>>()
                    mapOf("path" to path, "files" to entries)
                }
                else -> mapOf(
                    "path"    to path,
                    "size"    to file.length(),
                    "content" to file.readText(),
                )
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "files permission denied: $path", e)
            mapOf("error" to "Permission denied: $path")
        } catch (e: Exception) {
            Log.e(TAG, "files error: $path", e)
            mapOf("error" to (e.message ?: "Unknown error"))
        }
    }

    suspend fun writeFile(params: JsonObject): Any {
        val path    = params.get("path")?.takeIf { !it.isJsonNull }?.asString
            ?: return mapOf("error" to "path parameter required")
        val content = params.get("content")?.takeIf { !it.isJsonNull }?.asString
            ?: return mapOf("error" to "content parameter required")

        return try {
            val file = File(path)
            file.parentFile?.mkdirs()
            file.writeText(content)
            mapOf("success" to true, "path" to path, "bytes" to content.toByteArray().size)
        } catch (e: SecurityException) {
            Log.e(TAG, "write_file permission denied: $path", e)
            mapOf("error" to "Permission denied: $path")
        } catch (e: Exception) {
            Log.e(TAG, "write_file error: $path", e)
            mapOf("error" to (e.message ?: "Unknown error"))
        }
    }
}
