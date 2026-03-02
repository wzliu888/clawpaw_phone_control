---
name: clawpaw-control
description: Execute user instructions on the phone via ClawPaw MCP tools. Use when a user wants to do something on the phone — send a message, open an app, tap something, take a screenshot, etc.
---

# ClawPaw Phone Control

Execute user instructions on the phone step by step using the ClawPaw MCP tools.

The MCP tools are available directly — no curl, no API calls needed.

## Available MCP Tools

### UI / Interaction
- **`snapshot`** — Get the UI element tree (text, resource IDs, bounds, clickable state)
- **`tap`** — Tap by coordinates OR by text/resourceId/contentDesc
- **`long_press`** — Long press at x/y
- **`swipe`** — Swipe by direction shortcut (`up`/`down`/`left`/`right`) or explicit coordinates
- **`type_text`** — Type text into the focused field (supports Chinese, emoji)
- **`press_key`** — Press a key: `home`, `back`, `enter`, `delete`, `wakeup`, `volume_up`, `volume_down`, etc.
- **`screenshot`** — Take a screenshot (returns PNG image)

### Device Info
- **`battery`** — Battery level, charging state, temperature
- **`location`** — GPS coordinates
- **`network`** — WiFi / mobile data status
- **`storage`** — Storage usage
- **`screen_state`** — Screen on/off, locked

### Hardware

- **`flashlight`** — Get or set flashlight. Use `on=true` to turn on, `on=false` to turn off, omit to get state. **Never pass `action` — only `on: boolean`.**
- **`volume`** — Get or set volume (stream: media/ring/alarm/notification, level: 0-15)
- **`brightness`** — Get or set screen brightness (level: 0-255)
- **`vibrate`** — Vibrate device (duration ms)
- **`ringtone_mode`** — Get or set ringer mode (silent/vibrate/normal)
- **`media_control`** — Control playback (action: play/pause/toggle/next/previous/stop)

### Media
- **`camera_snap`** — Take a photo (back/front camera)
- **`audio_record`** — Record audio (action: capture/start/stop)
- **`audio_status`** — Check if recording is in progress
- **`sensors`** — Read accelerometer, gyroscope, light, etc.

## Core Principles

### snapshot vs screenshot — when to use each

| Goal | Tool |
|------|------|
| Read screen content / find elements | **`snapshot`** first |
| Need to interact (tap, swipe, type) | **`snapshot`** to get coordinates, then act |
| Verify result after an action | **`screenshot`** |
| Screen content not parseable by snapshot (e.g. images, video) | **`screenshot`** as fallback |

**Rules:**
- `snapshot` is always preferred for reading — it returns real device-pixel bounds and element text
- **NEVER guess coordinates from a screenshot** — screenshots may be scaled; use `snapshot` bounds
- `screenshot` is for showing results to the user, not for finding tap targets
- If `snapshot` returns no useful elements, fall back to `screenshot` to understand the screen

### Tapping elements
1. Call `snapshot` — get element list with bounds
2. The `tap` tool can match by `text`, `resourceId`, or `contentDesc` — use that when possible
3. If using raw coordinates: compute center from bounds `[left,top][right,bottom]` → `x=(left+right)/2`, `y=(top+bottom)/2`

## Standard Execution Loop

For any user task:

1. **Wake screen** — `press_key wakeup`
2. **snapshot** — read the current screen state
3. **Navigate** — `press_key home` + tap, or `shell am start` if needed
4. **snapshot** — find element coordinates before acting
5. **Act** — tap, type, swipe
6. **screenshot** — verify the result
7. **Repeat** until done

## Common Patterns

### Send an SMS
```
1. shell (via adb): am start -a android.intent.action.SENDTO -d sms:<PHONE> --es sms_body <TEXT> --ez exit_on_sent true
2. snapshot → find send button by contentDesc="发送短信"
3. tap with contentDesc="发送短信"  ← tap tool supports this directly
```

### Open an app
```
tap with text="<app name>"   ← if visible on home screen
-- or --
press_key home, then tap the app icon
```

### Scroll
```
swipe with direction="up"   ← scroll down (swipe up)
swipe with direction="down" ← scroll up (swipe down)
```

### Type into a field
```
1. tap the input field (by text/resourceId)
2. type_text with the text to enter
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Screen is black / screenshot all dark | `press_key wakeup` first |
| Tap has no effect | Use `snapshot` → tap by `text` or `contentDesc` instead of coordinates |
| Element not found by text | Try `snapshot` to see all visible elements and their exact text |
