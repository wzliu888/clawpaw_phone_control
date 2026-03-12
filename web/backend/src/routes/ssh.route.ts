import { Router, Request, Response } from 'express';
import { SshProvisionService } from '../services/ssh_provision.service';
import { SecretRepository } from '../repositories/secret.repository';
import { VipRepository } from '../repositories/vip.repository';

const router = Router();
const provisionService = new SshProvisionService();
const secretRepo = new SecretRepository();
const vipRepo = new VipRepository();

function isVipValid(vip: Awaited<ReturnType<VipRepository['findByUid']>>): boolean {
  if (!vip) return false;
  const now = new Date();
  if (vip.status === 'trial' && vip.trial_ends_at && vip.trial_ends_at > now) return true;
  if (vip.status === 'active' && vip.current_period_end && vip.current_period_end > now) return true;
  return false;
}

// POST /api/ssh/provision
// Header: x-clawpaw-secret: <secret>
// Body:   { uid }
// Returns: { username, password, adbPort }  — Linux SSH credentials + assigned ADB port
router.post('/provision', async (req: Request, res: Response) => {
  const secret = req.headers['x-clawpaw-secret'] as string | undefined;
  const { uid } = req.body as { uid?: string };

  if (!uid || !secret) {
    res.status(400).json({ error: 'uid and x-clawpaw-secret required' });
    return;
  }

  // Validate secret
  const stored = await secretRepo.findByUid(uid);
  if (!stored || stored.secret !== secret) {
    res.status(401).json({ error: 'Invalid secret' });
    return;
  }

  // Validate VIP — trial (within period) or active (within period) required
  const vip = await vipRepo.findByUid(uid);
  if (!isVipValid(vip)) {
    res.status(403).json({ error: 'vip_required' });
    return;
  }

  try {
    const creds = await provisionService.provision(uid);
    res.json({ username: creds.username, password: creds.password, adbPort: creds.adbPort });
  } catch (e: any) {
    console.error('[ssh/provision]', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
