import { Router } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { ensureSchoolAndChart } from './accounting.js';
import { normalizeKenyanPhone, paymentRequestHash, getPaymentPromptAdapter, initiatePrompt, adapterForDriver } from '../services/paymentGatewayService.js';
import { confirmGatewayPrompt } from '../services/paymentSettlementService.js';

const router = Router();
const financeRoles = ['SYSTEM_ADMIN','HEADTEACHER','BURSAR','DIRECTOR'];
const parentRoles = ['PARENT'];
const promptRoles = [...financeRoles, ...parentRoles];
const isFinance = req => financeRoles.includes(req.user?.role);
const errorResponse = (res, error) => res.status(error.status || 500).json({ message: error.message || 'The payment gateway request could not be completed.' });

async function schoolFor(req, requested='') {
  if (req.user.role !== 'DIRECTOR') return ensureSchoolAndChart();
  const schoolId = String(requested || req.query.schoolId || req.body.schoolId || '');
  const links = await prisma.schoolLink.findMany({ where: { directorId: req.user.id }, include: { school: true } });
  if (schoolId) {
    const match = links.find(link => link.schoolId === schoolId);
    if (!match) throw Object.assign(new Error('You can only access schools linked to your director account.'), { status: 403 });
    return match.school;
  }
  if (links.length === 1) return links[0].school;
  throw Object.assign(new Error('Choose a linked school in Accounting first.'), { status: 400 });
}

async function parentAdmissions(user) {
  const email = String(user.email || '').trim().toLowerCase();
  if (!email) return new Set();
  const records = await prisma.moduleRecord.findMany({ where: { module: 'guardians' }, select: { data: true } });
  const linked = records.filter(record => String(record.data?.Email || '').trim().toLowerCase() === email);
  const contactKeys = row => [row.Email ? `e:${String(row.Email).trim().toLowerCase()}` : '',row.Phone ? `p:${String(row.Phone).replace(/\D/g,'')}` : '',row['Phone number'] ? `p:${String(row['Phone number']).replace(/\D/g,'')}` : '',row['WhatsApp number'] ? `p:${String(row['WhatsApp number']).replace(/\D/g,'')}` : ''].filter(value=>value.length>2);
  const keys = new Set(linked.flatMap(record => contactKeys(record.data || {})));
  return new Set(records.filter(record => linked.includes(record) || contactKeys(record.data || {}).some(key => keys.has(key)))
    .flatMap(record => String(record.data?.['Student admission number'] || record.data?.['Admission number'] || '').split(/[,;\s]+/))
    .map(value => value.trim().toUpperCase()).filter(Boolean));
}

async function assertPromptAccess(req, prompt) {
  if (isFinance(req)) {
    if (req.user.role === 'DIRECTOR') await schoolFor(req, prompt.schoolId);
    return;
  }
  if (req.user.role === 'PARENT') {
    const admissions = await parentAdmissions(req.user);
    if (!admissions.has(prompt.admissionNumber)) throw Object.assign(new Error('This payment prompt is not linked to your parent account.'), { status: 403 });
    return;
  }
  throw Object.assign(new Error('Payment prompt access denied.'), { status: 403 });
}

async function paymentBalance(admission, allocation, schoolId) {
  const [rows, assignments] = await Promise.all([
    prisma.moduleRecord.findMany({ where: { module: { in: ['fees','payments'] } }, select: { module: true, title: true, data: true } }),
    allocation === 'TRANSPORT' ? prisma.transportAssignment.findMany({ where: { schoolId, studentRecord: { data: { path: ['Admission number'], equals: admission } }, status: 'ACTIVE' }, select: { feeAmount: true } }) : Promise.resolve([])
  ]);
  let fees = 0, paid = 0;
  for (const row of rows) {
    const data = row.data || {};
    const currentAdmission = String(data['Student admission number'] || data['Admission number'] || '').trim().toUpperCase();
    if (currentAdmission !== admission) continue;
    const isTransport = `${row.title} ${data.Category || ''} ${data['Fee type'] || ''}`.toUpperCase().includes('TRANSPORT');
    if (allocation === 'TRANSPORT' && !isTransport) continue;
    if (allocation !== 'TRANSPORT' && isTransport) continue;
    const amount = Number(data['Amount (KES)'] ?? data.Amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    if (row.module === 'fees' && !['CANCELLED','WAIVED','REJECTED'].includes(String(data.Status || '').toUpperCase())) fees += amount;
    if (row.module === 'payments') {
      const status = String(data['Verification status'] || '').toUpperCase();
      if ((!status || status === 'VERIFIED_BALANCED') && !['CANCELLED','VOID','REVERSED','REJECTED'].includes(String(data.Status || '').toUpperCase())) paid += amount;
    }
  }
  if (allocation === 'TRANSPORT' && fees === 0) fees = assignments.reduce((sum, row) => sum + Number(row.feeAmount), 0);
  return Math.max(0, fees - paid);
}

router.post('/callbacks/:provider', async (req, res) => {
  const secret = process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET;
  const signature = String(req.get('x-gateway-signature') || '').trim().toLowerCase();
  if (!secret || !signature) return res.status(503).json({ message: 'Gateway callback signature verification is not configured.' });
  const expected = createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  const actualBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return res.status(401).json({ message: 'Invalid gateway callback signature.' });
  const provider = String(req.params.provider || '').toLowerCase();
  if (!adapterForDriver(provider) || provider === 'mock_sandbox') return res.status(404).json({ message: 'This provider callback adapter is not configured.' });
  const parsed = z.object({ promptId: z.string().min(1), providerReference: z.string().min(1).max(160), callbackIdempotencyKey: z.string().min(8).max(180), amount: z.number().positive(), currency: z.string().length(3).default('KES') }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Callback must include promptId, providerReference, unique callbackIdempotencyKey, amount, and currency.' });
  try {
    const prompt = await prisma.paymentPrompt.findUnique({ where: { id: parsed.data.promptId } });
    if (!prompt || prompt.gatewayDriver !== provider) return res.status(404).json({ message: 'Prompt does not belong to this provider.' });
    const result = await confirmGatewayPrompt({ ...parsed.data, verifiedById: prompt.createdById, source: provider });
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) { errorResponse(res, error); }
});

router.use(authenticate);
router.get('/drivers', (req, res) => {
  if (!isFinance(req)) return res.status(403).json({ message: 'Finance access required.' });
  res.json({ configured: process.env.PAYMENT_GATEWAY_DRIVER || 'mock_sandbox', drivers: [
    { id: 'mock_sandbox', status: 'READY', label: 'Mock sandbox (no money movement)' },
    { id: 'mpesa_stk', status: process.env.MPESA_CONSUMER_KEY ? 'CONFIGURED' : 'STUB', label: 'M-Pesa STK Push' },
    { id: 'mpesa_paybill', status: 'STUB', label: 'M-Pesa Paybill / statement' },
    { id: 'airtel_money', status: process.env.AIRTEL_CLIENT_ID ? 'CONFIGURED' : 'STUB', label: 'Airtel Money' },
    { id: 'bank_cheque', status: 'STUB', label: 'Bank / cheque' }
  ] });
});

router.get('/prompts', async (req, res) => {
  if (!promptRoles.includes(req.user.role)) return res.status(403).json({ message: 'Payment prompt access denied.' });
  try {
    let where;
    if (isFinance(req)) {
      const school = await schoolFor(req);
      where = { schoolId: school.id };
    } else {
      const admissions = await parentAdmissions(req.user);
      if (!admissions.size) return res.json({ prompts: [] });
      where = { admissionNumber: { in: [...admissions] } };
    }
    const prompts = await prisma.paymentPrompt.findMany({ where, include: { studentRecord: { select: { title: true, data: true } }, settledPayment: { select: { id: true, transactionCode: true, journalEntryId: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    res.json({ prompts });
  } catch (error) { errorResponse(res, error); }
});

router.post('/prompts', async (req, res) => {
  if (!promptRoles.includes(req.user.role)) return res.status(403).json({ message: 'Payment prompts are available to the parent and Finance roles.' });
  const parsed = z.object({
    schoolId: z.string().optional(), studentRecordId: z.string().min(1), channel: z.enum(['MPESA_PAYBILL','AIRTEL_MONEY']),
    purpose: z.enum(['school_fees','transport','other']), amount: z.number().positive(), phone: z.string().min(8).max(30),
    explanation: z.string().trim().max(600).optional(), idempotencyKey: z.string().min(8).max(180)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Choose a child, payment category, positive amount, valid Kenyan phone, and idempotency key.' });
  try {
    const school = await schoolFor(req, parsed.data.schoolId);
    const student = await prisma.moduleRecord.findFirst({ where: { id: parsed.data.studentRecordId, module: 'students' } });
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    const admissionNumber = String(student.data?.['Admission number'] || '').trim().toUpperCase();
    if (!admissionNumber) return res.status(400).json({ message: 'The student must have an admission number.' });
    if (!isFinance(req)) {
      if (req.user.role !== 'PARENT') return res.status(403).json({ message: 'Only a linked parent or Finance staff can request this prompt.' });
      const admissions = await parentAdmissions(req.user);
      if (!admissions.has(admissionNumber)) return res.status(403).json({ message: 'That child is not linked to your parent account.' });
    }
    if (parsed.data.purpose === 'other' && !parsed.data.explanation?.trim()) return res.status(400).json({ message: 'Explain the other payment purpose.' });
    const allocation = parsed.data.purpose === 'transport' ? 'TRANSPORT' : parsed.data.purpose === 'other' ? 'OTHER_FEES' : 'TUITION';
    const phone = normalizeKenyanPhone(parsed.data.phone);
    const hash = paymentRequestHash({ schoolId: school.id, studentRecordId: student.id, channel: parsed.data.channel, purpose: parsed.data.purpose, amount: parsed.data.amount, phone, explanation: parsed.data.explanation || '' });
    const replay = await prisma.paymentPrompt.findUnique({ where: { idempotencyKey: parsed.data.idempotencyKey } });
    if (replay) {
      if (replay.requestHash !== hash) return res.status(409).json({ message: 'That idempotency key belongs to a different prompt request.' });
      await assertPromptAccess(req, replay);
      return res.json({ prompt: replay, idempotent: true });
    }
    const balance = await paymentBalance(admissionNumber, allocation, school.id);
    if (parsed.data.amount > balance + 0.01) return res.status(400).json({ message: `Prompt amount is greater than the current ${allocation.toLowerCase()} balance of KES ${balance.toFixed(2)}.` });
    if (balance <= 0) return res.status(400).json({ message: `There is no outstanding ${allocation.toLowerCase()} balance for this student.` });
    const adapter = getPaymentPromptAdapter(parsed.data.channel);
    const prompt = await prisma.paymentPrompt.create({ data: {
      schoolId: school.id, studentRecordId: student.id, createdById: req.user.id, gatewayDriver: adapter.name,
      channel: parsed.data.channel, purpose: parsed.data.purpose, allocation, amount: new Prisma.Decimal(parsed.data.amount), phone,
      explanation: parsed.data.explanation || null, idempotencyKey: parsed.data.idempotencyKey, requestHash: hash,
      status: 'PENDING_PROMPT', expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    } });
    try {
      const response = await initiatePrompt(adapter, prompt);
      const updated = await prisma.paymentPrompt.update({ where: { id: prompt.id }, data: { providerRequestId: response.requestId, status: response.status, expiresAt: response.expiresAt || prompt.expiresAt } });
      await prisma.auditLog.create({ data: { userId: req.user.id, action: 'INITIATE_PAYMENT_PROMPT', entity: 'PaymentPrompt', entityId: prompt.id, details: { driver: adapter.name, channel: prompt.channel, purpose: prompt.purpose, amount: Number(prompt.amount), studentRecordId: student.id } } });
      return res.status(201).json({ prompt: updated, message: response.message, balance });
    } catch (error) {
      await prisma.paymentPrompt.update({ where: { id: prompt.id }, data: { status: 'FAILED', failureReason: error.message } });
      throw error;
    }
  } catch (error) { errorResponse(res, error); }
});

router.get('/prompts/:id', async (req, res) => {
  try {
    const prompt = await prisma.paymentPrompt.findUnique({ where: { id: req.params.id }, include: { studentRecord: { select: { title: true, data: true } }, settledPayment: true } });
    if (!prompt) return res.status(404).json({ message: 'Payment prompt not found.' });
    await assertPromptAccess(req, prompt);
    if (prompt.status === 'PENDING_PROMPT' && prompt.expiresAt && prompt.expiresAt < new Date()) {
      const updated = await prisma.paymentPrompt.update({ where: { id: prompt.id }, data: { status: 'TIMED_OUT', failureReason: 'The parent did not confirm before the prompt expired.' } });
      return res.json({ prompt: updated });
    }
    res.json({ prompt });
  } catch (error) { errorResponse(res, error); }
});

router.post('/prompts/:id/cancel', async (req, res) => {
  try {
    const prompt = await prisma.paymentPrompt.findUnique({ where: { id: req.params.id } });
    if (!prompt) return res.status(404).json({ message: 'Payment prompt not found.' });
    await assertPromptAccess(req, prompt);
    if (prompt.status !== 'PENDING_PROMPT') return res.status(409).json({ message: `Prompt is ${prompt.status} and cannot be cancelled.` });
    const updated = await prisma.paymentPrompt.update({ where: { id: prompt.id }, data: { status: 'CANCELLED' } });
    await prisma.auditLog.create({ data: { userId: req.user.id, action: 'CANCEL_PAYMENT_PROMPT', entity: 'PaymentPrompt', entityId: prompt.id } });
    res.json({ prompt: updated });
  } catch (error) { errorResponse(res, error); }
});

router.post('/prompts/:id/sandbox-confirm', async (req, res) => {
  if (!isFinance(req)) return res.status(403).json({ message: 'Sandbox confirmation is restricted to Finance staff.' });
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ message: 'Sandbox confirmation is disabled in production.' });
  const parsed = z.object({ providerReference: z.string().trim().max(160).optional(), callbackIdempotencyKey: z.string().trim().min(8).max(180).optional(), amount: z.number().positive().optional(), currency: z.string().length(3).default('KES') }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Enter a valid confirmation reference, callback key, amount, and currency.' });
  try {
    const prompt = await prisma.paymentPrompt.findUnique({ where: { id: req.params.id } });
    if (!prompt) return res.status(404).json({ message: 'Payment prompt not found.' });
    await assertPromptAccess(req, prompt);
    if (prompt.gatewayDriver !== 'mock_sandbox') return res.status(409).json({ message: 'Only mock sandbox prompts can be confirmed in the test console.' });
    const result = await confirmGatewayPrompt({ promptId: prompt.id, providerReference: parsed.data.providerReference || `SBX-${randomUUID().slice(0,12).toUpperCase()}`, callbackIdempotencyKey: parsed.data.callbackIdempotencyKey || `sandbox-${randomUUID()}`, amount: parsed.data.amount ?? Number(prompt.amount), currency: parsed.data.currency, verifiedById: req.user.id, source: 'mock_sandbox' });
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) { errorResponse(res, error); }
});

export default router;
