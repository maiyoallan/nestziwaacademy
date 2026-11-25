import { Router } from 'express';
import nodemailer from 'nodemailer';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { prisma } from '../db.js';

const router = Router();
const sendSchema = z.object({
  recipients: z.array(z.string().email()).min(1).max(100),
  subject: z.string().trim().min(3).max(180),
  html: z.string().min(1).max(4000000)
});
const draftSchema = z.object({ id: z.string().optional(), subject: z.string().trim().min(3).max(180), html: z.string().min(1).max(4000000) });
const newsletterRoles = ['SYSTEM_ADMIN','HEADTEACHER','TEACHER','EXAM_OFFICER'];
function cleanNewsletterHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: ['main','article','h1','h2','h3','p','div','span','br','hr','b','strong','i','em','u','ul','ol','li','table','tbody','tr','td','th','img','a'],
    allowedAttributes: { '*': ['style','class'], a: ['href','target','rel'], img: ['src','alt','width','height','style'] },
    allowedSchemes: ['http','https','mailto','data'],
    allowedStyles: { '*': { color: [/^#[0-9a-fA-F]{3,8}$/], 'background-color': [/^#[0-9a-fA-F]{3,8}$/], 'text-align': [/^(left|center|right)$/], 'font-size': [/^\d+(px|pt|em|%)$/], 'font-weight': [/^(normal|bold|[1-9]00)$/], 'font-style': [/^(normal|italic)$/], 'text-decoration': [/^(none|underline)$/], 'max-width': [/^\d+(px|%)$/], width: [/^\d+(px|%)$/], position: [/^(absolute|relative)$/], left: [/^\d+(px|%)$/], top: [/^\d+(px|%)$/], height: [/^\d+(px|%)$/], 'object-fit': [/^(contain|cover)$/] } }
  });
}

router.get('/drafts', async (req, res) => {
  if (!newsletterRoles.includes(req.user.role)) return res.status(403).json({ message: 'Access denied.' });
  const rows = await prisma.moduleRecord.findMany({ where: { module: 'communications' }, orderBy: { updatedAt: 'desc' }, take: 100 });
  res.json({ drafts: rows.filter((row) => row.data?.['Newsletter HTML']).map((row) => ({ id: row.id, subject: row.data.Title || row.title, html: row.data['Newsletter HTML'], updatedAt: row.updatedAt })) });
});

router.post('/drafts', async (req, res) => {
  if (!newsletterRoles.includes(req.user.role)) return res.status(403).json({ message: 'Access denied.' });
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'A newsletter subject and content are required.' });
  const html = cleanNewsletterHtml(parsed.data.html);
  const data = { Title: parsed.data.subject, Message: sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }), Audience: 'CUSTOM', 'Newsletter HTML': html, Status: 'DRAFT' };
  if (parsed.data.id) {
    const existing = await prisma.moduleRecord.findFirst({ where: { id: parsed.data.id, module: 'communications' } });
    if (!existing?.data?.['Newsletter HTML']) return res.status(404).json({ message: 'Newsletter draft not found.' });
    const draft = await prisma.moduleRecord.update({ where: { id: existing.id }, data: { title: `NEWSLETTER: ${parsed.data.subject}`, data } });
    await prisma.auditLog.create({ data: { userId: req.user.id, action: 'UPDATE', entity: 'Newsletter', entityId: draft.id } });
    return res.json({ draft: { id: draft.id, subject: parsed.data.subject, html: draft.data['Newsletter HTML'], updatedAt: draft.updatedAt } });
  }
  const draft = await prisma.moduleRecord.create({ data: { module: 'communications', title: `NEWSLETTER: ${parsed.data.subject}`, data, createdById: req.user.id } });
  await prisma.auditLog.create({ data: { userId: req.user.id, action: 'CREATE', entity: 'Newsletter', entityId: draft.id } });
  res.status(201).json({ draft: { id: draft.id, subject: parsed.data.subject, html: draft.data['Newsletter HTML'], updatedAt: draft.updatedAt } });
});

router.post('/send', async (req, res) => {
  if (!newsletterRoles.includes(req.user.role)) return res.status(403).json({ message: 'You do not have permission to send school newsletters.' });
  if (!process.env.SMTP_URL || !process.env.MAIL_FROM) return res.status(503).json({ message: 'Newsletter email is not configured. Set SMTP_URL and MAIL_FROM in the API environment first.' });
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Enter a subject, valid recipient email addresses, and newsletter content.' });
  const html = cleanNewsletterHtml(parsed.data.html);
  try {
    const transporter = nodemailer.createTransport(process.env.SMTP_URL);
    await transporter.sendMail({ from: process.env.MAIL_FROM, to: process.env.MAIL_FROM, bcc: parsed.data.recipients, subject: parsed.data.subject, html });
    await prisma.auditLog.create({ data: { userId: req.user.id, action: 'SEND_NEWSLETTER', entity: 'Newsletter', details: { recipientCount: parsed.data.recipients.length, subject: parsed.data.subject } } });
    res.json({ sent: true, recipientCount: parsed.data.recipients.length });
  } catch (error) {
    console.error('Newsletter delivery failed:', error.message);
    res.status(502).json({ message: 'The mail provider could not send this newsletter. Check the SMTP settings and try again.' });
  }
});

export default router;
