import { Router, Request, Response } from 'express';
import { VipService } from '../services/vip.service';

// Webhook route needs raw body — must be registered BEFORE express.json() middleware.
// We export a separate rawRouter for /api/vip/webhook and a jsonRouter for the rest.
export const vipRawRouter = Router();
export const vipRouter = Router();

const vipService = new VipService();

// POST /api/vip/webhook  — raw body required for Stripe signature verification
vipRawRouter.post(
  '/webhook',
  (req: Request, res: Response, next) => {
    // Collect raw body into Buffer
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      (req as any).rawBody = Buffer.concat(chunks);
      next();
    });
  },
  async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'] as string;
    try {
      await vipService.handleWebhook((req as any).rawBody, sig);
      res.json({ received: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[vip] Webhook error:', msg);
      res.status(400).json({ error: msg });
    }
  }
);

// GET /api/vip/status?uid=<uid>
vipRouter.get('/status', async (req: Request, res: Response) => {
  const uid = req.query.uid as string;
  if (!uid) { res.status(400).json({ error: 'uid required' }); return; }
  try {
    const status = await vipService.getStatus(uid);
    res.json(status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[vip] Status error:', msg);
    res.status(500).json({ error: msg });
  }
});

// POST /api/vip/checkout
// Body: { uid: string, return_url: string }
vipRouter.post('/checkout', async (req: Request, res: Response) => {
  const { uid, return_url } = req.body as { uid: string; return_url: string };
  if (!uid || !return_url) { res.status(400).json({ error: 'uid and return_url required' }); return; }
  try {
    const url = await vipService.createCheckoutSession(uid, return_url);
    res.json({ url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[vip] Checkout error:', msg);
    res.status(500).json({ error: msg });
  }
});
