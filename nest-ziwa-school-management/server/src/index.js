import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { prisma } from './db.js';
import { authenticate } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import recordRoutes from './routes/records.js';
import assetRoutes from './routes/assets.js';
import newsletterRoutes from './routes/newsletters.js';
import userRoutes from './routes/users.js';
import reportCardRoutes from './routes/reportCards.js';
import accountingRoutes from './routes/accounting.js';
import notificationRoutes from './routes/notifications.js';
import directorRoutes from './routes/director.js';
import bankWebhookRoutes from './routes/bankWebhook.js';
import assistantRoutes from './routes/assistant.js';
import paymentRoutes from './routes/payments.js';
import paymentGatewayRoutes from './routes/paymentGateway.js';
import studentHubRoutes from './routes/studentHub.js';
import transportRoutes from './routes/transport.js';
import salaryRunRoutes from './routes/salaryRuns.js';
const app = express();
app.use(helmet());
app.use(cors({ origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(x => x.trim()), credentials: false }));
app.use(express.json({ limit: '6mb' }));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));
app.get('/api/health', async (_req, res) => {
  try { await prisma.$queryRaw`SELECT 1`; res.json({ status: 'ok', service: 'Nest Ziwa API', database: 'connected' }); }
  catch { res.status(503).json({ status: 'error', database: 'unavailable' }); }
});
app.get('/api/public/logo', async (_req, res) => {
  try {
    const asset = await prisma.schoolAsset.findUnique({ where: { key: 'logo' } });
    if (!asset) return res.status(404).end();
    res.type(asset.mimeType).set('Cache-Control', 'public, max-age=60').send(Buffer.from(asset.data));
  } catch { res.status(500).end(); }
});
app.get('/api/public/theme', async (_req, res) => {
  try {
    const asset = await prisma.schoolAsset.findUnique({ where: { key: 'theme' } });
    if (!asset) return res.json({ green: '#15803D', sky: '#0284C7' });
    res.set('Cache-Control', 'no-store').json(JSON.parse(Buffer.from(asset.data).toString('utf8')));
  } catch { res.status(500).json({ message: 'The school theme could not be loaded.' }); }
});
app.use('/api/webhooks/bank', bankWebhookRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/records', authenticate, recordRoutes);
app.use('/api/assets', authenticate, assetRoutes);
app.use('/api/newsletters', authenticate, newsletterRoutes);
app.use('/api/report-cards', authenticate, reportCardRoutes);
app.use('/api/accounting', authenticate, accountingRoutes);
app.use('/api/payments', authenticate, paymentRoutes);
app.use('/api/payment-gateway', paymentGatewayRoutes);
app.use('/api/student-hub', authenticate, studentHubRoutes);
app.use('/api/transport', authenticate, transportRoutes);
app.use('/api/salaries', authenticate, salaryRunRoutes);
app.use('/api/notifications', authenticate, notificationRoutes);
app.use('/api/director', authenticate, directorRoutes);
app.use('/api/assistant', authenticate, assistantRoutes);
app.use('/api/users', authenticate, userRoutes);
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: 'An unexpected server error occurred.' });
});
const port = Number(process.env.PORT || 5000);
app.listen(port, () => console.log(`Nest Ziwa API listening on port ${port}`));
process.on('SIGINT', async () => { await prisma.$disconnect(); process.exit(0); });
