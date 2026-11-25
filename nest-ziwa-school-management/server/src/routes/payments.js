import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ensureSchoolAndChart, postBalancedEntry } from './accounting.js';
import { createStagedPayment, IN_KIND_ITEMS, ITEM_UNITS, notifyPaymentConcern, PAYMENT_CHANNELS } from '../services/paymentService.js';

const router=Router();
const financeRoles=['SYSTEM_ADMIN','HEADTEACHER','BURSAR','DIRECTOR'];
function authorize(req,res,next){if(!financeRoles.includes(req.user.role))return res.status(403).json({message:'Finance access denied.'});next();}
router.use(authorize);

async function paymentSchool(req,requested=''){
  if(req.user.role!=='DIRECTOR')return ensureSchoolAndChart();
  const schoolId=String(requested||req.query.schoolId||req.body.schoolId||'');
  const links=await prisma.schoolLink.findMany({where:{directorId:req.user.id},include:{school:true}});
  if(schoolId){const link=links.find(item=>item.schoolId===schoolId);if(!link)throw Object.assign(new Error('You can only access schools linked to your director account.'),{status:403});return link.school;}
  if(links.length===1)return links[0].school;
  throw Object.assign(new Error('Choose a linked school first.'),{status:400});
}
function handleError(res,error){res.status(error.status||500).json({message:error.message||'The payment request could not be completed.'});}
function itemUnitValid(item,unit){return !item||!unit||ITEM_UNITS[item]?.includes(unit);}

router.get('/class-parent-contacts',async(req,res)=>{
  const className=String(req.query.className||'').trim().toUpperCase();if(!className)return res.status(400).json({message:'Choose a class first.'});
  try{const students=await prisma.moduleRecord.findMany({where:{module:'students'},select:{data:true}});const roster=students.filter(row=>String(row.data?.Class||'').trim().toUpperCase()===className).map(row=>({admissionNumber:String(row.data?.['Admission number']||'').trim().toUpperCase(),studentName:row.data?.['Full name']||row.title,className})).filter(row=>row.admissionNumber);const admissions=new Set(roster.map(row=>row.admissionNumber));const guardians=await prisma.moduleRecord.findMany({where:{module:'guardians'},select:{title:true,data:true}});const contacts=guardians.flatMap(row=>{const data=row.data||{},admission=String(data['Student admission number']||data['Admission number']||'').trim().toUpperCase();if(!admissions.has(admission))return[];let phone=String(data['WhatsApp number']||data.Phone||data['Phone number']||'').replace(/[^0-9]/g,'');if(phone.startsWith('0'))phone=`254${phone.slice(1)}`;else if(phone.length===9&&phone.startsWith('7'))phone=`254${phone}`;return[{studentName:roster.find(student=>student.admissionNumber===admission)?.studentName||'',admissionNumber:admission,className,guardianName:data['Full name']||row.title,phone,email:data.Email||'',whatsappUrl:phone?`https://wa.me/${phone}`:''}];});const settings=await prisma.schoolAsset.findUnique({where:{key:'whatsapp-settings'}});const whatsApp=settings?JSON.parse(Buffer.from(settings.data).toString('utf8')):{schoolNumber:'',classInviteLinks:{}};res.json({className,contacts,groupInviteLink:whatsApp.classInviteLinks?.[className]||'',schoolNumber:whatsApp.schoolNumber||''});}catch(error){handleError(res,error);}
});

router.get('/',async(req,res)=>{
  try{const school=await paymentSchool(req);const where={schoolId:school.id};if(req.query.status)where.status=String(req.query.status);if(req.query.className)where.className=String(req.query.className).toUpperCase();if(req.query.item)where.item=String(req.query.item).toUpperCase();
    const [payments,concerns]=await Promise.all([prisma.paymentTransaction.findMany({where,include:{studentRecord:{select:{title:true,data:true}},paymentRecord:{select:{id:true,title:true}},concerns:{where:{status:'OPEN'},orderBy:{createdAt:'desc'},take:5}},orderBy:{createdAt:'desc'},take:500}),prisma.paymentConcern.count({where:{schoolId:school.id,status:'OPEN'}})]);
    res.json({school,payments,openConcerns:concerns});
  }catch(error){handleError(res,error);}
});

router.post('/',async(req,res)=>{
  const parsed=z.object({
    schoolId:z.string().optional(),studentRecordId:z.string().optional(),admissionNumber:z.string().trim().max(80).optional(),
    channel:z.enum(PAYMENT_CHANNELS),allocation:z.enum(['TUITION','TRANSPORT','OTHER_FEES']).default('TUITION'),transactionCode:z.string().trim().max(120).optional(),idempotencyKey:z.string().trim().min(8).max(160),
    amount:z.number().nonnegative().optional(),cashAmount:z.number().nonnegative().optional(),cashbook:z.enum(['MAIN','PETTY','BANK']).optional(),
    item:z.enum(IN_KIND_ITEMS).optional(),quantity:z.number().positive().optional(),unit:z.string().trim().max(20).optional(),
    unitValue:z.number().nonnegative().optional(),deliveryReference:z.string().trim().max(140).optional(),explanation:z.string().trim().max(1000).optional()
  }).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:'Provide a student, payment channel, idempotency key, and valid amounts or item quantities.'});
  try{
    const school=await paymentSchool(req,parsed.data.schoolId);
    let studentRecordId=parsed.data.studentRecordId;
    if(!studentRecordId&&parsed.data.admissionNumber){const rows=await prisma.moduleRecord.findMany({where:{module:'students'},select:{id:true,data:true}});studentRecordId=rows.find(row=>String(row.data?.['Admission number']||'').trim().toUpperCase()===parsed.data.admissionNumber.toUpperCase())?.id;}
    const result=await createStagedPayment({school,userId:req.user.id,input:{...parsed.data,studentRecordId}});
    if(result.conflict)return res.status(409).json({message:'Payment collision detected. It was not posted; administration follow-up has been opened.',payment:result.payment,concern:result.concern});
    res.status(result.idempotent?200:201).json({payment:result.payment,concern:result.concern||null,idempotent:Boolean(result.idempotent)});
  }catch(error){
    if(error.code==='P2002'){
      try{const school=await paymentSchool(req,parsed.data.schoolId);const result=await createStagedPayment({school,userId:req.user.id,input:parsed.data});if(result.conflict)return res.status(409).json({message:'Payment collision detected. It was not posted; administration follow-up has been opened.',payment:result.payment,concern:result.concern});if(result.idempotent)return res.json({payment:result.payment,idempotent:true});}catch(retryError){return handleError(res,retryError);}
    }
    handleError(res,error);
  }
});

router.get('/concerns',async(req,res)=>{
  try{const school=await paymentSchool(req);const concerns=await prisma.paymentConcern.findMany({where:{schoolId:school.id,...(req.query.status?{status:String(req.query.status)}:{status:'OPEN'})},include:{payment:{select:{id:true,admissionNumber:true,className:true,channel:true,transactionCode:true,status:true,amount:true,cashAmount:true}},createdBy:{select:{name:true,role:true}},resolvedBy:{select:{name:true,role:true}}},orderBy:{createdAt:'desc'},take:500});res.json({concerns});}catch(error){handleError(res,error);}
});

router.post('/concerns/:id/resolve',async(req,res)=>{
  const parsed=z.object({action:z.enum(['RESOLVE','CANCEL_PAYMENT']).default('RESOLVE'),note:z.string().trim().min(3).max(1000),transactionCode:z.string().trim().max(120).optional()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:'Add a resolution note and choose whether to resolve the concern or cancel its unverified payment.'});
  try{const school=await paymentSchool(req);const concern=await prisma.paymentConcern.findFirst({where:{id:req.params.id,schoolId:school.id},include:{payment:true}});if(!concern)return res.status(404).json({message:'Payment concern not found.'});if(concern.status==='RESOLVED')return res.status(409).json({message:'This concern has already been resolved.'});
    if(concern.payment?.status==='VERIFIED_BALANCED'&&parsed.data.action==='CANCEL_PAYMENT')return res.status(409).json({message:'A verified payment cannot be cancelled here. Post a reversal in Accounting.'});
    if(concern.payment&&parsed.data.transactionCode){const code=parsed.data.transactionCode.toUpperCase();const duplicate=await prisma.paymentTransaction.findFirst({where:{schoolId:school.id,channel:concern.payment.channel,transactionCode:code,id:{not:concern.payment.id}}});if(duplicate){await notifyPaymentConcern({schoolId:school.id,paymentId:duplicate.id,channel:concern.payment.channel,transactionCode:code,reason:`Resolution attempt reused transaction code ${code}, which is already attached to another payment.`,createdById:req.user.id,title:'Payment reference collision during follow-up'});return res.status(409).json({message:'That transaction code is already in use. The payment remains unverified.'});}}
    const action=parsed.data.action;
    const updated=await prisma.$transaction(async tx=>{
      if(concern.payment){
        const paymentData={...(concern.payment.paymentRecordId?(await tx.moduleRecord.findUnique({where:{id:concern.payment.paymentRecordId}}))?.data||{}:{})};
        const cancelled=action==='CANCEL_PAYMENT';
        const nextStatus=cancelled?'CANCELLED':concern.payment.status==='CONCERN'?'PENDING_VERIFICATION':concern.payment.status;
        if(parsed.data.transactionCode)paymentData['Transaction code']=parsed.data.transactionCode.toUpperCase();
        paymentData['Verification status']=nextStatus;paymentData.Status=cancelled?'CANCELLED':'PENDING VERIFICATION';
        if(concern.payment.paymentRecordId)await tx.moduleRecord.update({where:{id:concern.payment.paymentRecordId},data:{data:paymentData}});
        await tx.paymentTransaction.update({where:{id:concern.payment.id},data:{status:nextStatus,concern:cancelled?'Payment cancelled during administration follow-up.':'Concern resolved; payment remains pending verification.',...(parsed.data.transactionCode?{transactionCode:parsed.data.transactionCode.toUpperCase()}:{}),...(cancelled?{statementReference:null,statementAmount:null,verifiedQuantity:null}:{})}});
      }
      const resolved=await tx.paymentConcern.update({where:{id:concern.id},data:{status:'RESOLVED',resolvedById:req.user.id,resolutionNote:parsed.data.note,resolvedAt:new Date()}});
      await tx.auditLog.create({data:{userId:req.user.id,action:action==='CANCEL_PAYMENT'?'CANCEL_STAGED_PAYMENT':'RESOLVE_PAYMENT_CONCERN',entity:'PaymentConcern',entityId:concern.id,details:{paymentId:concern.paymentId,note:parsed.data.note}}});
      return resolved;
    });res.json({concern:updated});
  }catch(error){handleError(res,error);}
});

router.post('/:id/verify',async(req,res)=>{
  const parsed=z.object({schoolId:z.string().optional(),transactionCode:z.string().trim().max(120).optional(),statementReference:z.string().trim().max(140).optional(),statementAmount:z.number().nonnegative().optional(),verifiedQuantity:z.number().positive().optional(),verificationNote:z.string().trim().max(1000).optional(),explanation:z.string().trim().max(1000).optional()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:'Enter valid statement amounts, received quantities, references, or verification notes.'});
  try{
    const school=await paymentSchool(req,parsed.data.schoolId);const payment=await prisma.paymentTransaction.findFirst({where:{id:req.params.id,schoolId:school.id},include:{studentRecord:true,paymentRecord:true}});if(!payment)return res.status(404).json({message:'Payment not found.'});if(payment.status==='VERIFIED_BALANCED')return res.status(409).json({message:'This payment is already verified and protected from duplicate posting.'});if(['CANCELLED','REVERSED'].includes(payment.status))return res.status(409).json({message:'Cancelled or reversed payments cannot be verified.'});
    const transactionCode=String(parsed.data.transactionCode||payment.transactionCode||'').trim().toUpperCase()||null;const statementReference=String(parsed.data.statementReference||'').trim().toUpperCase()||null;
    const explanation=String(parsed.data.explanation||payment.explanation||'').trim();
    const issues=[];
    if(['MPESA_PAYBILL','AIRTEL_MONEY','CHEQUE','BANK_TRANSFER'].includes(payment.channel)&&!transactionCode)issues.push('Enter the transaction code/reference before verification.');if(['MPESA_PAYBILL','AIRTEL_MONEY','CHEQUE','BANK_TRANSFER'].includes(payment.channel)&&!statementReference)issues.push('Enter the matching bank, mobile money, or cheque statement reference.');
    if(payment.channel==='OTHER'&&!explanation)issues.push('Other payment explanation is still required.');
    if(payment.channel==='IN_KIND'&&!payment.item)issues.push('Select the in-kind item before verification.');
    const expectsStatement=payment.item?Number(payment.cashAmount)>0:Number(payment.amount)>0;
    if(expectsStatement&&parsed.data.statementAmount===undefined)issues.push('Enter the amount confirmed from the receipt or bank statement.');
    const expectedStatement=payment.item?Number(payment.cashAmount):Number(payment.amount);
    if(parsed.data.statementAmount!==undefined&&Math.abs(parsed.data.statementAmount-expectedStatement)>0.01)issues.push(`Statement amount ${parsed.data.statementAmount.toFixed(2)} does not match the expected cash/bank amount ${expectedStatement.toFixed(2)}.`);
    if(payment.item){
      if(!payment.deliveryReference)issues.push('Enter the delivery note reference before verifying the item.');
      if(parsed.data.verifiedQuantity===undefined)issues.push('Enter the quantity physically received.');
      else if(Math.abs(parsed.data.verifiedQuantity-Number(payment.quantity||0))>0.001)issues.push(`Received quantity ${parsed.data.verifiedQuantity} ${payment.unit} does not match the pledged payment quantity ${Number(payment.quantity||0)} ${payment.unit}.`);
    }
    if(payment.channel==='CASH'&&!parsed.data.verificationNote&&!payment.transactionCode)issues.push('Add the cash receipt or counting note.');
    if(transactionCode){const duplicate=await prisma.paymentTransaction.findFirst({where:{schoolId:school.id,channel:payment.channel,transactionCode,id:{not:payment.id}}});if(duplicate)issues.push(`Transaction code ${transactionCode} is already used by another ${payment.channel} payment.`);}let matchedBankTransaction=null;if(statementReference||transactionCode){const refs=[...new Set([statementReference,transactionCode].filter(Boolean))];matchedBankTransaction=await prisma.bankTransaction.findFirst({where:{schoolId:school.id,OR:refs.flatMap(reference=>[{reference},{externalId:reference}])}});if(matchedBankTransaction){const bankAmount=payment.item?Number(payment.cashAmount):Number(payment.amount);if(Math.abs(Number(matchedBankTransaction.amount)-bankAmount)>0.01)issues.push(`Imported bank amount ${Number(matchedBankTransaction.amount).toFixed(2)} does not match the payment cash/bank amount ${bankAmount.toFixed(2)}.`);if(matchedBankTransaction.admissionNumber&&String(matchedBankTransaction.admissionNumber).trim().toUpperCase()!==payment.admissionNumber)issues.push('Imported bank statement admission number does not match the selected student.');if(matchedBankTransaction.journalEntryId)issues.push('This bank statement row has already been posted; review it in Bank reconciliation before verifying again.');}}
    if(issues.length){const reason=issues.join(' ');const saved=await prisma.paymentTransaction.update({where:{id:payment.id},data:{status:issues.some(issue=>issue.includes('does not match')||issue.includes('already used'))?'UNBALANCED':'CONCERN',concern:reason,transactionCode,...(statementReference?{statementReference}:{}),...(parsed.data.statementAmount!==undefined?{statementAmount:new Prisma.Decimal(parsed.data.statementAmount)}:{}),...(parsed.data.verifiedQuantity!==undefined?{verifiedQuantity:new Prisma.Decimal(parsed.data.verifiedQuantity)}:{}),...(explanation?{explanation}:{}),...(parsed.data.verificationNote?{verificationNote:parsed.data.verificationNote}:{})}});if(payment.paymentRecordId)await prisma.moduleRecord.update({where:{id:payment.paymentRecordId},data:{data:{...(payment.paymentRecord?.data||{}),'Transaction code':transactionCode||'','Verification status':saved.status,Status:'FOLLOW-UP REQUIRED'}}});await notifyPaymentConcern({schoolId:school.id,paymentId:payment.id,channel:payment.channel,transactionCode,reason,createdById:req.user.id,title:'Payment mismatch needs follow-up'});await prisma.auditLog.create({data:{userId:req.user.id,action:'FLAG_PAYMENT_MISMATCH',entity:'PaymentTransaction',entityId:payment.id,details:{status:saved.status,issues}}});return res.status(409).json({message:reason,payment:saved});}

    const result=await prisma.$transaction(async tx=>{
      let journal=null;const amount=Number(payment.amount),cashAmount=payment.item?Number(payment.cashAmount):amount;
      if(amount>0){
        const accounts=await tx.ledgerAccount.findMany({where:{schoolId:school.id,code:{in:['1000','1020','1100','1200']},active:true}});const byCode=new Map(accounts.map(account=>[account.code,account]));const receivable=byCode.get('1100');if(!receivable)throw Object.assign(new Error('Fees Receivable account is missing from the school chart.'),{status:400});
        const lines=[];
        if(payment.item&&Number(payment.inKindValue)>0){const inventory=byCode.get('1200');if(!inventory)throw Object.assign(new Error('In-kind Inventory account is missing from the school chart.'),{status:400});lines.push({accountId:inventory.id,debit:Number(payment.inKindValue),memo:`${payment.item} contribution`});}
        if(cashAmount>0){const cashCode=payment.channel==='CASH'?'1000':'1020',cash=byCode.get(cashCode);if(!cash)throw Object.assign(new Error('Cash/bank account is missing from the school chart.'),{status:400});lines.push({accountId:cash.id,debit:cashAmount,cashbook:payment.channel==='CASH'?'MAIN':'BANK'});}
        lines.push({accountId:receivable.id,credit:amount,memo:`Admission ${payment.admissionNumber}`});
        journal=await postBalancedEntry(tx,{school,description:`Verified ${payment.channel} fee payment ${transactionCode||payment.id}`,sourceType:'STUDENT_PAYMENT',sourceId:payment.id,createdById:req.user.id,transactionDate:payment.createdAt,lines});if(matchedBankTransaction){await tx.bankTransaction.update({where:{id:matchedBankTransaction.id},data:{status:'POSTED',conflictReason:null,resolvedAt:new Date(),journalEntryId:journal.id}});await tx.auditLog.create({data:{userId:req.user.id,action:'MATCH_BANK_STATEMENT_TO_PAYMENT',entity:'BankTransaction',entityId:matchedBankTransaction.id,details:{paymentId:payment.id,journalEntryId:journal.id}}});}
      }
      const paymentData={...(payment.paymentRecord?.data||{}),'Transaction code':transactionCode||'','Reference':statementReference||transactionCode||payment.deliveryReference||'','Verification status':'VERIFIED_BALANCED',Status:'PAID','Verification note':parsed.data.verificationNote||'','Fee type':payment.allocation};
      if(payment.paymentRecordId)await tx.moduleRecord.update({where:{id:payment.paymentRecordId},data:{data:paymentData}});
      else throw Object.assign(new Error('Linked payment record is missing.'),{status:409});
      if(payment.item){await tx.inKindMovement.create({data:{schoolId:school.id,paymentId:payment.id,studentRecordId:payment.studentRecordId,recordedById:req.user.id,admissionNumber:payment.admissionNumber,className:payment.className,item:payment.item,quantity:new Prisma.Decimal(parsed.data.verifiedQuantity),unit:payment.unit||'KG',unitValue:payment.unitValue,totalValue:new Prisma.Decimal(payment.inKindValue),receivedAt:new Date()}});}
      const saved=await tx.paymentTransaction.update({where:{id:payment.id},data:{status:'VERIFIED_BALANCED',concern:null,transactionCode,verifiedById:req.user.id,verifiedAt:new Date(),statementReference:statementReference||transactionCode,statementAmount:parsed.data.statementAmount!==undefined?new Prisma.Decimal(parsed.data.statementAmount):null,verifiedQuantity:parsed.data.verifiedQuantity!==undefined?new Prisma.Decimal(parsed.data.verifiedQuantity):null,verificationNote:parsed.data.verificationNote||null,explanation:explanation||null,journalEntryId:journal?.id||null}});
      await tx.paymentConcern.updateMany({where:{paymentId:payment.id,status:'OPEN'},data:{status:'RESOLVED',resolvedById:req.user.id,resolutionNote:parsed.data.verificationNote||'Payment verified and balanced.',resolvedAt:new Date()}});
      await tx.auditLog.create({data:{userId:req.user.id,action:'VERIFY_STUDENT_PAYMENT',entity:'PaymentTransaction',entityId:payment.id,details:{channel:payment.channel,transactionCode,amount,paymentJournalId:journal?.id||null,item:payment.item,quantity:parsed.data.verifiedQuantity}}});
      return {payment:saved,journal};
    });
    res.json(result);
  }catch(error){if(error.code==='P2002')return res.status(409).json({message:'That payment reference has already been recorded. The existing payment remains unchanged.'});handleError(res,error);}
});

router.post('/in-kind/pledges',async(req,res)=>{
  const parsed=z.object({schoolId:z.string().optional(),studentRecordId:z.string().min(1),item:z.enum(IN_KIND_ITEMS),quantity:z.number().positive(),unit:z.string().trim().min(1).max(20),unitValue:z.number().nonnegative().optional(),expectedAt:z.string().datetime().optional(),notes:z.string().trim().max(1000).optional()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:'Select a student, item, valid expected quantity, and standard unit.'});
  if(!itemUnitValid(parsed.data.item,parsed.data.unit.toUpperCase()))return res.status(400).json({message:`${parsed.data.item.replace('_',' ')} unit must be ${ITEM_UNITS[parsed.data.item].join(' or ')}.`});
  try{const school=await paymentSchool(req,parsed.data.schoolId);const student=await prisma.moduleRecord.findFirst({where:{id:parsed.data.studentRecordId,module:'students'}});if(!student)return res.status(404).json({message:'Student not found.'});const pledge=await prisma.inKindPledge.create({data:{schoolId:school.id,studentRecordId:student.id,createdById:req.user.id,admissionNumber:String(student.data?.['Admission number']||'').toUpperCase(),className:String(student.data?.Class||'').toUpperCase(),item:parsed.data.item,quantity:new Prisma.Decimal(parsed.data.quantity),unit:parsed.data.unit.toUpperCase(),unitValue:parsed.data.unitValue!==undefined?new Prisma.Decimal(parsed.data.unitValue):null,expectedAt:parsed.data.expectedAt?new Date(parsed.data.expectedAt):null,notes:parsed.data.notes||null}});await prisma.auditLog.create({data:{userId:req.user.id,action:'CREATE_IN_KIND_PLEDGE',entity:'InKindPledge',entityId:pledge.id,details:{item:pledge.item,quantity:Number(pledge.quantity),unit:pledge.unit,admissionNumber:pledge.admissionNumber}}});res.status(201).json({pledge});}catch(error){handleError(res,error);}
});

router.get('/in-kind/balances',async(req,res)=>{
  try{const school=await paymentSchool(req);const [pledges,movements]=await Promise.all([prisma.inKindPledge.findMany({where:{schoolId:school.id,status:{not:'CANCELLED'}}}),prisma.inKindMovement.findMany({where:{schoolId:school.id}})]);const groups=new Map();const add=(row,type)=>{const key=[row.item,row.className,row.admissionNumber,row.unit].join('|');const value=groups.get(key)||{item:row.item,className:row.className,admissionNumber:row.admissionNumber,unit:row.unit,expected:0,received:0,expectedValue:0,receivedValue:0};const qty=Number(row.quantity)||0,val=Number(row.unitValue||row.totalValue||0);if(type==='expected'){value.expected+=qty;value.expectedValue+=qty*Number(row.unitValue||0);}else{value.received+=qty;value.receivedValue+=Number(row.totalValue||qty*Number(row.unitValue||0));}groups.set(key,value);};pledges.forEach(row=>add(row,'expected'));movements.forEach(row=>add(row,'received'));const balances=[...groups.values()].map(row=>({...row,balance:row.expected-row.received,valueBalance:row.expectedValue-row.receivedValue}));const stock=IN_KIND_ITEMS.map(item=>{const rows=movements.filter(row=>row.item===item);return{item,byUnit:[...new Set(rows.map(row=>row.unit))].map(unit=>({unit,received:rows.filter(row=>row.unit===unit).reduce((sum,row)=>sum+Number(row.quantity),0),value:rows.filter(row=>row.unit===unit).reduce((sum,row)=>sum+Number(row.totalValue),0)}))};});res.json({school,items:IN_KIND_ITEMS,balances,stock});}catch(error){handleError(res,error);}
});

router.get('/student-ledger/:admissionNumber',async(req,res)=>{
  try{const school=await paymentSchool(req);const admission=String(req.params.admissionNumber).trim().toUpperCase();const students=await prisma.moduleRecord.findMany({where:{module:'students'},select:{id:true,title:true,data:true}});const student=students.find(row=>String(row.data?.['Admission number']||'').trim().toUpperCase()===admission);if(!student)return res.status(404).json({message:'Student not found.'});const [rows,payments,pledges,movements,guardians,assignments]=await Promise.all([prisma.moduleRecord.findMany({where:{module:{in:['fees','payments']}}}),prisma.paymentTransaction.findMany({where:{schoolId:school.id,admissionNumber:admission},orderBy:{createdAt:'desc'}}),prisma.inKindPledge.findMany({where:{schoolId:school.id,admissionNumber:admission,status:{not:'CANCELLED'}}}),prisma.inKindMovement.findMany({where:{schoolId:school.id,admissionNumber:admission}}),prisma.moduleRecord.findMany({where:{module:'guardians'}}),prisma.transportAssignment.findMany({where:{schoolId:school.id,studentRecordId:student.id,status:'ACTIVE'},select:{feeAmount:true}})]);const studentRows=rows.filter(row=>String(row.data?.['Student admission number']||row.data?.['Admission number']||'').trim().toUpperCase()===admission);let fees=0,paid=0,transportFees=0,transportPaid=0;for(const row of studentRows){const data=row.data||{},amount=Number(data['Amount (KES)']??data.Amount??0);if(!Number.isFinite(amount))continue;const transport=`${row.title} ${data.Category||''} ${data['Fee type']||''}`.toUpperCase().includes('TRANSPORT');if(row.module==='fees'&&!['CANCELLED','WAIVED'].includes(String(data.Status||'').toUpperCase())){fees+=amount;if(transport)transportFees+=amount;}if(row.module==='payments'){const verification=data['Verification status'],paymentStatus=String(data.Status||'').toUpperCase();if((verification&&verification!=='VERIFIED_BALANCED')||['CANCELLED','VOID','REVERSED','REJECTED'].includes(paymentStatus))continue;paid+=amount;if(transport)transportPaid+=amount;}}if(transportFees===0){transportFees=assignments.reduce((sum,row)=>sum+Number(row.feeAmount),0);fees+=transportFees;}
    const itemBalances=IN_KIND_ITEMS.map(item=>{const expected=pledges.filter(row=>row.item===item),received=movements.filter(row=>row.item===item);const units=[...new Set([...expected.map(row=>row.unit),...received.map(row=>row.unit)])];return{item,units:units.map(unit=>({unit,pledged:expected.filter(row=>row.unit===unit).reduce((s,row)=>s+Number(row.quantity),0),received:received.filter(row=>row.unit===unit).reduce((s,row)=>s+Number(row.quantity),0),value:received.filter(row=>row.unit===unit).reduce((s,row)=>s+Number(row.totalValue),0)}))};});const parentRecords=guardians.filter(row=>String(row.data?.['Student admission number']||'').trim().toUpperCase()===admission).map(row=>({name:row.data?.['Full name']||row.title,phone:row.data?.Phone||row.data?.['Phone number']||'',email:row.data?.Email||''}));res.json({school,student,fees,paid,balance:fees-paid,transportFees,transportPaid,transportBalance:transportFees-transportPaid,itemBalances,payments,verifiedHistory:studentRows.filter(row=>row.module==='payments'),parents:parentRecords});
  }catch(error){handleError(res,error);}
});

export default router;
