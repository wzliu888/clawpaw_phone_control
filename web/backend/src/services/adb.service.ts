import { execFile } from 'child_process';
import { promisify } from 'util';
import { SshCredentialRepository, activePort } from '../repositories/ssh_credential.repository';

const execFileAsync = promisify(execFile);

const repo = new SshCredentialRepository();

// adb device target: SSH_HOST_IP:<adbPort>
// SSH_HOST_IP defaults to 127.0.0.1 but must be set to the internal IP of the
// node running sshd when the backend pod runs on a different node.
const SSH_HOST_IP = process.env.SSH_HOST_IP ?? '127.0.0.1';

async function deviceTarget(uid: string): Promise<string> {
  const cred = await repo.findByUid(uid);
  if (!cred) throw new Error(`No SSH credentials for uid=${uid}`);
  return `${SSH_HOST_IP}:${activePort(cred)}`;
}

async function reconnect(uid: string, target: string): Promise<void> {
  console.log(`[adb] reconnecting target=${target}`);
  try {
    const { stdout: dcOut } = await execFileAsync('adb', ['disconnect', target], { timeout: 60_000 });
    console.log(`[adb] disconnect → ${dcOut.trim()}`);
  } catch (e: any) {
    console.warn(`[adb] disconnect failed: ${e.message}`);
  }
  try {
    const { stdout: connOut } = await execFileAsync('adb', ['connect', target], { timeout: 60_000 });
    const out = connOut.trim();
    console.log(`[adb] connect → ${out}`);
    // If adb connect succeeded, we're done
    if (!out.includes('failed') && !out.includes('offline')) return;
  } catch (e: any) {
    console.warn(`[adb] connect failed: ${e.stderr?.trim() || e.message} — asking phone to rebuild SSH tunnel`);
  }

  // SSH tunnel is down — the phone's heartbeat will detect this and reconnect automatically.
  // Do NOT push reconnect_ssh here: it races with the heartbeat and causes concurrent connects
  // that fight over the same port ("remote port forwarding failed").
  console.log(`[adb] SSH tunnel appears down for uid=${uid} — phone heartbeat will reconnect`);
}

async function adb(uid: string, ...args: string[]): Promise<string> {
  const target = await deviceTarget(uid);
  const cmd = `adb -s ${target} ${args.join(' ')}`;
  const t0 = Date.now();

  const run = () => execFileAsync('adb', ['-s', target, ...args], { timeout: 60_000 });

  try {
    const { stdout, stderr } = await run();
    console.log(`[adb] ${cmd} → ok (${Date.now() - t0}ms)`);
    if (stderr.trim()) console.warn(`[adb] stderr: ${stderr.trim()}`);
    return (stdout + stderr).trim();
  } catch (e: any) {
    const elapsed = Date.now() - t0;
    const stdout = (e.stdout ?? '').trim();
    const stderr = (e.stderr ?? '').trim();
    const detail = [stdout, stderr].filter(Boolean).join('\n');
    console.warn(`[adb] ${cmd} → failed (${elapsed}ms) code=${e.code} signal=${e.signal}${detail ? '\n' + detail : ''} — reconnecting`);

    // Reconnect and retry once
    await reconnect(uid, target);
    try {
      const { stdout: s2, stderr: e2 } = await run();
      console.log(`[adb] ${cmd} → ok after reconnect (${Date.now() - t0}ms)`);
      if (e2.trim()) console.warn(`[adb] stderr: ${e2.trim()}`);
      return (s2 + e2).trim();
    } catch (e2: any) {
      const s = (e2.stdout ?? '').trim();
      const se = (e2.stderr ?? '').trim();
      const d2 = [s, se].filter(Boolean).join('\n');
      console.error(`[adb] ${cmd} → FAILED after reconnect (${Date.now() - t0}ms) code=${e2.code} signal=${e2.signal}`);
      if (d2) console.error(`[adb] output: ${d2}`);
      throw new Error(`Command failed: adb -s ${target} ${args.join(' ')}\n${d2 || '(no output)'}`);
    }
  }
}

export async function snapshot(uid: string): Promise<string> {
  console.log(`[tool/snapshot] start uid=${uid}`);
  const stripAttrs = [
    'index', 'package', 'checkable', 'checked', 'focusable', 'focused',
    'selected', 'long-clickable', 'password', 'instance',
  ].map(a => `s/ ${a}="[^"]*"//g`).join(';');
  const result = await adb(uid, 'shell', `uiautomator dump /sdcard/ui.xml && sed '${stripAttrs}' /sdcard/ui.xml`);
  console.log(`[tool/snapshot] done uid=${uid} bytes=${result.length}`);
  return result;
}

export async function tap(uid: string, x: number, y: number): Promise<string> {
  console.log(`[tool/tap] start uid=${uid} x=${x} y=${y}`);
  const result = await adb(uid, 'shell', 'input', 'tap', String(x), String(y));
  console.log(`[tool/tap] done uid=${uid}`);
  return result;
}

export async function longPress(uid: string, x: number, y: number, duration = 1000): Promise<string> {
  console.log(`[tool/longPress] start uid=${uid} x=${x} y=${y} duration=${duration}`);
  const result = await adb(uid, 'shell', 'input', 'swipe', String(x), String(y), String(x), String(y), String(duration));
  console.log(`[tool/longPress] done uid=${uid}`);
  return result;
}

export async function swipe(
  uid: string,
  x1: number, y1: number,
  x2: number, y2: number,
  duration = 300,
): Promise<string> {
  console.log(`[tool/swipe] start uid=${uid} from=(${x1},${y1}) to=(${x2},${y2}) duration=${duration}`);
  const result = await adb(uid, 'shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(duration));
  console.log(`[tool/swipe] done uid=${uid}`);
  return result;
}

export async function typeText(uid: string, text: string): Promise<{ typed: string; method: string }> {
  console.log(`[tool/typeText] start uid=${uid} len=${text.length}`);
  const hasNonAscii = /[^\x00-\x7F]/.test(text);
  let result: { typed: string; method: string };
  if (hasNonAscii) {
    // Chinese / emoji — requires ADBKeyboard app on device
    const escaped = text.replace(/'/g, "'\\''");
    await adb(uid, 'shell', 'am', 'broadcast', '-a', 'ADB_INPUT_TEXT', '--es', 'msg', escaped);
    result = { typed: text, method: 'adbkeyboard' };
  } else {
    // ASCII — escape shell-special chars and spaces
    const escaped = text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`')
      .replace(/ /g, '%s');
    await adb(uid, 'shell', 'input', 'text', escaped);
    result = { typed: text, method: 'input' };
  }
  console.log(`[tool/typeText] done uid=${uid} method=${result.method}`);
  return result;
}

export async function pressKey(uid: string, key: string): Promise<string> {
  const upper = key.toUpperCase();
  const keycode = upper.startsWith('KEYCODE_') ? upper : `KEYCODE_${upper}`;
  console.log(`[tool/pressKey] start uid=${uid} keycode=${keycode}`);
  const result = await adb(uid, 'shell', 'input', 'keyevent', keycode);
  console.log(`[tool/pressKey] done uid=${uid}`);
  return result;
}

export async function screenshot(uid: string): Promise<{ data: string; mimeType: string }> {
  const target = await deviceTarget(uid);
  console.log(`[tool/screenshot] start uid=${uid} target=${target}`);

  const run = () => execFileAsync(
    'adb', ['-s', target, 'exec-out', 'screencap', '-p'],
    { timeout: 60_000, maxBuffer: 20 * 1024 * 1024, encoding: 'buffer' } as any,
  );

  const attempt = async (label: string) => {
    const { stdout } = await run();
    const buf = stdout as unknown as Buffer;
    console.log(`[tool/screenshot] done uid=${uid}${label} bytes=${buf.length}`);
    return { data: buf.toString('base64'), mimeType: 'image/png' };
  };

  try {
    return await attempt('');
  } catch (e: any) {
    console.warn(`[tool/screenshot] failed code=${e.code} signal=${e.signal} — reconnecting`);
    await reconnect(uid, target);
    try {
      return await attempt(' (after reconnect)');
    } catch (e2: any) {
      console.error(`[tool/screenshot] FAILED after reconnect: code=${e2.code} signal=${e2.signal}`);
      throw new Error(`screenshot failed: ${String(e2.stderr ?? e2.stdout ?? e2.message ?? e2).slice(0, 500)}`);
    }
  }
}

export async function shell(uid: string, command: string): Promise<string> {
  console.log(`[tool/shell] start uid=${uid} command=${command}`);
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const result = await adb(uid, 'shell', ...parts);
  console.log(`[tool/shell] done uid=${uid}`);
  return result;
}

export async function launchApp(uid: string, pkg: string): Promise<string> {
  console.log(`[tool/launchApp] start uid=${uid} pkg=${pkg}`);
  const result = await adb(uid, 'shell', 'am', 'start', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-p', pkg);
  console.log(`[tool/launchApp] done uid=${uid}`);
  return result;
}

export async function listApps(uid: string): Promise<Array<{ packageName: string; label: string }>> {
  console.log(`[tool/listApps] start uid=${uid}`);
  const raw = await adb(uid, 'shell', 'pm', 'list', 'packages', '-3');
  const apps = raw
    .split('\n')
    .map(l => l.replace(/^package:/, '').trim())
    .filter(Boolean)
    .sort()
    .map(pkg => ({ packageName: pkg, label: pkg }));
  console.log(`[tool/listApps] done uid=${uid} count=${apps.length}`);
  return apps;
}

export async function getScreenSize(uid: string): Promise<{ width: number; height: number }> {
  console.log(`[tool/getScreenSize] start uid=${uid}`);
  const out = await adb(uid, 'shell', 'wm', 'size');
  const m = out.match(/(\d+)x(\d+)/);
  if (!m) throw new Error(`Cannot parse screen size: ${out}`);
  const size = { width: parseInt(m[1]), height: parseInt(m[2]) };
  console.log(`[tool/getScreenSize] done uid=${uid} size=${size.width}x${size.height}`);
  return size;
}

export async function mediaControl(uid: string, action: string): Promise<string> {
  const keyMap: Record<string, string> = {
    play:     'KEYCODE_MEDIA_PLAY',
    pause:    'KEYCODE_MEDIA_PAUSE',
    toggle:   'KEYCODE_MEDIA_PLAY_PAUSE',
    next:     'KEYCODE_MEDIA_NEXT',
    previous: 'KEYCODE_MEDIA_PREVIOUS',
    stop:     'KEYCODE_MEDIA_STOP',
  };
  const keycode = keyMap[action];
  if (!keycode) throw new Error(`Unknown media action: ${action}. Use: play, pause, toggle, next, previous, stop`);
  console.log(`[tool/mediaControl] start uid=${uid} action=${action}`);
  const result = await adb(uid, 'shell', 'input', 'keyevent', keycode);
  console.log(`[tool/mediaControl] done uid=${uid}`);
  return result;
}

export async function connect(uid: string): Promise<string> {
  const target = await deviceTarget(uid);
  console.log(`[tool/connect] start uid=${uid} target=${target}`);
  const { stdout, stderr } = await execFileAsync('adb', ['connect', target], { timeout: 60_000 });
  const result = (stdout + stderr).trim();
  console.log(`[tool/connect] done uid=${uid} result=${result}`);
  return result;
}

export async function releaseTunnel(uid: string): Promise<{ newPort: number }> {
  const cred = await repo.findByUid(uid);
  if (!cred) throw new Error(`No SSH credentials for uid=${uid}`);
  const oldPort = activePort(cred);
  const target = `${SSH_HOST_IP}:${oldPort}`;
  console.log(`[tool/releaseTunnel] start uid=${uid} oldPort=${oldPort} slot=${cred.adb_port_slot}`);

  try {
    const { stdout, stderr } = await execFileAsync('adb', ['disconnect', target], { timeout: 10_000 });
    console.log(`[releaseTunnel] adb disconnect → ${(stdout + stderr).trim()}`);
  } catch (e: any) {
    console.warn(`[releaseTunnel] adb disconnect failed: ${e.message}`);
  }

  const updated = await repo.flipSlot(uid);
  const newPort = activePort(updated);
  console.log(`[tool/releaseTunnel] done uid=${uid} newPort=${newPort}`);

  return { newPort };
}

export async function openUrl(uid: string, url: string): Promise<string> {
  console.log(`[tool/openUrl] start uid=${uid} url=${url}`);
  const result = await adb(uid, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url);
  console.log(`[tool/openUrl] done uid=${uid}`);
  return result;
}

export async function sendSms(uid: string, phone: string, body: string): Promise<string> {
  console.log(`[tool/sendSms] start uid=${uid} phone=${phone}`);
  const result = await adb(uid, 'shell', 'am', 'start',
    '-a', 'android.intent.action.SENDTO',
    '-d', `sms:${phone}`,
    '--es', 'sms_body', body,
    '--ez', 'exit_on_sent', 'true',
  );
  console.log(`[tool/sendSms] done uid=${uid}`);
  return result;
}

export async function call(uid: string, phone: string): Promise<string> {
  console.log(`[tool/call] start uid=${uid} phone=${phone}`);
  const result = await adb(uid, 'shell', 'am', 'start', '-a', 'android.intent.action.CALL', '-d', `tel:${phone}`);
  console.log(`[tool/call] done uid=${uid}`);
  return result;
}

export async function screenOn(uid: string): Promise<string> {
  console.log(`[tool/screenOn] start uid=${uid}`);
  await adb(uid, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  await adb(uid, 'shell', 'input', 'keyevent', 'KEYCODE_MENU');
  console.log(`[tool/screenOn] done uid=${uid}`);
  return 'screen on';
}

export async function screenOff(uid: string): Promise<string> {
  console.log(`[tool/screenOff] start uid=${uid}`);
  const result = await adb(uid, 'shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  console.log(`[tool/screenOff] done uid=${uid}`);
  return result;
}
