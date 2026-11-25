import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';

const router = Router();
const staffRoles = ['SYSTEM_ADMIN','HEADTEACHER','EXAM_OFFICER','DIRECTOR','BURSAR','TEACHER','ADMISSIONS','STOREKEEPER','TRANSPORT_MANAGER','DRIVER'];

router.get('/teachers', async (req, res) => {
  if (!['SYSTEM_ADMIN','HEADTEACHER','EXAM_OFFICER','TEACHER'].includes(req.user.role)) return res.status(403).json({ message: 'Access denied.' });
  const teachers = await prisma.user.findMany({ where: { role: 'TEACHER', isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 300 });
  res.json({ teachers });
});

router.get('/', async (req, res) => {
  if (req.user.role !== 'SYSTEM_ADMIN') return res.status(403).json({ message: 'Only a system administrator can manage staff logins.' });
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, name: true, email: true, role: true, isActive: true, mustChangePassword: true, createdAt: true } });
  res.json({ users });
});

router.post('/', async (req, res) => {
  if (req.user.role !== 'SYSTEM_ADMIN') return res.status(403).json({ message: 'Only a system administrator can create staff logins.' });
  const parsed = z.object({ name: z.string().trim().min(2).max(120), email: z.string().email().transform((value) => value.trim().toLowerCase()), role: z.enum(staffRoles) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Enter a name, valid email, and staff role.' });
  if (await prisma.user.findUnique({ where: { email: parsed.data.email } })) return res.status(409).json({ message: 'An account already uses that email address.' });
  const temporaryPassword = randomBytes(12).toString('base64url');
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { ...parsed.data, name: parsed.data.name.toUpperCase(), passwordHash: await bcrypt.hash(temporaryPassword, 12), mustChangePassword: true } });
    await tx.auditLog.create({ data: { userId: req.user.id, action: 'CREATE_USER', entity: 'User', entityId: created.id } });
    return created;
  });
  res.status(201).json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, mustChangePassword: true }, temporaryPassword });
});

export default router;
