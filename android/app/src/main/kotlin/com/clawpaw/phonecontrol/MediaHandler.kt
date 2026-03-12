package com.clawpaw.phonecontrol

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.ImageReader
import android.media.MediaRecorder
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import com.google.gson.JsonObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Handles camera_snap, audio_record, and sensors commands.
 */
class MediaHandler(private val context: Context) {

    private val cameraThread = HandlerThread("CameraThread").apply { start() }
    private val cameraHandler = Handler(cameraThread.looper)

    // ── Camera Snap ───────────────────────────────────────────────────────────

    suspend fun cameraSnap(params: JsonObject): Any {
        if (context.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("Camera permission not granted")
        }

        val useFront = params.get("camera")?.asString?.lowercase() == "front"
        val quality  = params.get("quality")?.takeIf { !it.isJsonNull }?.asInt?.coerceIn(1, 100) ?: 80

        val cm = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val cameraId = cm.cameraIdList.firstOrNull { id ->
            val facing = cm.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING)
            if (useFront) facing == CameraCharacteristics.LENS_FACING_FRONT
            else          facing == CameraCharacteristics.LENS_FACING_BACK
        } ?: throw IllegalStateException("Camera not available")

        val map = cm.getCameraCharacteristics(cameraId)
            .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            ?: throw IllegalStateException("Cannot get stream configuration")

        val size = map.getOutputSizes(android.graphics.ImageFormat.JPEG)
            .filter { it.width <= 1920 && it.height <= 1920 }
            .maxByOrNull { it.width.toLong() * it.height }
            ?: map.getOutputSizes(android.graphics.ImageFormat.JPEG).minByOrNull { it.width.toLong() * it.height }
            ?: throw IllegalStateException("No suitable image size")

        val imageReader = ImageReader.newInstance(size.width, size.height, android.graphics.ImageFormat.JPEG, 1)
        val latch = CountDownLatch(1)
        var capturedBytes: ByteArray? = null
        var cameraDevice: CameraDevice? = null

        imageReader.setOnImageAvailableListener({ reader ->
            val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
            val buffer = image.planes[0].buffer
            capturedBytes = ByteArray(buffer.remaining()).also { buffer.get(it) }
            image.close()
            latch.countDown()
        }, cameraHandler)

        val openLatch = CountDownLatch(1)
        cm.openCamera(cameraId, object : CameraDevice.StateCallback() {
            override fun onOpened(camera: CameraDevice) {
                cameraDevice = camera
                openLatch.countDown()
            }
            override fun onDisconnected(camera: CameraDevice) {
                camera.close()
                openLatch.countDown()
            }
            override fun onError(camera: CameraDevice, error: Int) {
                camera.close()
                openLatch.countDown()
            }
        }, cameraHandler)

        if (!openLatch.await(5, TimeUnit.SECONDS)) {
            imageReader.close()
            throw IllegalStateException("Camera open timeout")
        }

        val device = cameraDevice ?: run {
            imageReader.close()
            throw IllegalStateException("Failed to open camera")
        }

        try {
            val captureRequest = device.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply {
                addTarget(imageReader.surface)
                set(CaptureRequest.JPEG_QUALITY, quality.toByte())
                set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
            }

            device.createCaptureSession(listOf(imageReader.surface), object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(session: CameraCaptureSession) {
                    session.capture(captureRequest.build(), null, cameraHandler)
                }
                override fun onConfigureFailed(session: CameraCaptureSession) {
                    latch.countDown()
                }
            }, cameraHandler)

            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw IllegalStateException("Camera capture timeout")
            }
        } finally {
            device.close()
            imageReader.close()
        }

        val bytes = capturedBytes ?: throw IllegalStateException("No image captured")
        return mapOf(
            "image"   to Base64.encodeToString(bytes, Base64.NO_WRAP),
            "mimeType" to "image/jpeg",
            "width"   to size.width,
            "height"  to size.height,
            "camera"  to if (useFront) "front" else "back",
        )
    }

    // ── Audio Record ──────────────────────────────────────────────────────────

    @Volatile private var recorder: MediaRecorder? = null
    @Volatile private var recordingFile: File? = null
    @Volatile private var isRecording = false

    suspend fun audioRecord(params: JsonObject): Any {
        val action = params.get("action")?.asString ?: "capture"

        return when (action) {
            "start" -> startRecording(params)
            "stop"  -> stopRecording()
            "capture" -> {
                // Start, wait for duration, stop and return audio
                val durationSec = params.get("duration")?.takeIf { !it.isJsonNull }?.asLong?.coerceIn(1, 60) ?: 5L
                startRecording(params)
                kotlinx.coroutines.delay(durationSec * 1000)
                stopRecording()
            }
            else -> throw IllegalArgumentException("Unknown action: $action. Use start, stop, or capture.")
        }
    }

    private fun startRecording(params: JsonObject): Any {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("RECORD_AUDIO permission not granted")
        }
        if (isRecording) throw IllegalStateException("Already recording")

        val format = params.get("format")?.asString ?: "m4a"
        val file = File(context.cacheDir, "clawpaw_audio_${System.currentTimeMillis()}.$format")
        recordingFile = file

        @Suppress("DEPRECATION")
        val rec = MediaRecorder().apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(if (format == "3gp") MediaRecorder.OutputFormat.THREE_GPP else MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioSamplingRate(44100)
            setAudioEncodingBitRate(128_000)
            setOutputFile(file.absolutePath)
            prepare()
            start()
        }
        recorder = rec
        isRecording = true
        return mapOf("status" to "recording", "format" to format)
    }

    private fun stopRecording(): Any {
        if (!isRecording) throw IllegalStateException("Not recording")
        val rec = recorder ?: throw IllegalStateException("No recorder")
        val file = recordingFile ?: throw IllegalStateException("No recording file")

        try {
            rec.stop()
            rec.release()
        } finally {
            recorder = null
            isRecording = false
        }

        val bytes = file.readBytes()
        val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        file.delete()

        return mapOf(
            "audio"     to base64,
            "mimeType"  to "audio/mp4",
            "sizeBytes" to bytes.size,
        )
    }

    suspend fun audioStatus(params: JsonObject): Any {
        return mapOf("recording" to isRecording)
    }

    // ── Sensors ───────────────────────────────────────────────────────────────

    suspend fun sensors(params: JsonObject): Any {
        val type = params.get("type")?.takeIf { !it.isJsonNull }?.asString

        val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager

        val sensorTypes = if (type != null) {
            mapOf(type to nameToSensorType(type))
        } else {
            mapOf(
                "accelerometer" to Sensor.TYPE_ACCELEROMETER,
                "gyroscope"     to Sensor.TYPE_GYROSCOPE,
                "magnetometer"  to Sensor.TYPE_MAGNETIC_FIELD,
                "light"         to Sensor.TYPE_LIGHT,
                "proximity"     to Sensor.TYPE_PROXIMITY,
                "pressure"      to Sensor.TYPE_PRESSURE,
                "gravity"       to Sensor.TYPE_GRAVITY,
                "rotation"      to Sensor.TYPE_ROTATION_VECTOR,
            )
        }

        val results = mutableMapOf<String, Any>()

        for ((name, sensorType) in sensorTypes) {
            val sensor = sm.getDefaultSensor(sensorType)
            if (sensor == null) {
                results[name] = mapOf("error" to "Sensor not available")
                continue
            }

            val latch = CountDownLatch(1)
            var values: FloatArray? = null

            val listener = object : SensorEventListener {
                override fun onSensorChanged(event: SensorEvent) {
                    values = event.values.copyOf()
                    latch.countDown()
                }
                override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}
            }

            sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_FASTEST)
            val got = latch.await(2, TimeUnit.SECONDS)
            sm.unregisterListener(listener)

            results[name] = if (got && values != null) {
                mapOf("values" to values!!.toList())
            } else {
                mapOf("error" to "Sensor read timeout")
            }
        }

        return results
    }

    private fun nameToSensorType(name: String): Int = when (name) {
        "accelerometer" -> Sensor.TYPE_ACCELEROMETER
        "gyroscope"     -> Sensor.TYPE_GYROSCOPE
        "magnetometer"  -> Sensor.TYPE_MAGNETIC_FIELD
        "light"         -> Sensor.TYPE_LIGHT
        "proximity"     -> Sensor.TYPE_PROXIMITY
        "pressure"      -> Sensor.TYPE_PRESSURE
        "gravity"       -> Sensor.TYPE_GRAVITY
        "rotation"      -> Sensor.TYPE_ROTATION_VECTOR
        else            -> throw IllegalArgumentException("Unknown sensor type: $name. Use: accelerometer, gyroscope, magnetometer, light, proximity, pressure, gravity, rotation")
    }
}
