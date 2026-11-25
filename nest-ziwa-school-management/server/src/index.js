import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
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
const configuredOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(x => x.trim()).filter(Boolean);
function isLocalDevelopmentOrigin(origin) {
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const url = new URL(origin);
    const localHost = ['localhost','127.0.0.1','::1'].includes(url.hostname) || /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(url.hostname);
    return url.protocol === 'http:' && localHost && /^51(7[0-9]|8[0-9])$/.test(url.port);
  } catch { return false; }
}
app.use(cors({ origin: (origin, callback) => {
  if (!origin || configuredOrigins.includes(origin) || isLocalDevelopmentOrigin(origin)) return callback(null, true);
  return callback(new Error('This website origin is not allowed by the API CORS configuration.'));
}, credentials: false }));
app.use((req, _res, next) => { req.requestId = randomUUID(); next(); });
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
function wrapAsyncRoutes(router) {
  for (const layer of router.stack || []) {
    if (layer.route) {
      for (const routeLayer of layer.route.stack || []) {
        const handler = routeLayer.handle;
        if (handler?.constructor?.name === 'AsyncFunction' && !handler.__handlesRejectedPromise) {
          const wrapped = (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
          wrapped.__handlesRejectedPromise = true;
          routeLayer.handle = wrapped;
        }
      }
    } else if (layer.handle?.stack) wrapAsyncRoutes(layer.handle);
  }
  return router;
}
const routeModules = [bankWebhookRoutes,authRoutes,recordRoutes,assetRoutes,newsletterRoutes,reportCardRoutes,accountingRoutes,paymentRoutes,paymentGatewayRoutes,studentHubRoutes,transportRoutes,salaryRunRoutes,notificationRoutes,directorRoutes,assistantRoutes,userRoutes];
routeModules.forEach(wrapAsyncRoutes);
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
app.use((err, req, res, next) => {
  console.error(JSON.stringify({ level: 'error', event: 'request_failed', requestId: req.requestId || null, method: req.method, path: req.path, status: err.status || 500, code: err.code || null, message: err.message || 'Unknown error' }));
  if (res.headersSent) return next(err);
  const status = Number(err.status) >= 400 && Number(err.status) < 600 ? Number(err.status) : 500;
  res.status(status).json({ message: status >= 500 ? 'The request could not be completed. Please retry; support can use the request ID to find technical details.' : err.message || 'The request was not accepted.', requestId: req.requestId || null });
});
const port = Number(process.env.PORT || 5000);
app.listen(port, () => console.log(`Nest Ziwa API listening on port ${port}`));
process.on('SIGINT', async () => { await prisma.$disconnect(); process.exit(0); });
process.on('SIGTERM', async () => { await prisma.$disconnect(); process.exit(0); });
