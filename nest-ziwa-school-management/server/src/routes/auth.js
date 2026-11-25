import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate } from '../middleware/auth.js';
const router = Router();
router.post('/login', async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(8) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Enter a valid email and password.' });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !user.isActive || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ message: 'Incorrect email or password.' });
  }
  const token = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
  await prisma.auditLog.create({ data: { userId: user.id, action: 'LOGIN', entity: 'User', entityId: user.id, ipAddress: req.ip } });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword } });
});
router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));
router.post('/logout', authenticate, async (req,res) => { await prisma.auditLog.create({data:{userId:req.user.id,action:'LOGOUT',entity:'User',entityId:req.user.id,ipAddress:req.ip}});res.json({loggedOut:true}); });
router.post('/change-password', authenticate, async (req, res) => {
  const parsed = z.object({ currentPassword: z.string().min(8), newPassword: z.string().min(8).max(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Enter your current password and a new password of at least 8 characters.' });
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) return res.status(401).json({ message: 'Current password is incorrect.' });
  if (parsed.data.currentPassword === parsed.data.newPassword) return res.status(400).json({ message: 'Choose a new password that is different from your current one.' });
  const updated = await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12), mustChangePassword: false } });
  await prisma.auditLog.create({ data: { userId: user.id, action: 'CHANGE_PASSWORD', entity: 'User', entityId: user.id } });
  res.json({ user: { id: updated.id, name: updated.name, email: updated.email, role: updated.role, mustChangePassword: false } });
});
export default router;
