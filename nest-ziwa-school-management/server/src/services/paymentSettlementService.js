import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { postBalancedEntry } from '../routes/accounting.js';
import { paymentRequestHash } from './paymentGatewayService.js';

async function concern({ prompt, userId, reason, title }) {
  const row = await prisma.paymentConcern.create({ data: {
    schoolId: prompt.schoolId,
    paymentId: null,
    channel: prompt.channel,
    transactionCode: prompt.providerReference,
    reason,
    createdById: userId
  } });
  await prisma.notification.createMany({ data: ['BURSAR','HEADTEACHER','SYSTEM_ADMIN','DIRECTOR'].map(targetRole => ({
    targetRole, severity: 'HIGH', title, message: reason, entity: 'PaymentConcern', entityId: row.id
  })) });
  await prisma.auditLog.create({ data: { userId, action: 'FLAG_GATEWAY_PAYMENT_CONCERN', entity: 'PaymentConcern', entityId: row.id } });
  return row;
}

async function ensureAccount(tx, schoolId, code, name, accountType) {
  return tx.ledgerAccount.upsert({
    where: { schoolId_code: { schoolId, code } },
    create: { schoolId, code, name, accountType },
    update: {}
  });
}

export async function confirmGatewayPrompt({ promptId, providerReference, callbackIdempotencyKey, amount, currency = 'KES', verifiedById, source = 'sandbox' }) {
  const prompt = await prisma.paymentPrompt.findUnique({ where: { id: promptId }, include: { studentRecord: true, settledPayment: true } });
  if (!prompt) throw Object.assign(new Error('Payment prompt not found.'), { status: 404 });
  if (prompt.status === 'PAID_CONFIRMED') {
    if (prompt.callbackIdempotencyKey === callbackIdempotencyKey || prompt.providerReference === providerReference) return { prompt, payment: prompt.settledPayment, idempotent: true };
    throw Object.assign(new Error('This prompt was already confirmed with a different callback.'), { status: 409 });
  }
  if (prompt.status !== 'PENDING_PROMPT') throw Object.assign(new Error(`Prompt is ${prompt.status} and cannot be confirmed.`), { status: 409 });
  if (prompt.expiresAt && prompt.expiresAt < new Date()) {
    const timedOut = await prisma.paymentPrompt.update({ where: { id: prompt.id }, data: { status: 'TIMED_OUT', failureReason: 'The payment prompt expired before confirmation.' } });
    throw Object.assign(new Error(`Prompt expired at ${timedOut.expiresAt?.toLocaleString() || 'the timeout window'}. Retry with a new prompt.`), { status: 409 });
  }
  const ref = String(providerReference || '').trim().toUpperCase();
  if (!ref || !String(callbackIdempotencyKey || '').trim()) throw Object.assign(new Error('A provider reference and unique callback idempotency key are required.'), { status: 400 });
  if (String(currency).toUpperCase() !== 'KES' || Math.abs(Number(amount) - Number(prompt.amount)) > 0.01) {
    const reason = `Gateway confirmation amount/currency did not match prompt ${prompt.id}. Expected KES ${Number(prompt.amount).toFixed(2)}; received ${Number(amount).toFixed(2)} ${String(currency).toUpperCase()}.`;
    await prisma.paymentPrompt.update({ where: { id: prompt.id }, data: { status: 'UNBALANCED', failureReason: reason } });
    await concern({ prompt, userId: verifiedById, reason, title: 'Gateway payment mismatch needs follow-up' });
    throw Object.assign(new Error(reason), { status: 409 });
  }
  const duplicate = await prisma.paymentTransaction.findFirst({ where: { schoolId: prompt.schoolId, channel: prompt.channel, transactionCode: ref } });
  if (duplicate) {
    const reason = `Provider reference ${ref} already exists for ${prompt.channel}; sandbox/callback settlement was stopped to prevent duplicate posting.`;
    await prisma.paymentPrompt.update({ where: { id: prompt.id }, data: { status: 'CONCERN', failureReason: reason } });
    await concern({ prompt, userId: verifiedById, reason, title: 'Gateway payment reference collision' });
    throw Object.assign(new Error(reason), { status: 409 });
  }

  try {
    return await prisma.$transaction(async tx => {
      const current = await tx.paymentPrompt.findUnique({ where: { id: prompt.id } });
      if (!current || current.status !== 'PENDING_PROMPT') throw Object.assign(new Error('Prompt was already changed by another callback.'), { status: 409 });
      const now = new Date();
      const bank = await ensureAccount(tx, prompt.schoolId, '1020', 'Bank', 'ASSET');
      const receivable = await ensureAccount(tx, prompt.schoolId, '1100', 'Fees Receivable', 'ASSET');
      const amountValue = Number(prompt.amount);
      const paymentRecord = await tx.moduleRecord.create({ data: {
        module: 'payments', title: `${prompt.purpose.replaceAll('_',' ')} PAYMENT - ${ref}`.toUpperCase(), createdById: prompt.createdById,
        data: {
          'Receipt number': ref,
          'Student admission number': prompt.studentRecord.data?.['Admission number'] || '',
          'Class': prompt.studentRecord.data?.Class || '',
          'Fee type': prompt.allocation,
          'Amount (KES)': amountValue,
          'Cash amount': amountValue,
          'Method': prompt.channel === 'AIRTEL_MONEY' ? 'AIRTEL MONEY' : 'M-PESA PAYBILL',
          'Reference': ref,
          'Transaction code': ref,
          'Verification status': 'VERIFIED_BALANCED',
          'Status': 'PAID',
          'Payment gateway': prompt.gatewayDriver,
          'Payment prompt id': prompt.id
        }
      } });
      const payment = await tx.paymentTransaction.create({ data: {
        schoolId: prompt.schoolId, studentRecordId: prompt.studentRecordId, createdById: prompt.createdById, verifiedById,
        channel: prompt.channel, transactionCode: ref, idempotencyKey: `${prompt.id}:settled`,
        requestFingerprint: paymentRequestHash({ promptId: prompt.id, ref, amount: amountValue }),
        admissionNumber: String(prompt.studentRecord.data?.['Admission number'] || prompt.id),
        className: String(prompt.studentRecord.data?.Class || ''), allocation: prompt.allocation,
        amount: new Prisma.Decimal(amountValue), cashAmount: new Prisma.Decimal(amountValue), cashbook: 'BANK',
        status: 'VERIFIED_BALANCED', statementReference: ref, statementAmount: new Prisma.Decimal(amountValue),
        verificationNote: `${source} provider confirmation`, verifiedAt: now, paymentRecordId: paymentRecord.id
      } });
      const journal = await postBalancedEntry(tx, {
        school: { id: prompt.schoolId }, description: `Confirmed ${prompt.channel} ${prompt.purpose.replaceAll('_',' ')} payment ${ref}`,
        sourceType: 'STUDENT_PAYMENT', sourceId: payment.id, createdById: verifiedById, transactionDate: now,
        lines: [
          { accountId: bank.id, debit: amountValue, cashbook: 'BANK', memo: ref },
          { accountId: receivable.id, credit: amountValue, memo: `Admission ${payment.admissionNumber}` }
        ]
      });
      await tx.paymentTransaction.update({ where: { id: payment.id }, data: { journalEntryId: journal.id } });
      await tx.moduleRecord.update({ where: { id: paymentRecord.id }, data: { data: { ...paymentRecord.data, 'Payment transaction id': payment.id, 'Journal entry': journal.entryNumber } } });
      const savedPrompt = await tx.paymentPrompt.update({ where: { id: prompt.id }, data: {
        status: 'PAID_CONFIRMED', providerReference: ref, callbackIdempotencyKey,
        settledPaymentId: payment.id, confirmedAt: now, failureReason: null
      } });
      await tx.auditLog.create({ data: { userId: verifiedById, action: 'CONFIRM_GATEWAY_PAYMENT', entity: 'PaymentPrompt', entityId: prompt.id, details: { source, providerReference: ref, amount: amountValue, paymentId: payment.id, journalEntryId: journal.id } } });
      await tx.notification.create({ data: { targetRole: 'BURSAR', severity: 'INFO', title: 'Payment confirmed', message: `${ref} confirmed KES ${amountValue.toFixed(2)} for ${payment.admissionNumber} and was posted to the ledger.`, entity: 'PaymentTransaction', entityId: payment.id, resolvedAt: now } });
      return { prompt: savedPrompt, payment: { ...payment, journalEntryId: journal.id }, journal, idempotent: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error.code === 'P2002') {
      const existing = await prisma.paymentPrompt.findUnique({ where: { id: prompt.id }, include: { settledPayment: true } });
      if (existing?.status === 'PAID_CONFIRMED') return { prompt: existing, payment: existing.settledPayment, idempotent: true };
    }
    throw error;
  }
}
