import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';

const router = Router();
const rowSchema = z.object({
  reference: z.string().trim().min(2).max(100),
  externalId: z.string().trim().max(120).optional(),
  admissionNumber: z.string().trim().max(80).optional(),
  amount: z.number().positive(),
  method: z.string().max(40).optional(),
  transactionDate: z.string().datetime().optional()
});

router.post('/', async (req, res) => {
  const secret = process.env.BANK_WEBHOOK_SECRET;
  const supplied = String(req.headers['x-bank-webhook-secret'] || '');
  if (!secret) return res.status(503).json({ message: 'Bank webhooks are disabled until BANK_WEBHOOK_SECRET is configured.' });
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    return res.status(401).json({ message: 'Invalid bank webhook credentials.' });
  }

  const parsed = z.object({
    schoolCode: z.string().trim().min(2).max(30),
    transactions: z.array(rowSchema).min(1).max(100)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Provide a school code and up to 100 valid transaction rows.' });

  const school = await prisma.school.findUnique({ where: { code: parsed.data.schoolCode.toUpperCase() } });
  if (!school) return res.status(404).json({ message: 'School integration code not found.' });
  const [students, feeRows] = await Promise.all([
    prisma.moduleRecord.findMany({ where: { module: 'students' }, select: { data: true } }),
    prisma.moduleRecord.findMany({ where: { module: { in: ['fees', 'payments'] } }, select: { module: true, data: true } })
  ]);
  const studentAdmissions = new Set(students.map(student => String(student.data?.['Admission number'] || '').trim().toUpperCase()));
  const balances = new Map();
  for (const row of feeRows) {
    const data = row.data || {};
    const admission = String(data['Student admission number'] || data['Admission number'] || '').trim().toUpperCase();
    const amount = Number(data['Amount (KES)'] ?? data.Amount ?? 0);
    if (!admission || !Number.isFinite(amount)) continue;
    const current = balances.get(admission) || 0;
    if (row.module === 'fees' && !['CANCELLED', 'WAIVED'].includes(String(data.Status || '').toUpperCase())) balances.set(admission, current + amount);
    if (row.module === 'payments' && (!data['Verification status'] || data['Verification status'] === 'VERIFIED_BALANCED') && !['CANCELLED', 'VOID', 'REVERSED', 'REJECTED'].includes(String(data.Status || '').toUpperCase())) balances.set(admission, current - amount);
  }

  let imported = 0, duplicates = 0, conflicts = 0;
  for (const row of parsed.data.transactions) {
    const existing = await prisma.bankTransaction.findFirst({
      where: { OR: [{ schoolId: school.id, reference: row.reference }, ...(row.externalId ? [{ externalId: row.externalId }] : [])] }
    });
    if (existing) {
      duplicates++;
      conflicts++;
      await prisma.notification.create({ data: {
        targetRole: 'BURSAR', severity: 'HIGH', title: 'Duplicate bank webhook transaction',
        message: `${row.reference} was delivered more than once.`, entity: 'BankTransaction', entityId: existing.id
      } });
      continue;
    }
    const admission = String(row.admissionNumber || row.reference).trim().toUpperCase();
    const matched = studentAdmissions.has(admission);
    let status = matched ? 'MATCH_REVIEW' : 'UNMATCHED';
    let conflictReason = matched ? null : 'Admission number or payment reference did not match a student.';
    const outstanding = balances.get(admission);
    if (matched && outstanding === undefined) {
      status = 'UNMATCHED';
      conflictReason = 'The student matches, but no fee balance is available to confirm this payment. Review it before allocating.';
    } else if (matched && Number.isFinite(outstanding) && row.amount > outstanding) {
      status = 'OVERPAYMENT';
      conflictReason = `Payment ${row.amount.toFixed(2)} exceeds the recorded balance ${Math.max(0, outstanding).toFixed(2)}.`;
    }
    if (matched && Number.isFinite(outstanding)) balances.set(admission, outstanding - row.amount);
    const saved = await prisma.bankTransaction.create({ data: {
      schoolId: school.id, reference: row.reference, externalId: row.externalId || null,
      admissionNumber: matched ? admission : (row.admissionNumber || null), amount: row.amount,
      method: row.method || 'BANK', transactionDate: row.transactionDate ? new Date(row.transactionDate) : new Date(),
      status, conflictReason, rawPayload: row
    } });
    imported++;
    if (status !== 'MATCH_REVIEW') {
      conflicts++;
      await prisma.notification.create({ data: {
        targetRole: 'BURSAR', severity: status === 'OVERPAYMENT' ? 'HIGH' : 'WARNING',
        title: status === 'OVERPAYMENT' ? 'Possible fee overpayment' : 'Unmatched bank webhook payment',
        message: `${row.reference}: ${conflictReason}`, entity: 'BankTransaction', entityId: saved.id
      } });
    }
  }
  await prisma.auditLog.create({ data: {
    action: 'BANK_WEBHOOK_INGEST', entity: 'BankTransaction',
    details: { schoolCode: school.code, imported, duplicates, conflicts }
  } });
  res.status(202).json({ accepted: imported, duplicates, conflicts, posted: false, message: 'Transactions are queued for accountant review; the webhook never posts a ledger entry automatically.' });
});

export default router;
