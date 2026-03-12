<p align="center">
  < img src="logo.png" width="160" alt="ClawPaw logo" />
</p >

<h1 align="center">ClawPaw</h1>

<p align="center">
  <strong>Give AI hands to control your phone.</strong><br/>
  The MCP server that gives OpenClaw — or any AI agent — real control over your Android phone.
</p >

<p align="center">
  <a href=" ">Website</a > &nbsp;·&nbsp;
  <a href="https://dl.clawpaw.me/clawpaw-latest.apk">Download APK</a > &nbsp;·&nbsp;
  <a href="#quick-start">Quick Start</a > &nbsp;·&nbsp;
  <a href="mailto:ericshen.18888@gmail.com">Contact</a >
</p >

<br/>

## What can it do?

Tell your AI assistant what you want. It does the rest on your phone.

> *"Read my WhatsApp messages and reply to Sarah"*
>
> *"Post this photo to Instagram with a caption"*
>
> *"How much is an Uber to the airport right now?"*
>
> *"I can't find my phone — make it ring and flash"*

ClawPaw connects any MCP-compatible LLM to your Android phone — screenshot, tap, swipe, type, launch apps, control hardware, read sensors, take photos, and more. **20+ tools**, all through natural conversation.

### Use cases

These are **ready-made [OpenClaw](https://github.com/openclaw/openclaw) skills** included in the repo — see [`clawpaw_usecase_example/`](clawpaw_usecase_example/).

| Scenario | What happens |
|----------|-------------|
| **Morning briefing** | AI reads your overnight notifications, checks the weather, and gives you a personalized summary |
| **WhatsApp on autopilot** | AI reads unread messages across all chats and drafts replies for you |
| **Instagram posting** | Tell AI what to post — it opens the app, selects the photo, writes a caption, and hits share |
| **Uber price check** | AI opens Uber, checks ride options to your destination, and compares prices |
| **Find my phone** | Lost your phone? AI triggers max volume ring, flashlight, and vibration |
| **Location check-in** | AI takes a photo, grabs your GPS, gets the weather, and creates a check-in post |
| **Notification digest** | AI collects all your recent notifications and gives you a clean summary by app |
| **Food nearby** | Ask "I'm hungry" — AI gets your location, checks the time, and recommends restaurants |
| **Overwork reminder** | AI notices you're still at the office late and sends a caring nudge to go home |

---

## How it works

```
You  →  OpenClaw / AI Agent  →  MCP Server  →  ClawPaw Backend  →  Your Phone
                                                       ↕
                                                WebSocket + SSH Tunnel
```

The Android app stays connected in the background. When your AI calls a tool like `tap` or `screenshot`, the command travels through the MCP server to your phone and executes instantly.

---

## Quick Start

**1. Install** — Download the [APK](https://dl.clawpaw.me/clawpaw-latest.apk) and install on your Android phone.

**2. Connect** — Open ClawPaw, tap **Connect**. Wait for the green dots. Copy your **UID** and **Secret**.

**3. Configure** — Build the MCP server and add it to your AI client:

```bash
git clone https://github.com/wzliu888/clawpaw_phone_control && cd clawpaw_phone_control/mcp
npm install && npm run build
```

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "clawpaw": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/mcp/dist/index.js"],
      "env": {
        "CLAWPAW_BACKEND_URL": "https://www.clawpaw.me",
        "CLAWPAW_UID": "<your UID>",
        "CLAWPAW_SECRET": "<your Secret>"
      }
    }
  }
}
```

**4. Go** — Restart Claude Code. Ask it anything about your phone.

> Using **Claude Code**? Run `/clawpaw-setup` for an interactive guided setup.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| SSH shows "Disconnected" | Battery settings → ClawPaw → No restrictions. Lock the app in recents. |
| Screenshot is black | Phone screen is off. Send `press_key("wakeup")` first. |
| App won't connect | Tap **Retry**, or check your internet connection. |
| Emoji/Unicode not typing | Install [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) and set it active. |

---

## Build from source

<details>
<summary><strong>Android App</strong></summary>

```bash
cd android
cp local.properties.example local.properties
# Edit: sdk.dir=..., WS_URL=wss://www.clawpaw.me

./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

</details>

<details>
<summary><strong>Backend (self-hosted)</strong></summary>

```bash
cd web/backend
cp .env.example .env   # fill in DB credentials
npm install && npm run build
npm start
```

</details>

---

## License

MIT

---

<p align="center">
  <strong>Give your AI a pair of claws.</strong><br/>
  <a href="https://www.clawpaw.me">www.clawpaw.me</a >
</p >