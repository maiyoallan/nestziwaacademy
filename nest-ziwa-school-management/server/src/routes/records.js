import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { prisma } from '../db.js';
import { modules } from '../config/modules.js';
import { ADMISSION_NUMBER_FIELD, getAdmissionNumber, nextAdmissionNumber, normalizeAdmissionNumber } from '../utils/admissionNumbers.js';
import { normalizeStudentData, validateStudentData } from '../utils/students.js';
import { ensureSchoolAndChart, postBalancedEntry } from './accounting.js';
import { createHash } from 'node:crypto';
import { createStagedPayment, normalizeChannel } from '../services/paymentService.js';
const router = Router();
const payloadSchema = z.object({ title: z.string().trim().min(1).max(180), data: z.record(z.any()) });
async function getStudentAdmissionNumbers(db = prisma, excludeId) {
  const rows = await db.moduleRecord.findMany({ where: { module: 'students', ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { data: true } });
  return rows.map((row) => getAdmissionNumber(row.data)).filter(Boolean);
}
async function lockAdmissionNumberSequence(tx) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('nest-ziwa-student-admission-number')::bigint)::text AS locked`;
}
async function autoPostFinanceRecord(record,module,userId){
 if(!['fees','payments','expenses'].includes(module))return null;
 const data=record.data||{},status=String(data.Status||data.Approval||'').toUpperCase();
 if(module==='expenses'&&!['PAID','POSTED'].includes(status))return {posted:false,message:'Expense saved and awaiting approval/payment; it was not posted to the ledger.'};
 if(module==='fees'&&['CANCELLED','WAIVED','REJECTED'].includes(status))return {posted:false,message:'Inactive fee record was saved without a journal posting.'};
 if(['fees','payments'].includes(module)&&!String(data['Student admission number']||data['Admission number']||'').trim())return {posted:false,message:'Add the student admission number before creating a fee or payment ledger entry.'};
 const amount=Number(data['Amount (KES)']??data.Amount);if(!Number.isFinite(amount)||amount<=0)return {posted:false,message:'Record saved, but a positive amount is required before accounting can post it.'};
 const school=await ensureSchoolAndChart();const accounts=await prisma.ledgerAccount.findMany({where:{schoolId:school.id,code:{in:['1000','1010','1020','1100','4000','5000']}}});const byCode=new Map(accounts.map(account=>[account.code,account]));const method=String(data.Method||'').toUpperCase();const cashCode=module==='expenses'?(method.includes('CASH')?'1000':method.includes('PETTY')?'1010':'1020'):(module==='payments'&&method.includes('CASH')?'1000':module==='payments'&&method.includes('PETTY')?'1010':'1020');const cash=byCode.get(cashCode);
 let lines,description;
 if(module==='fees'){description=`Fee charge: ${record.title}`;lines=[{accountId:byCode.get('1100').id,debit:amount},{accountId:byCode.get('4000').id,credit:amount}];}
 else if(module==='payments'){description=`Fee payment: ${record.title}`;lines=[{accountId:cash.id,debit:amount,cashbook:cashCode==='1000'?'MAIN':cashCode==='1010'?'PETTY':'BANK'},{accountId:byCode.get('1100').id,credit:amount}];}
 else{description=`Paid expense: ${record.title}`;lines=[{accountId:byCode.get('5000').id,debit:amount},{accountId:cash.id,credit:amount,cashbook:cashCode==='1000'?'MAIN':cashCode==='1010'?'PETTY':'BANK'}];}
 const dateValue=data.Date||data['Date paid']||data['Payment date'];const transactionDate=dateValue?new Date(dateValue):new Date();
 const entry=await prisma.$transaction(tx=>postBalancedEntry(tx,{school,description,sourceType:`LEGACY_${module.toUpperCase()}`,sourceId:record.id,createdById:userId,transactionDate,lines}));return {posted:true,entryNumber:entry.entryNumber};
}
async function findPostedFinancialJournal(record,module){
 const matches=[{sourceType:`LEGACY_${module.toUpperCase()}`,sourceId:record.id}];
 const bankTransactionId=module==='payments'?record.data?.['Bank transaction id']:null;
 if(bankTransactionId)matches.push({sourceType:'BANK',sourceId:String(bankTransactionId)});
 return prisma.journalEntry.findFirst({where:{OR:matches}});
}
async function findManagedPayment(record,module){
 const paymentId=module==='payments'?record.data?.['Payment transaction id']:null;
 return paymentId?prisma.paymentTransaction.findUnique({where:{id:String(paymentId)}}):null;
}

router.get('/admission-number/suggest', async (req, res) => {
  const config = modules.students;
  if (!config.roles.includes(req.user.role)) return res.status(403).json({ message: 'Access denied.' });
  const values = await getStudentAdmissionNumbers();
  res.json({ nextAdmissionNumber: nextAdmissionNumber(values) });
});

router.post('/students/:recordId/student-account', async (req, res) => {
  if (!['SYSTEM_ADMIN','HEADTEACHER'].includes(req.user.role)) return res.status(403).json({ message: 'Only school administrators can create student logins.' });
  const parsed = z.object({ email: z.string().email().transform((value) => value.trim().toLowerCase()) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Enter a valid student email address.' });
  const record = await prisma.moduleRecord.findFirst({ where: { id: req.params.recordId, module: 'students' } });
  if (!record) return res.status(404).json({ message: 'Student record not found.' });
  const email = parsed.data.email;
  const recordLink = await prisma.studentAccount.findUnique({ where: { recordId: record.id }, include: { user: true } });
  if (recordLink) {
    if (recordLink.user.email === email) return res.json({ email, linked: true, temporaryPassword: null, mustChangePassword: recordLink.user.mustChangePassword });
    return res.status(409).json({ message: 'This student record is already linked to another login.' });
  }
  let account = await prisma.user.findUnique({ where: { email } });
  let temporaryPassword = null;
  if (account && account.role !== 'STUDENT') return res.status(409).json({ message: 'That email belongs to a non-student account.' });
  if (!account) {
    temporaryPassword = randomBytes(12).toString('base64url');
    account = await prisma.user.create({ data: { name: String(record.data?.['Full name'] || record.title).toUpperCase(), email, role: 'STUDENT', passwordHash: await bcrypt.hash(temporaryPassword, 12), mustChangePassword: true } });
  }
  const existingLink = await prisma.studentAccount.findUnique({ where: { userId: account.id } });
  if (existingLink && existingLink.recordId !== record.id) return res.status(409).json({ message: 'This student login is already linked to another student.' });
  if (!existingLink) await prisma.studentAccount.create({ data: { userId: account.id, recordId: record.id } });
  await prisma.auditLog.create({ data: { userId: req.user.id, action: 'LINK_STUDENT_ACCOUNT', entity: 'students', entityId: record.id } });
  res.status(existingLink ? 200 : 201).json({ email, linked: true, temporaryPassword, mustChangePassword: Boolean(temporaryPassword) });
});

router.post('/students/:recordId/photo', async (req, res) => {
  if (req.user.role === 'BURSAR') return res.status(403).json({ message: 'Bursar student access is read-only.' });
  if (req.user.role === 'STUDENT') {
    const link = await prisma.studentAccount.findUnique({ where: { userId: req.user.id } });
    if (!link || link.recordId !== req.params.recordId) return res.status(403).json({ message: 'You can only upload a photo to your own student record.' });
  } else if (!modules.students.roles.includes(req.user.role)) return res.status(403).json({ message: 'Access denied.' });
  const parsed = z.object({ fileName: z.string().min(1).max(180), mimeType: z.enum(['image/jpeg','image/png','image/webp']), dataBase64: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Upload a PNG, JPG, or WebP student photo.' });
  const record = await prisma.moduleRecord.findFirst({ where: { id: req.params.recordId, module: 'students' } });
  if (!record) return res.status(404).json({ message: 'Student record not found.' });
  const bytes = Buffer.from(parsed.data.dataBase64, 'base64');
  if (!bytes.length || bytes.length > 3 * 1024 * 1024) return res.status(400).json({ message: 'Student photos must be smaller than 3 MB.' });
  const photo = await prisma.studentPhoto.upsert({
    where: { recordId: record.id },
    create: { recordId: record.id, fileName: parsed.data.fileName.replace(/[\\/]/g, '_'), mimeType: parsed.data.mimeType, data: bytes },
    update: { fileName: parsed.data.fileName.replace(/[\\/]/g, '_'), mimeType: parsed.data.mimeType, data: bytes }
  });
  await prisma.auditLog.create({ data: { userId: req.user.id, action: 'UPLOAD_STUDENT_PHOTO', entity: 'students', entityId: record.id, details: { fileName: photo.fileName } } });
  res.json({ photoUrl: `/api/records/students/${record.id}/photo?v=${photo.updatedAt.getTime()}` });
});

router.get('/students/:recordId/photo', async (req, res) => {
  const record = await prisma.moduleRecord.findFirst({ where: { id: req.params.recordId, module: 'students' }, include: { photo: true } });
  if (!record?.photo) return res.status(404).json({ message: 'Student photo not found.' });
  if (req.user.role === 'STUDENT') {
    const link = await prisma.studentAccount.findUnique({ where: { userId: req.user.id } });
    if (!link || link.recordId !== record.id) return res.status(403).json({ message: 'Access denied.' });
  } else if (!modules.students.roles.includes(req.user.role)) return res.status(403).json({ message: 'Access denied.' });
  res.type(record.photo.mimeType).set('Cache-Control', 'private, no-store').send(Buffer.from(record.photo.data));
});

const bulkImportSchema = z.object({ records: z.array(z.object({ title: z.string().trim().max(180).optional(), data: z.record(z.any()) })).min(1).max(500) });
router.post('/students/import', async (req, res) => {
  const config = modules.students;
  if (!config.roles.includes(req.user.role)) return res.status(403).json({ message: 'Access denied.' });
  if (req.user.role === 'BURSAR') return res.status(403).json({ message: 'Bursar student access is read-only.' });
  const parsed = bulkImportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Upload between 1 and 500 student rows with the provided template.' });

  const prepared = parsed.data.records.map((record, index) => ({
    rowNumber: index + 2,
    title: (record.title || 'NEW STUDENT').trim().toUpperCase(),
    data: normalizeStudentData(record.data)
  }));
  const rowErrors = prepared.flatMap((record) => validateStudentData(record.data).map((message) => `Row ${record.rowNumber}: ${message}`));
  if (rowErrors.length) return res.status(400).json({ message: rowErrors.slice(0, 12).join(' '), errors: rowErrors });

  const result = await prisma.$transaction(async (tx) => {
    await lockAdmissionNumberSequence(tx);
    const values = await getStudentAdmissionNumbers(tx);
    const used = new Set(values.map(normalizeAdmissionNumber));
    const assigned = [];
    for (const record of prepared) {
      const provided = getAdmissionNumber(record.data);
      const admissionNumber = provided || nextAdmissionNumber(values);
      const normalized = normalizeAdmissionNumber(admissionNumber);
      if (used.has(normalized)) return { duplicate: true, rowNumber: record.rowNumber, admissionNumber, nextAdmissionNumber: nextAdmissionNumber(values) };
      used.add(normalized);
      values.push(admissionNumber);
      record.data[ADMISSION_NUMBER_FIELD] = admissionNumber;
      const created = await tx.moduleRecord.create({ data: { module: 'students', title: record.title || 'NEW STUDENT', data: record.data, createdById: req.user.id } });
      assigned.push(created);
    }
    await tx.auditLog.createMany({ data: assigned.map((record) => ({ userId: req.user.id, action: 'CREATE', entity: 'students', entityId: record.id })) });
    return { records: assigned };
  });
  if (result.duplicate) return res.status(409).json({ message: `Row ${result.rowNumber}: admission number ${result.admissionNumber} is already in use. The next available number is ${result.nextAdmissionNumber}.`, nextAdmissionNumber: result.nextAdmissionNumber });
  res.status(201).json({ imported: result.records.length, records: result.records });
});

router.get('/:module', async (req, res) => {
  const config = modules[req.params.module];
  if (!config) return res.status(404).json({ message: 'Unknown module.' });
  if (req.user.role === 'STUDENT') {
    const link = await prisma.studentAccount.findUnique({ where: { userId: req.user.id }, include: { record: true } });
    if (!link) return res.status(403).json({ message: 'Your student account is not linked to a school record. Contact the school office.' });
    if (req.params.module === 'students') return res.json({ module: config, records: [link.record] });
    if (req.params.module === 'examinations') {
      const admissionNumber = normalizeAdmissionNumber(getAdmissionNumber(link.record.data));
      const rows = await prisma.moduleRecord.findMany({ where: { module: 'examinations' }, orderBy: { updatedAt: 'desc' }, take: 500 });
      const records = rows.filter((row) => Object.entries(row.data || {}).some(([key, value]) => /student admission number|admission number/i.test(key) && normalizeAdmissionNumber(value) === admissionNumber));
      return res.json({ module: config, records });
    }
    return res.status(403).json({ message: 'Student accounts can only view their own profile and results.' });
  }
  if (!config.roles.includes(req.user.role)) return res.status(403).json({ message: 'Access denied.' });
  const rows = await prisma.moduleRecord.findMany({ where: { module: req.params.module }, orderBy: { updatedAt: 'desc' }, take: req.params.module === 'students' ? 2000 : req.params.module === 'examinations' ? 500 : 200, ...(req.params.module === 'students' ? { include: { photo: { select: { updatedAt: true } } } } : {}) });
  let moduleConfig = config;
  if (req.params.module === 'examinations') {
    const teachers = await prisma.user.findMany({ where: { role: 'TEACHER', isActive: true }, select: { name: true }, orderBy: { name: 'asc' }, take: 300 });
    moduleConfig = { ...config, options: { ...config.options, 'Assigned teacher': teachers.map((teacher) => teacher.name) } };
  }
  res.json({ module: moduleConfig, records: rows });
});
router.post('/:module', async (req, res) => {
  const config = modules[req.params.module];
  if (!config) return res.status(404).json({ message: 'Unknown module.' });
  if (!config.roles.includes(req.user.role)) return res.status(403).json({ message: 'Access denied.' });
  if (req.params.module === 'students' && req.user.role === 'BURSAR') return res.status(403).json({ message: 'Bursar student access is read-only.' });
  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'A title and record data are required.' });
  if(req.params.module==='payments'){
    const data=parsed.data.data||{};const admission=String(data['Student admission number']||data['Admission number']||'').trim().toUpperCase();const students=await prisma.moduleRecord.findMany({where:{module:'students'},select:{id:true,data:true}});const student=students.find(item=>String(item.data?.['Admission number']||'').trim().toUpperCase()===admission);if(!student)return res.status(400).json({message:'Choose a student with a registered admission number.'});const method=normalizeChannel(data.Method||data['Payment method']);const reference=String(data['Transaction code']||data.Reference||data['Receipt number']||'').trim();const legacyIdempotency='legacy-'+createHash('sha256').update(JSON.stringify({userId:req.user.id,admission,method,amount:data['Amount (KES)']??data.Amount,reference,date:data.Date||'',title:parsed.data.title})).digest('hex');try{const result=await createStagedPayment({school:await ensureSchoolAndChart(),userId:req.user.id,recordTitle:parsed.data.title,input:{studentRecordId:student.id,channel:method,transactionCode:reference,amount:Number(data['Amount (KES)']??data.Amount??0),cashAmount:data['Cash amount']!==undefined?Number(data['Cash amount']):undefined,cashbook:'BANK',allocation:String(data['Fee type']||'TUITION').toUpperCase(),item:String(data['In-kind item']||'').toUpperCase().replace(/ /g,'_')||undefined,quantity:data.Quantity?Number(data.Quantity):undefined,unit:data.Unit,unitValue:data['Unit value (KES)']!==undefined?Number(data['Unit value (KES)']):undefined,deliveryReference:data['Delivery note reference'],explanation:data.Explanation||data['Payment explanation'],idempotencyKey:legacyIdempotency}});if(result.conflict)return res.status(409).json({message:'Payment collision detected. It was not posted; check Payment Verification and follow-up alerts.',payment:result.payment,concern:result.concern});const row=await prisma.moduleRecord.findUnique({where:{id:result.payment.paymentRecordId}});return res.status(result.idempotent?200:201).json({record:row,payment:result.payment,accounting:{posted:false,message:'Payment is staged and must be verified before it changes the ledger or student balance.'}});}catch(error){return res.status(error.status||400).json({message:error.message||'Payment could not be staged.'});}
  }
  let row;
  if (req.params.module === 'students') {
    const studentData = normalizeStudentData(parsed.data.data);
    const validationErrors = validateStudentData(studentData);
    if (validationErrors.length) return res.status(400).json({ message: validationErrors.join(' ') });
    const title = parsed.data.title.toUpperCase();
    const result = await prisma.$transaction(async (tx) => {
      await lockAdmissionNumberSequence(tx);
      const values = await getStudentAdmissionNumbers(tx);
      const data = { ...studentData };
      const submitted = getAdmissionNumber(data);
      const admissionNumber = submitted || nextAdmissionNumber(values);
      if (values.some((value) => normalizeAdmissionNumber(value) === normalizeAdmissionNumber(admissionNumber))) {
        return { duplicate: true, nextAdmissionNumber: nextAdmissionNumber(values) };
      }
      data[ADMISSION_NUMBER_FIELD] = admissionNumber;
      const created = await tx.moduleRecord.create({ data: { module: req.params.module, title, data, createdById: req.user.id } });
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'CREATE', entity: req.params.module, entityId: created.id, details:{title:created.title,fields:Object.keys(created.data||{})} } });
      return { row: created };
    });
    if (result.duplicate) return res.status(409).json({ message: `Admission number ${getAdmissionNumber(parsed.data.data)} is already in use. The next available number is ${result.nextAdmissionNumber}.`, nextAdmissionNumber: result.nextAdmissionNumber });
    row = result.row;
  } else {
    row = await prisma.moduleRecord.create({ data: { module: req.params.module, ...parsed.data, createdById: req.user.id } });
    await prisma.auditLog.create({ data: { userId: req.user.id, action: 'CREATE', entity: req.params.module, entityId: row.id, details:{title:row.title,fields:Object.keys(row.data||{})} } });
  }
  let accounting=null;
  if(['fees','payments','expenses'].includes(req.params.module)){
    try{accounting=await autoPostFinanceRecord(row,req.params.module,req.user.id);if(accounting&&!accounting.posted)await prisma.notification.create({data:{targetRole:'BURSAR',severity:'WARNING',title:'Financial record needs accounting review',message:`${row.title}: ${accounting.message}`,entity:req.params.module,entityId:row.id}});}
    catch(error){accounting={posted:false,message:`Record saved, but the ledger posting failed: ${error.message}`};await prisma.notification.create({data:{targetRole:'BURSAR',severity:'HIGH',title:'Financial record was not posted',message:`${row.title}: ${accounting.message}`,entity:req.params.module,entityId:row.id}});}
  }
  res.status(201).json({ record: row, accounting });
});
router.patch('/:module/:id', async (req, res) => {
  const config = modules[req.params.module];
  if (!config) return res.status(404).json({ message: 'Unknown module.' });
  if (!config.roles.includes(req.user.role)) return res.status(403).json({ message: 'Access denied.' });
  if (req.params.module === 'students' && req.user.role === 'BURSAR') return res.status(403).json({ message: 'Bursar student access is read-only.' });
  const parsed = payloadSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid record data.' });
  const existing = await prisma.moduleRecord.findFirst({ where: { id: req.params.id, module: req.params.module } });
  if (!existing) return res.status(404).json({ message: 'Record not found.' });
  if (['fees','payments','expenses'].includes(req.params.module)) {
    const managed=await findManagedPayment(existing,req.params.module);if(managed)return res.status(409).json({message:`This payment is managed by verification (${managed.status}). Resolve or verify it in Payment Verification before making a correction.`});
    const posted=await findPostedFinancialJournal(existing,req.params.module);
    if(posted)return res.status(409).json({message:`This transaction is posted as journal ${posted.entryNumber}. Correct it with a reversal in Accounting before changing the source record.`});
  }
  let row;
  if (req.params.module === 'students' && parsed.data.data) {
    const studentData = normalizeStudentData({ ...existing.data, ...parsed.data.data });
    const validationErrors = validateStudentData(studentData);
    if (validationErrors.length) return res.status(400).json({ message: validationErrors.join(' ') });
    const updateData = { ...parsed.data, ...(parsed.data.title ? { title: parsed.data.title.toUpperCase() } : {}), data: studentData };
    const result = await prisma.$transaction(async (tx) => {
      await lockAdmissionNumberSequence(tx);
      const values = await getStudentAdmissionNumbers(tx, existing.id);
      const proposed = getAdmissionNumber(studentData);
      const duplicate = proposed && values.some((value) => normalizeAdmissionNumber(value) === normalizeAdmissionNumber(proposed));
      if (duplicate) return { duplicate: true };
      const updated = await tx.moduleRecord.update({ where: { id: existing.id }, data: updateData });
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'UPDATE', entity: req.params.module, entityId: updated.id, details:{fields:Object.keys(parsed.data.data||{}),titleChanged:Boolean(parsed.data.title)} } });
      return { row: updated };
    });
    if (result.duplicate) return res.status(409).json({ message: `Admission number ${getAdmissionNumber(parsed.data.data)} is already in use.` });
    row = result.row;
  } else {
    row = await prisma.moduleRecord.update({ where: { id: existing.id }, data: parsed.data });
    await prisma.auditLog.create({ data: { userId: req.user.id, action: 'UPDATE', entity: req.params.module, entityId: row.id, details:{fields:Object.keys(parsed.data.data||{}),titleChanged:Boolean(parsed.data.title)} } });
  }
  let accounting=null;
  if(['fees','payments','expenses'].includes(req.params.module)){
    try{accounting=await autoPostFinanceRecord(row,req.params.module,req.user.id);if(accounting&&!accounting.posted)await prisma.notification.create({data:{targetRole:'BURSAR',severity:'WARNING',title:'Financial record needs accounting review',message:`${row.title}: ${accounting.message}`,entity:req.params.module,entityId:row.id}});}
    catch(error){accounting={posted:false,message:`Record saved, but the ledger posting failed: ${error.message}`};await prisma.notification.create({data:{targetRole:'BURSAR',severity:'HIGH',title:'Financial record was not posted',message:`${row.title}: ${accounting.message}`,entity:req.params.module,entityId:row.id}});}
  }
  res.json({ record: row, accounting });
});
router.delete('/:module/:id', async (req, res) => {
  const config = modules[req.params.module];
  if (!config) return res.status(404).json({ message: 'Unknown module.' });
  if (!['SYSTEM_ADMIN','HEADTEACHER'].includes(req.user.role)) return res.status(403).json({ message: 'Only administrators can delete records.' });
  const existing = await prisma.moduleRecord.findFirst({ where: { id: req.params.id, module: req.params.module } });
  if (!existing) return res.status(404).json({ message: 'Record not found.' });
  if (['fees','payments','expenses'].includes(req.params.module)) {
    const managed=await findManagedPayment(existing,req.params.module);if(managed)return res.status(409).json({message:`This payment is managed by verification (${managed.status}) and cannot be deleted here.`});
    const posted=await findPostedFinancialJournal(existing,req.params.module);
    if(posted)return res.status(409).json({message:`This transaction is posted as journal ${posted.entryNumber}. Reverse the journal before attempting a correction.`});
  }
  await prisma.moduleRecord.delete({ where: { id: existing.id } });
  await prisma.auditLog.create({ data: { userId: req.user.id, action: 'DELETE', entity: req.params.module, entityId: existing.id, details:{title:existing.title,fields:Object.keys(existing.data||{})} } });
  res.json({ message: 'Record deleted.' });
});
export default router;
