import { Router, Request, Response } from 'express';
import { AuthService } from '../services/auth.service';

// Presentation / routing layer — auth endpoints
const router = Router();
const authService = new AuthService();

// POST /api/auth/anonymous
// Body: {} (no deviceId needed — each install gets a fresh uid)
router.post('/anonymous', async (req: Request, res: Response) => {
  try {
    const { user, secret } = await authService.loginAnonymous();
    res.json({ uid: user.uid, secret, login_type: user.login_type, created_at: user.created_at });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[auth] Anonymous login failed:', message);
    res.status(500).json({ error: 'Anonymous login failed', detail: message });
  }
});

export default router;
