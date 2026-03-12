import { Router, Request, Response } from 'express';
import { SecretRepository } from '../repositories/secret.repository';
import * as adb from '../services/adb.service';
import { forwardRpc } from '../ws/wsServer';

const router = Router();
const secretRepo = new SecretRepository();

async function validateSecret(uid: string, secret: string): Promise<boolean> {
  const stored = await secretRepo.findByUid(uid);
  return !!(stored && stored.secret === secret);
}

// POST /api/adb/:method
// Header: x-clawpaw-secret
// Body: { uid, ...params }
router.post('/:method', async (req: Request, res: Response) => {
  const { method } = req.params;
  const secret = req.headers['x-clawpaw-secret'] as string | undefined;
  const { uid, ...params } = req.body as Record<string, any>;

  if (!uid || !secret) {
    res.status(400).json({ error: 'uid and x-clawpaw-secret required' });
    return;
  }
  if (!await validateSecret(uid, secret)) {
    res.status(401).json({ error: 'Invalid secret' });
    return;
  }

  try {
    let result: any;
    switch (method) {
      case 'snapshot':    result = await adb.snapshot(uid); break;
      case 'tap':         result = await adb.tap(uid, params.x, params.y); break;
      case 'long_press':  result = await adb.longPress(uid, params.x, params.y, params.duration); break;
      case 'swipe':       result = await adb.swipe(uid, params.x1, params.y1, params.x2, params.y2, params.duration); break;
      case 'type_text':   result = await adb.typeText(uid, params.text); break;
      case 'press_key':   result = await adb.pressKey(uid, params.key); break;
      case 'screenshot': {
        // Route via WebSocket to the phone's AccessibilityService — much faster than adb exec-out.
        // Falls back to adb if the phone is not connected via WS.
        const wsResult = await forwardRpc(uid, 'screenshot', {
          maxWidth: params.maxWidth,
          quality:  params.quality,
        });
        if (wsResult.success) { result = wsResult.data; break; }
        console.warn(`[screenshot] WS failed (${wsResult.error}) — falling back to adb`);
        result = await adb.screenshot(uid);
        break;
      }
      case 'shell':       result = await adb.shell(uid, params.command); break;
      case 'launch_app':  result = await adb.launchApp(uid, params.package); break;
      case 'list_apps':   result = await adb.listApps(uid); break;
      case 'screen_size':    result = await adb.getScreenSize(uid); break;
      case 'media_control':  result = await adb.mediaControl(uid, params.action); break;
      case 'connect':     result = await adb.connect(uid); break;
      case 'open_url':    result = await adb.openUrl(uid, params.url); break;
      case 'send_sms':    result = await adb.sendSms(uid, params.phone, params.body); break;
      case 'call':        result = await adb.call(uid, params.phone); break;
      case 'screen_on':   result = await adb.screenOn(uid); break;
      case 'screen_off':      result = await adb.screenOff(uid); break;
      case 'release_tunnel':  result = await adb.releaseTunnel(uid); break;
      default:
        res.status(400).json({ error: `Unknown adb method: ${method}` });
        return;
    }
    res.json({ success: true, data: result });
  } catch (e: any) {
    console.error(`[adb/${method}]`, e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
