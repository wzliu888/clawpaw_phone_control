# ClawPaw — Agent Guide

## Project Overview

ClawPaw is a remote phone control platform. An Android app maintains a persistent WebSocket connection to a cloud backend, enabling future MCP (Model Context Protocol) based remote control from any device.

## Repository Structure

```
clawpaw_phone_control/
├── web/
│   ├── backend/        # Node.js + Express + TypeScript
│   └── frontend/       # React + TypeScript + Vite
├── android/            # Kotlin Android app
└── mcp/                # MCP server (TypeScript)
```

## Architecture

```
[MCP Client] ──stdio──▶ [MCP Server] ──HTTP──▶ [Backend] ◀──WS── [Android App]
                                                    │
                                               [REST API]
                                                    │
                                               [MySQL DB]
```

### Backend layers (web/backend/src/)
- `routes/` — HTTP request/response (presentation)
- `services/` — business logic
- `repositories/` — DB access (mysql2)
- `ws/wsServer.ts` — WebSocket server

### Frontend layers (web/frontend/src/)
- `components/` — UI rendering
- `services/` — API calls

### Android layers (android/app/src/main/kotlin/)
- `MainActivity.kt` — anonymous registration, starts WsService
- `WsService.kt` — Foreground Service, owns WsClient, keeps WS alive in background
- `WsClient.kt` — OkHttp WebSocket, exponential backoff reconnect
- `AuthRepository.kt` — REST calls to backend

## Key Technical Decisions

- **uid**: CHAR(36) UUID generated fresh on each install — not tied to device identity
- **WS URL**: `ws://<host>/ws?uid=<uid>` — phone connects, backend tracks by uid
- **Heartbeat**: server-side ping every 5s, terminates connection on pong timeout
- **Android background**: Foreground Service (dataSync type) with persistent notification keeps WS alive when screen is off
- **Auth**: anonymous — app calls `POST /api/auth/anonymous` (no body needed), backend creates a new uid; reinstalling the app creates a new uid
- **Clawpaw Secret**: generated per-user, stored in `clawpaw_secrets` table, used for MCP auth

## Local Development

### Backend
```bash
cd web/backend
cp .env.example .env   # fill in DB credentials
npm install
npm run dev            # runs on port 3000
```

### Frontend
```bash
cd web/frontend
npm install
npm run dev
```

### Android
- Open `android/` subdirectory in Android Studio (NOT the repo root)
- `android/local.properties` must have:
  ```
  sdk.dir=/Users/<you>/Library/Android/sdk
  WS_URL=ws://10.0.2.2:3000
  ```

## Database Schema

```sql
-- users table
uid CHAR(36) PRIMARY KEY  -- UUID
login_type VARCHAR(32)    -- 'anonymous'
login_id VARCHAR(255)     -- ANDROID_ID
created_at, updated_at DATETIME

-- clawpaw_secrets table
uid CHAR(36) PRIMARY KEY
secret VARCHAR(64)        -- 'clawpaw_<48 hex chars>'
created_at, updated_at DATETIME
```

## Environment Variables

### Backend (.env)
```
PORT=3000
DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
SSH_SHARED_PASSWORD=<tunnel server password>
```

### Android (local.properties)
```
WS_URL=ws://10.0.2.2:3000
```

## Current Status

Infrastructure complete:

- [x] Anonymous device registration (web + Android)
- [x] MySQL user storage
- [x] Clawpaw secret generation
- [x] WebSocket connection with ping/pong heartbeat
- [x] Android Foreground Service (screen-off keepalive)
- [x] Auto-reconnect with exponential backoff

Next: MCP protocol + JSON-RPC command relay (phone control features)
