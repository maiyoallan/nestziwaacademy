import { Router } from 'express';
import { prisma } from '../db.js';
import { modules } from '../config/modules.js';
import { ensureSchoolAndChart } from './accounting.js';
import { IN_KIND_ITEMS, ITEM_UNITS } from '../services/paymentService.js';
import { z } from 'zod';

const router = Router();
const admissionOf = record => String(record?.data?.['Admission number'] || '').trim().toUpperCase();
const guardianAdmission = record => String(record?.data?.['Student admission number'] || record?.data?.['Admission number'] || '').split(/[,;\s]+/).map(value => value.trim().toUpperCase()).filter(Boolean);
const contactKeys = data => [
  data?.Email ? `e:${String(data.Email).trim().toLowerCase()}` : '',
  data?.Phone ? `p:${String(data.Phone).replace(/\D/g,'')}` : '',
  data?.['Phone number'] ? `p:${String(data['Phone number']).replace(/\D/g,'')}` : '',
  data?.['WhatsApp number'] ? `p:${String(data['WhatsApp number']).replace(/\D/g,'')}` : ''
].filter(key => key.length > 2);
async function parentAdmissions(user) {
  const email = String(user.email || '').trim().toLowerCase();
  if (!email) return [];
  const guardians = await prisma.moduleRecord.findMany({ where: { module: 'guardians' }, select: { data: true } });
  const linked = guardians.filter(row => String(row.data?.Email || '').trim().toLowerCase() === email);
  return [...new Set(linked.flatMap(guardianAdmission))];
}

async function canReadStudent(req, record) {
  if (!record || record.module !== 'students') return false;
  if (req.user.role === 'STUDENT') {
    const link = await prisma.studentAccount.findUnique({ where: { userId: req.user.id } });
    return link?.recordId === record.id;
  }
  if (req.user.role === 'PARENT') return (await parentAdmissions(req.user)).includes(admissionOf(record));
  return Boolean(modules.students.roles.includes(req.user.role) || ['BURSAR','TRANSPORT_MANAGER','DIRECTOR'].includes(req.user.role));
}

async function financialSummary(record, schoolId) {
  const admissionNumber = admissionOf(record);
  const [rows, pledges, movements, assignments] = await Promise.all([
    prisma.moduleRecord.findMany({ where: { module: { in: ['fees','payments'] } }, select: { module: true, title: true, data: true } }),
    prisma.inKindPledge.findMany({ where: { schoolId, admissionNumber, status: { not: 'CANCELLED' } } }),
    prisma.inKindMovement.findMany({ where: { schoolId, admissionNumber } }),
    prisma.transportAssignment.findMany({ where: { schoolId, studentRecordId: record.id, status: 'ACTIVE' }, include: { vehicle: { include: { route: true } }, route: true } })
  ]);
  let fees = 0, paid = 0, transportFees = 0, transportPaid = 0;
  for (const row of rows) {
    const data = row.data || {};
    const currentAdmission = String(data['Student admission number'] || data['Admission number'] || '').trim().toUpperCase();
    if (currentAdmission !== admissionNumber) continue;
    const amount = Number(data['Amount (KES)'] ?? data.Amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    const isTransport = `${row.title} ${data.Category || ''} ${data['Fee type'] || ''}`.toUpperCase().includes('TRANSPORT');
    if (row.module === 'fees' && !['CANCELLED','WAIVED','REJECTED'].includes(String(data.Status || '').toUpperCase())) {
      fees += amount;
      if (isTransport) transportFees += amount;
    }
    if (row.module === 'payments') {
      const verification = String(data['Verification status'] || '').toUpperCase();
      const status = String(data.Status || '').toUpperCase();
      if ((verification && verification !== 'VERIFIED_BALANCED') || ['CANCELLED','VOID','REVERSED','REJECTED'].includes(status)) continue;
      paid += amount;
      if (isTransport) transportPaid += amount;
    }
  }
  if (transportFees === 0) { transportFees = assignments.reduce((sum, assignment) => sum + Number(assignment.feeAmount), 0); fees += transportFees; }
  const itemBalances = ['MAIZE','BEANS','MILLET','REAM_PAPER'].map(item => {
    const itemPledges = pledges.filter(row => row.item === item);
    const itemMovements = movements.filter(row => row.item === item);
    const units = [...new Set([...itemPledges.map(row => row.unit), ...itemMovements.map(row => row.unit)])];
    return { item, units: units.map(unit => {
      const pledged = itemPledges.filter(row => row.unit === unit).reduce((sum, row) => sum + Number(row.quantity), 0);
      const received = itemMovements.filter(row => row.unit === unit).reduce((sum, row) => sum + Number(row.quantity), 0);
      return { unit, pledged, received, balance: pledged - received, receivedValue: itemMovements.filter(row => row.unit === unit).reduce((sum, row) => sum + Number(row.totalValue), 0) };
    }) };
  });
  return {
    fees, paid, balance: fees - paid,
    transportFees, transportPaid, transportBalance: transportFees - transportPaid,
    itemBalances, transportAssignments: assignments
  };
}

async function buildHub(record, schoolId, viewer) {
  const admissionNumber = admissionOf(record);
  const [photo, guardians, exams, financial] = await Promise.all([
    prisma.studentPhoto.findUnique({ where: { recordId: record.id }, select: { updatedAt: true } }),
    prisma.moduleRecord.findMany({ where: { module: 'guardians' }, select: { id: true, title: true, data: true } }),
    prisma.moduleRecord.findMany({ where: { module: 'examinations' }, orderBy: { updatedAt: 'desc' }, take: 500 }),
    financialSummary(record, schoolId)
  ]);
  const linkedGuardians = guardians.filter(row => guardianAdmission(row).includes(admissionNumber));
  const siblingAdmissions = new Set(linkedGuardians.flatMap(guardianAdmission));
  if (viewer?.role === 'PARENT') {
    const email = String(viewer.email || '').trim().toLowerCase();
    siblingAdmissions.clear();
    guardians.filter(row => String(row.data?.Email || '').trim().toLowerCase() === email).flatMap(guardianAdmission).forEach(value => siblingAdmissions.add(value));
  } else if (viewer?.role === 'STUDENT') siblingAdmissions.clear();
  else {
    const currentKeys = new Set(linkedGuardians.flatMap(row => contactKeys(row.data || {})));
    if (currentKeys.size) for (const guardian of guardians) if (contactKeys(guardian.data || {}).some(key => currentKeys.has(key))) guardianAdmission(guardian).forEach(value => siblingAdmissions.add(value));
  }
  siblingAdmissions.delete(admissionNumber);
  const studentRows = siblingAdmissions.size ? await prisma.moduleRecord.findMany({ where: { module: 'students' }, select: { id: true, title: true, data: true } }) : [];
  const siblings = studentRows.filter(row => siblingAdmissions.has(admissionOf(row))).map(row => ({ id: row.id, title: row.title, data: row.data }));
  const results = exams.filter(row => String(row.data?.['Student admission number'] || row.data?.['Admission number'] || '').trim().toUpperCase() === admissionNumber);
  return {
    record,
    photoUrl: photo ? `/api/student-hub/${record.id}/photo?v=${photo.updatedAt.getTime()}` : null,
    guardians: linkedGuardians.map(row => ({ name: row.data?.['Full name'] || row.title, phone: row.data?.Phone || row.data?.['Phone number'] || row.data?.['WhatsApp number'] || '', email: row.data?.Email || '' })),
    siblings, results, ...financial
  };
}

router.get('/children', async (req, res) => {
  if (req.user.role !== 'PARENT') return res.status(403).json({ message: 'Parent access required.' });
  try {
    const admissions = await parentAdmissions(req.user);
    if (!admissions.length) return res.json({ children: [], message: 'No student records are linked to this login email. Contact the school office to update the parent email on the guardian record.' });
    const records = await prisma.moduleRecord.findMany({ where: { module: 'students' }, orderBy: { updatedAt: 'desc' } });
    const school = await ensureSchoolAndChart();
    const children = await Promise.all(records.filter(record => admissions.includes(admissionOf(record))).map(record => buildHub(record, school.id, req.user)));
    res.json({ children });
  } catch (error) { res.status(error.status || 500).json({ message: error.message || 'Parent child records could not be loaded.' }); }
});

router.post('/:recordId/food-pledge', async (req, res) => {
  if (req.user.role !== 'PARENT') return res.status(403).json({ message: 'This pledge action is available to a linked parent account.' });
  const parsed = z.object({ item: z.enum(IN_KIND_ITEMS), quantity: z.number().positive(), unit: z.string().trim().min(1).max(20), notes: z.string().trim().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Choose a supported food/item, quantity, and standard unit.' });
  const unit = parsed.data.unit.toUpperCase();
  if (!ITEM_UNITS[parsed.data.item].includes(unit)) return res.status(400).json({ message: `Use ${ITEM_UNITS[parsed.data.item].join(' or ')} for this item.` });
  try {
    const record = await prisma.moduleRecord.findFirst({ where: { id: req.params.recordId, module: 'students' } });
    if (!record || !await canReadStudent(req, record)) return res.status(404).json({ message: 'Linked student record not found.' });
    const school = await ensureSchoolAndChart();
    const pledge = await prisma.inKindPledge.create({ data: {
      schoolId: school.id, studentRecordId: record.id, createdById: req.user.id,
      admissionNumber: admissionOf(record), className: String(record.data?.Class || '').toUpperCase(),
      item: parsed.data.item, quantity: parsed.data.quantity, unit, notes: parsed.data.notes || 'Parent in-kind pledge'
    } });
    await prisma.auditLog.create({ data: { userId: req.user.id, action: 'PARENT_PLEDGE_IN_KIND', entity: 'InKindPledge', entityId: pledge.id, details: { admissionNumber: pledge.admissionNumber, item: pledge.item, quantity: Number(pledge.quantity), unit } } });
    res.status(201).json({ pledge });
  } catch (error) { res.status(error.status || 500).json({ message: error.message || 'The item pledge could not be saved.' }); }
});

router.get('/:recordId', async (req, res) => {
  try {
    const record = await prisma.moduleRecord.findFirst({ where: { id: req.params.recordId, module: 'students' } });
    if (!record) return res.status(404).json({ message: 'Student record not found.' });
    if (!await canReadStudent(req, record)) return res.status(403).json({ message: 'You can only view a child linked to your account.' });
    const school = await ensureSchoolAndChart();
    const hub = await buildHub(record, school.id, req.user);
    if (req.user.role === 'STUDENT') hub.siblings = [];
    res.json({ hub });
  } catch (error) { res.status(error.status || 500).json({ message: error.message || 'Student hub could not be loaded.' }); }
});

router.get('/:recordId/photo', async (req, res) => {
  try {
    const record = await prisma.moduleRecord.findFirst({ where: { id: req.params.recordId, module: 'students' }, include: { photo: true } });
    if (!record?.photo) return res.status(404).json({ message: 'Student photo not found.' });
    if (!await canReadStudent(req, record)) return res.status(403).json({ message: 'You can only view a child linked to your account.' });
    res.type(record.photo.mimeType).set('Cache-Control', 'private, no-store').send(Buffer.from(record.photo.data));
  } catch (error) { res.status(error.status || 500).json({ message: error.message || 'Student photo could not be loaded.' }); }
});

export default router;
