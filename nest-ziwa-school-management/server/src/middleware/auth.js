import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
export async function authenticate(req, res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ message: 'Authentication required.' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) return res.status(401).json({ message: 'Account unavailable.' });
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword };
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired session.' });
  }
}
export const allowRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ message: 'You do not have permission to perform this action.' });
  next();
};
