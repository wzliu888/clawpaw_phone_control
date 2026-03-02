import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { Server } from 'http';
import { URL } from 'url';

const PING_INTERVAL_MS  = 60_000;  // send ping every 60s
const PING_MAX_MISSED   = 2;        // terminate after 2 consecutive missed pongs (~2min tolerance)
const RPC_TIMEOUT_MS    = 120_000;
const ts = () => new Date().toISOString().slice(11, 19); // HH:MM:SS

// uid -> connected phone WebSocket
const sessions = new Map<string, WebSocket>();

// Pending JSON-RPC calls: rpcId -> { resolve, reject, timer }
let rpcIdCounter = 0;
const pending = new Map<string, {
  resolve: (v: any) => void;
  reject:  (e: Error) => void;
  timer:   ReturnType<typeof setTimeout>;
}>();

export function initWsServer(httpServer: Server): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const uid = getUidFromRequest(req);

    if (!uid) {
      ws.close(4001, 'Missing uid');
      return;
    }

    // Replace any existing session for this uid
    sessions.get(uid)?.close(4002, 'Replaced by new connection');
    sessions.set(uid, ws);
    console.log(`[WS] uid=${uid} connected (total=${sessions.size})`);

    // Server-side ping/pong to detect dead connections
    let missedPongs = 0;
    const pingTimer = setInterval(() => {
      if (missedPongs >= PING_MAX_MISSED) {
        console.warn(`[WS] uid=${uid} missed ${missedPongs} pongs — terminating`);
        ws.terminate();
        return;
      }
      missedPongs++;
      console.log(`[WS] ping → uid=${uid} t=${ts()} (missed=${missedPongs})`);
      ws.ping();
    }, PING_INTERVAL_MS);

    ws.on('pong', () => {
      missedPongs = 0;
      console.log(`[WS] pong ← uid=${uid} t=${ts()}`);
    });

    ws.on('message', (data: Buffer) => {
      // Handle JSON-RPC responses from phone
      try {
        const msg = JSON.parse(data.toString()) as { id?: string; type?: string; result?: any; error?: { message?: string } };
        // Silently discard app-level keepalive pings from phone
        if (msg.type === 'ping') return;
        if (msg.id && pending.has(msg.id)) {
          const p = pending.get(msg.id)!;
          clearTimeout(p.timer);
          pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(msg.error.message ?? 'Phone returned error'));
          } else {
            p.resolve(msg.result);
          }
          return;
        }
      } catch { /* not JSON or not a response */ }

      console.log(`[WS] uid=${uid} message: ${data.toString()}`);
    });

    ws.on('close', () => {
      clearInterval(pingTimer);
      if (sessions.get(uid) === ws) sessions.delete(uid);
      console.log(`[WS] uid=${uid} disconnected (total=${sessions.size})`);
    });

    ws.on('error', (err) => {
      console.error(`[WS] uid=${uid} error:`, err.message);
    });
  });
}

/**
 * Forward a JSON-RPC call to the phone identified by uid.
 * Returns { success, data } or { success: false, error }.
 */
export async function forwardRpc(
  uid: string,
  method: string,
  params: Record<string, any> = {},
): Promise<{ success: boolean; data?: any; error?: string }> {
  const ws = sessions.get(uid);

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { success: false, error: 'Phone not connected' };
  }

  const id = `rpc-${++rpcIdCounter}`;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ success: false, error: `Timeout waiting for phone response (${RPC_TIMEOUT_MS}ms)` });
    }, RPC_TIMEOUT_MS);

    pending.set(id, {
      resolve: (data) => resolve({ success: true, data }),
      reject:  (err)  => resolve({ success: false, error: err.message }),
      timer,
    });

    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    console.log(`[RPC] → uid=${uid} method=${method} id=${id}`);
  });
}

function getUidFromRequest(req: IncomingMessage): string | null {
  try {
    const url = new URL(req.url ?? '', 'http://localhost');
    return url.searchParams.get('uid')?.trim() || null;
  } catch {
    return null;
  }
}
