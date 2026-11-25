import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ensureSchoolAndChart, postBalancedEntry } from './accounting.js';
import { getDisbursementAdapter, paymentRequestHash } from '../services/paymentGatewayService.js';

const router = Router();
function errorResponse(res, error) { res.status(error.status || 500).json({ message: error.message || 'Salary disbursement could not be completed.' }); }
async function schoolFor(req, requested='') {
  if (req.user.role !== 'DIRECTOR') return ensureSchoolAndChart();
  const schoolId = String(requested || req.query.schoolId || req.body.schoolId || '');
  const links = await prisma.schoolLink.findMany({ where: { directorId: req.user.id }, include: { school: true } });
  if (schoolId) {
    const match = links.find(link => link.schoolId === schoolId);
    if (!match) throw Object.assign(new Error('You can only pay staff for a school linked to your director account.'), { status: 403 });
    return match.school;
  }
  if (links.length === 1) return links[0].school;
  throw Object.assign(new Error('Choose a linked school first.'), { status: 400 });
}
function authorize(req, res, next) { if (req.user.role !== 'DIRECTOR') return res.status(403).json({ message: 'Only the Director can initiate salary disbursements.' }); next(); }
router.use(authorize);

router.get('/staff', async (req, res) => {
  try {
    const school = await schoolFor(req);
    const records = await prisma.moduleRecord.findMany({ where: { module: 'hr' }, orderBy: { updatedAt: 'asc' }, take: 1000 });
    res.json({ school, staff: records });
  } catch (error) { errorResponse(res, error); }
});

router.get('/runs', async (req, res) => {
  try {
    const school = await schoolFor(req);
    const runs = await prisma.salaryRun.findMany({ where: { schoolId: school.id }, include: { items: { include: { staffRecord: { select: { id: true, title: true, data: true } } } }, journalEntry: { select: { id: true, entryNumber: true } } }, orderBy: { createdAt: 'desc' }, take: 250 });
    res.json({ runs });
  } catch (error) { errorResponse(res, error); }
});

router.post('/runs', async (req, res) => {
  const parsed = z.object({
    schoolId: z.string().optional(),
    channel: z.enum(['BANK_TRANSFER','CHEQUE','CASH']).default('BANK_TRANSFER'),
    idempotencyKey: z.string().trim().min(8).max(180),
    items: z.array(z.object({ staffRecordId: z.string().min(1), amount: z.number().positive(), description: z.string().trim().max(200).optional() })).min(1).max(300)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Select at least one staff member and enter a positive batch or installment amount for each.' });
  try {
    const school = await schoolFor(req, parsed.data.schoolId);
    const seen = new Set();
    for (const item of parsed.data.items) {
      if (seen.has(item.staffRecordId)) return res.status(400).json({ message: 'A staff member can appear only once in each salary run.' });
      seen.add(item.staffRecordId);
    }
    const staffRecords = await prisma.moduleRecord.findMany({ where: { id: { in: [...seen] }, module: 'hr' }, select: { id: true } });
    if (staffRecords.length !== seen.size) return res.status(400).json({ message: 'One or more selected staff records are invalid.' });
    const totalAmount = Math.round(parsed.data.items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
    const requestHash = paymentRequestHash({ schoolId: school.id, channel: parsed.data.channel, items: [...parsed.data.items].sort((a,b)=>a.staffRecordId.localeCompare(b.staffRecordId)) });
    const replay = await prisma.salaryRun.findUnique({ where: { idempotencyKey: parsed.data.idempotencyKey }, include: { items: true } });
    if (replay) {
      if (replay.requestHash !== requestHash) return res.status(409).json({ message: 'That idempotency key belongs to a different salary run.' });
      if (replay.schoolId !== school.id) return res.status(403).json({ message: 'This salary run belongs to another school.' });
      return res.json({ run: replay, idempotent: true });
    }
    const adapter = getDisbursementAdapter();
    const run = await prisma.salaryRun.create({ data: {
      schoolId: school.id, createdById: req.user.id, gatewayDriver: adapter.name, channel: parsed.data.channel,
      status: 'PENDING_CONFIRMATION', totalAmount: new Prisma.Decimal(totalAmount), idempotencyKey: parsed.data.idempotencyKey, requestHash,
      items: { create: parsed.data.items.map(item => ({ staffRecordId: item.staffRecordId, amount: new Prisma.Decimal(item.amount), description: item.description || null })) }
    }, include: { items: { include: { staffRecord: { select: { id: true, title: true, data: true } } } } } });
    try {
      const response = await adapter.disburse({ run });
      const updated = await prisma.salaryRun.update({ where: { id: run.id }, data: { providerRequestId: response.requestId, status: response.status } });
      await prisma.auditLog.create({ data: { userId: req.user.id, action: 'INITIATE_DIRECTOR_SALARY_RUN', entity: 'SalaryRun', entityId: run.id, details: { amount: totalAmount, staffCount: run.items.length, driver: adapter.name } } });
      res.status(201).json({ run: { ...run, ...updated }, message: response.message });
    } catch (error) {
      await prisma.salaryRun.update({ where: { id: run.id }, data: { status: 'FAILED', failureReason: error.message } });
      throw error;
    }
  } catch (error) { errorResponse(res, error); }
});

router.post('/runs/:id/sandbox-confirm', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ message: 'Sandbox confirmation is disabled in production.' });
  const parsed = z.object({ providerReference: z.string().trim().max(160).optional(), callbackIdempotencyKey: z.string().trim().min(8).max(180).optional(), amount: z.number().positive().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Enter a valid payout reference, callback key, and amount.' });
  try {
    const run = await prisma.salaryRun.findUnique({ where: { id: req.params.id }, include: { items: true, journalEntry: true } });
    if (!run) return res.status(404).json({ message: 'Salary run not found.' });
    await schoolFor(req, run.schoolId);
    if (run.gatewayDriver !== 'mock_sandbox') return res.status(409).json({ message: 'Only mock sandbox salary runs can be confirmed here.' });
    if (run.status === 'PAID_CONFIRMED' && (run.providerReference === parsed.data.providerReference || run.callbackIdempotencyKey === parsed.data.callbackIdempotencyKey)) return res.json({ run, idempotent: true });
    if (run.status !== 'PENDING_CONFIRMATION') return res.status(409).json({ message: `Salary run is ${run.status} and cannot be confirmed.` });
    const confirmedAmount = parsed.data.amount ?? Number(run.totalAmount);
    if (Math.abs(confirmedAmount - Number(run.totalAmount)) > 0.01) {
      const reason = `Salary payout confirmation mismatch for run ${run.id}: expected KES ${Number(run.totalAmount).toFixed(2)}, received KES ${confirmedAmount.toFixed(2)}.`;
      const updated = await prisma.salaryRun.update({ where: { id: run.id }, data: { status: 'UNBALANCED', failureReason: reason } });
      await prisma.notification.create({ data: { targetRole: 'DIRECTOR', severity: 'HIGH', title: 'Salary payout needs follow-up', message: reason, entity: 'SalaryRun', entityId: run.id } });
      return res.status(409).json({ message: reason, run: updated });
    }
    const providerReference = parsed.data.providerReference || `SBX-PAY-${randomUUID().slice(0, 12).toUpperCase()}`;
    const callbackIdempotencyKey = parsed.data.callbackIdempotencyKey || `salary-${randomUUID()}`;
    const result = await prisma.$transaction(async tx => {
      const current = await tx.salaryRun.findUnique({ where: { id: run.id } });
      if (!current || current.status !== 'PENDING_CONFIRMATION') throw Object.assign(new Error('This salary run was changed by another confirmation.'), { status: 409 });
      const expense = await tx.ledgerAccount.upsert({ where: { schoolId_code: { schoolId: run.schoolId, code: '5100' } }, create: { schoolId: run.schoolId, code: '5100', name: 'Salaries and Wages', accountType: 'EXPENSE' }, update: {} });
      const bank = await tx.ledgerAccount.upsert({ where: { schoolId_code: { schoolId: run.schoolId, code: '1020' } }, create: { schoolId: run.schoolId, code: '1020', name: 'Bank', accountType: 'ASSET' }, update: {} });
      const journal = await postBalancedEntry(tx, { school: { id: run.schoolId }, description: `Confirmed salary disbursement ${providerReference}`, sourceType: 'SALARY_RUN', sourceId: run.id, createdById: req.user.id, transactionDate: new Date(), lines: [
        { accountId: expense.id, debit: Number(run.totalAmount), memo: `${run.items.length} staff payment(s)` },
        { accountId: bank.id, credit: Number(run.totalAmount), cashbook: 'BANK', memo: providerReference }
      ] });
      const updated = await tx.salaryRun.update({ where: { id: run.id }, data: { status: 'PAID_CONFIRMED', confirmedById: req.user.id, confirmedAt: new Date(), providerReference, callbackIdempotencyKey, journalEntryId: journal.id, failureReason: null }, include: { items: { include: { staffRecord: { select: { title: true, data: true } } } } } });
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'CONFIRM_DIRECTOR_SALARY_RUN', entity: 'SalaryRun', entityId: run.id, details: { amount: Number(run.totalAmount), providerReference, journalEntryId: journal.id } } });
      return { run: updated, journal };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(201).json(result);
  } catch (error) { if (error.code === 'P2002') return res.status(409).json({ message: 'This payout reference or callback has already been processed.' }); errorResponse(res, error); }
});

export default router;
