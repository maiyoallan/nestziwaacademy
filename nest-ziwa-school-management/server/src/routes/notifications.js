import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';

const router = Router();
const roles = ['SYSTEM_ADMIN','HEADTEACHER','BURSAR','EXAM_OFFICER','TEACHER','ADMISSIONS','STOREKEEPER','TRANSPORT_MANAGER','DIRECTOR'];

router.get('/', async (req, res) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'Access denied.' });
  const notifications = await prisma.notification.findMany({ where: { OR: [{ targetRole: 'ALL' }, { targetRole: req.user.role }], ...(req.query.resolved === 'true' ? {} : { resolvedAt: null }) }, orderBy: { createdAt: 'desc' }, take: 200 });
  res.json({ notifications });
});

router.post('/', async (req, res) => {
  if (!['SYSTEM_ADMIN','HEADTEACHER','BURSAR','DIRECTOR'].includes(req.user.role)) return res.status(403).json({ message: 'Access denied.' });
  const parsed = z.object({ title: z.string().trim().min(3).max(150), message: z.string().trim().min(3).max(1000), severity: z.enum(['INFO','WARNING','HIGH']).default('INFO'), targetRole: z.enum(['ALL','BURSAR','HEADTEACHER','DIRECTOR','EXAM_OFFICER']).default('ALL'), entity: z.string().max(100).optional(), entityId: z.string().max(120).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Enter an alert title and message.' });
  const notification = await prisma.$transaction(async (tx) => {
    const saved = await tx.notification.create({ data: parsed.data });
    await tx.auditLog.create({ data: { userId: req.user.id, action: 'CREATE_NOTIFICATION', entity: 'Notification', entityId: saved.id } });
    return saved;
  });
  res.status(201).json({ notification });
});

router.patch('/:id/resolve', async (req, res) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'Access denied.' });
  const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!notification) return res.status(404).json({ message: 'Alert not found.' });
  if (notification.targetRole !== 'ALL' && notification.targetRole !== req.user.role && !['DIRECTOR','SYSTEM_ADMIN'].includes(req.user.role)) return res.status(403).json({ message: 'This alert is assigned to another role.' });
  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.notification.update({ where: { id: notification.id }, data: { resolvedAt: new Date() } });
    await tx.auditLog.create({ data: { userId: req.user.id, action: 'RESOLVE_NOTIFICATION', entity: 'Notification', entityId: notification.id } });
    return saved;
  });
  res.json({ notification: updated });
});

export default router;
