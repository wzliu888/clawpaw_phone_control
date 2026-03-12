import 'dotenv/config';
import http from 'http';
import path from 'path';
import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth.route';
import secretRouter from './routes/secret.route';
import mobileRouter from './routes/mobile.route';
import sshRouter from './routes/ssh.route';
import adbRouter from './routes/adb.route';
import { vipRouter, vipRawRouter } from './routes/vip.route';
import { initWsServer } from './ws/wsServer';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());

// Stripe webhook needs raw body — register BEFORE express.json()
app.use('/api/vip', vipRawRouter);

app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/secret', secretRouter);
app.use('/api/mobile', mobileRouter);
app.use('/api/ssh', sshRouter);
app.use('/api/adb', adbRouter);
app.use('/api/vip', vipRouter);

// Serve frontend static files (built by Dockerfile)
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
// SPA fallback — any non-API route serves index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Attach WebSocket server to the same HTTP server
const httpServer = http.createServer(app);
initWsServer(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
  console.log(`WebSocket ready at ws://localhost:${PORT}/ws?uid=<uid>`);
});
