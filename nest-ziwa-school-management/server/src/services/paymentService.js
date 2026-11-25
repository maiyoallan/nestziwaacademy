import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../db.js';

export const ADMIN_FOLLOWUP_ROLES = ['BURSAR','HEADTEACHER','SYSTEM_ADMIN','DIRECTOR'];
export const PAYMENT_CHANNELS = ['MPESA_PAYBILL','AIRTEL_MONEY','CHEQUE','BANK_TRANSFER','CASH','IN_KIND','OTHER'];
export const IN_KIND_ITEMS = ['MAIZE','BEANS','MILLET','REAM_PAPER'];
export const ITEM_UNITS = { MAIZE:['KG','SACK'], BEANS:['KG','SACK'], MILLET:['KG','SACK'], REAM_PAPER:['REAM','BOX'] };

export function normalizeChannel(value='') {
  const key=String(value).trim().toUpperCase().replace(/[ -]+/g,'_');
  const aliases={MPESA:'MPESA_PAYBILL',M_PESA:'MPESA_PAYBILL',M_PESA_PAYBILL:'MPESA_PAYBILL',AIRTEL:'AIRTEL_MONEY',AIRTEL_MONEY:'AIRTEL_MONEY',BANK:'BANK_TRANSFER',TRANSFER:'BANK_TRANSFER',INKIND:'IN_KIND',IN_KIND:'IN_KIND'};
  const normalized=aliases[key]||key;
  return PAYMENT_CHANNELS.includes(normalized)?normalized:'OTHER';
}

function money(value){return Math.round((Number(value)||0)*100)/100;}
function fingerprint(data){return createHash('sha256').update(JSON.stringify(data)).digest('hex');}

export async function notifyPaymentConcern({db=prisma,schoolId,paymentId,channel,transactionCode,reason,createdById,title='Payment needs administration follow-up'}) {
  const concern=await db.paymentConcern.create({data:{schoolId,paymentId:paymentId||null,channel:channel||null,transactionCode:transactionCode||null,reason,createdById}});
  await db.notification.createMany({data:ADMIN_FOLLOWUP_ROLES.map(targetRole=>({targetRole,severity:'HIGH',title,message:reason,entity:'PaymentConcern',entityId:concern.id}))});
  return concern;
}

export async function createStagedPayment({school,userId,input,recordTitle='STUDENT FEE PAYMENT'}) {
  const studentRecordId=input.studentRecordId||input.recordId;
  const student=await prisma.moduleRecord.findFirst({where:{id:studentRecordId,module:'students'}});
  if(!student)throw Object.assign(new Error('Select a valid student record.'),{status:400});
  const studentData=student.data||{};
  const admissionNumber=String(studentData['Admission number']||'').trim().toUpperCase();
  if(!admissionNumber)throw Object.assign(new Error('The student must have an admission number before payment recording.'),{status:400});
  const className=String(studentData.Class||input.className||'').trim().toUpperCase();
  if(input.className&&className&&String(input.className).trim().toUpperCase()!==className)throw Object.assign(new Error('The selected class does not match the student register.'),{status:400});

  const channel=normalizeChannel(input.channel||input.method||input.data?.Method);
  const allocation=['TUITION','TRANSPORT','OTHER_FEES'].includes(String(input.allocation||input.data?.['Fee type']||'').toUpperCase())?String(input.allocation||input.data?.['Fee type']||'').toUpperCase():'TUITION';
  const transactionCode=String(input.transactionCode||input.reference||input.data?.['Transaction code']||input.data?.Reference||input.data?.['Receipt number']||'').trim().toUpperCase()||null;
  const rawItem=String(input.item||input.data?.['In-kind item']||'').trim().toUpperCase().replace(/[ -]+/g,'_');
  const item=IN_KIND_ITEMS.includes(rawItem)?rawItem:null;
  const quantity=Number(input.quantity??input.data?.Quantity);
  const unit=String(input.unit||input.data?.Unit||'').trim().toUpperCase();
  const unitValueInput=input.unitValue??input.data?.['Unit value (KES)'];
  const unitValue=unitValueInput===''||unitValueInput==null?null:Number(unitValueInput);
  const cashInput=input.cashAmount??input.data?.['Cash amount'];
  const cashAmount=money(cashInput==null||cashInput===''?(channel==='CASH'?input.amount??input.data?.['Amount (KES)']??input.data?.Amount:0):cashInput);
  const requestedAmount=input.amount??input.data?.['Amount (KES)']??input.data?.Amount;
  let amount=money(requestedAmount);
  let inKindValue=0;
  const issues=[];

  if(['MPESA_PAYBILL','AIRTEL_MONEY','CHEQUE','BANK_TRANSFER'].includes(channel)&&!transactionCode)issues.push('Transaction code/reference is missing.');
  const explanation=String(input.explanation||input.data?.Explanation||input.data?.['Payment explanation']||'').trim();
  if(channel==='OTHER'&&!explanation)issues.push('Other payment method requires an explanation.');
  if(channel==='OTHER')issues.push('Other payment method requires administration review.');
  if(channel==='IN_KIND'){
    if(!item)issues.push('Choose maize, beans, millet, or ream paper.');
    if(!Number.isFinite(quantity)||quantity<=0)issues.push('Enter the quantity received.');
    if(item&&unit&&!ITEM_UNITS[item].includes(unit))issues.push(`${item.replace('_',' ')} unit must be ${ITEM_UNITS[item].join(' or ')}.`);
    if(item&&!unit)issues.push(`Choose a unit for ${item.replace('_',' ')}.`);
    if(!String(input.deliveryReference||input.data?.['Delivery note reference']||'').trim())issues.push('A delivery note reference is required for in-kind verification.');
    if(item&&Number.isFinite(quantity)&&quantity>0){
      if(unitValue!==null&&Number.isFinite(unitValue)&&unitValue>=0)inKindValue=money(quantity*unitValue);
      else if(Number.isFinite(amount)&&amount>cashAmount)inKindValue=money(amount-cashAmount);
      amount=money(cashAmount+inKindValue);
    }
  }else{
    if(!Number.isFinite(amount)||amount<=0)issues.push('Enter a positive payment amount.');
    if(channel==='CASH'&&cashAmount!==amount)issues.push('Cash amount must match the payment amount.');
    if(cashAmount>amount)issues.push('Cash amount cannot exceed the fee credit amount.');
  }
  if(channel==='CASH'&&!transactionCode&&!String(input.idempotencyKey||'').trim())issues.push('A receipt number or idempotency key is required to prevent duplicate cash entries.');
  if(!['MAIN','PETTY','BANK'].includes(input.cashbook))input.cashbook=channel==='CASH'?'MAIN':'BANK';
  const status=issues.length?'CONCERN':'PENDING_VERIFICATION';
  const concernText=issues.join(' ')||'Payment is awaiting verification against its receipt, delivery note, or statement.';
  const fingerprintData={studentRecordId,channel,transactionCode,allocation,amount,cashAmount,item,quantity:Number.isFinite(quantity)?quantity:null,unit,unitValue,explanation,deliveryReference:String(input.deliveryReference||input.data?.['Delivery note reference']||'').trim()};
  const requestFingerprint=fingerprint(fingerprintData);
  const idempotencyKey=String(input.idempotencyKey||'').trim()||randomUUID();

  const replay=await prisma.paymentTransaction.findUnique({where:{idempotencyKey}});
  if(replay){
    if(replay.requestFingerprint!==requestFingerprint){
      const concern=await prisma.$transaction(async tx=>{const created=await notifyPaymentConcern({db:tx,schoolId:school.id,paymentId:replay.id,channel,transactionCode,reason:'An idempotency key was reused with different payment details. Review both submissions.',createdById:userId,title:'Payment submission collision'});await tx.auditLog.create({data:{userId,action:'FLAG_PAYMENT_SUBMISSION_COLLISION',entity:'PaymentTransaction',entityId:replay.id,details:{channel,transactionCode,concernId:created.id}}});return created;});
      return {conflict:true,payment:replay,concern};
    }
    return {idempotent:true,payment:replay};
  }

  if(transactionCode){
    const duplicate=await prisma.paymentTransaction.findFirst({where:{schoolId:school.id,channel,transactionCode}});
    if(duplicate){
      const concern=await prisma.$transaction(async tx=>{const created=await notifyPaymentConcern({db:tx,schoolId:school.id,paymentId:duplicate.id,channel,transactionCode,reason:`Transaction code ${transactionCode} already exists for ${channel}. Keep this submission unposted and verify the original receipt.`,createdById:userId,title:'Duplicate payment transaction code'});await tx.auditLog.create({data:{userId,action:'FLAG_PAYMENT_REFERENCE_COLLISION',entity:'PaymentTransaction',entityId:duplicate.id,details:{channel,transactionCode,concernId:created.id}}});return created;});
      return {conflict:true,payment:duplicate,concern};
    }
  }

  try {
  const result=await prisma.$transaction(async tx=>{
    const created=await tx.paymentTransaction.create({data:{
      schoolId:school.id,studentRecordId:student.id,createdById:userId,channel,transactionCode,idempotencyKey,requestFingerprint,
      admissionNumber,className,allocation,amount,cashAmount,cashbook:input.cashbook,item,quantity:Number.isFinite(quantity)&&quantity>0?quantity:null,
      unit:unit||null,unitValue:unitValue!==null&&Number.isFinite(unitValue)?unitValue:null,inKindValue,
      deliveryReference:String(input.deliveryReference||input.data?.['Delivery note reference']||'').trim()||null,
      explanation:explanation||null,status,concern:concernText
    }});
    const methodLabels={MPESA_PAYBILL:'M-PESA PAYBILL',AIRTEL_MONEY:'AIRTEL MONEY',CHEQUE:'CHEQUE',BANK_TRANSFER:'BANK TRANSFER',CASH:'CASH',IN_KIND:'IN-KIND',OTHER:'OTHER'};
    const paymentData={
      'Receipt number':transactionCode||`PENDING-${created.id.slice(-8).toUpperCase()}`,
      'Student admission number':admissionNumber,'Class':className,'Fee type':allocation,'Amount (KES)':amount,'Cash amount':cashAmount,
      'Method':methodLabels[channel],'Reference':transactionCode||created.deliveryReference||'',
      'Transaction code':transactionCode||'','Verification status':status,'Status':status==='VERIFIED_BALANCED'?'PAID':'PENDING VERIFICATION',
      'Payment transaction id':created.id,'In-kind item':item||'','Quantity':created.quantity?Number(created.quantity):'',
      'Unit':unit,'In-kind value (KES)':inKindValue,'Delivery note reference':created.deliveryReference||'',
      'Payment explanation':explanation
    };
    const paymentRecord=await tx.moduleRecord.create({data:{module:'payments',title:recordTitle.toUpperCase(),data:paymentData,createdById:userId}});
    const saved=await tx.paymentTransaction.update({where:{id:created.id},data:{paymentRecordId:paymentRecord.id}});
    const concern=await notifyPaymentConcern({db:tx,schoolId:school.id,paymentId:saved.id,channel,transactionCode,reason:concernText,createdById:userId,title:status==='CONCERN'?'Payment concern requires follow-up':'Payment awaiting verification'});
    await tx.auditLog.create({data:{userId,action:'RECORD_STUDENT_PAYMENT',entity:'PaymentTransaction',entityId:saved.id,details:{channel,status,admissionNumber,transactionCode,amount,inKindItem:item,concernId:concern.id}}});
    return {payment:saved,concern};
  });
  return result;
  } catch (error) {
    if (error.code === 'P2002') {
      const raced = transactionCode ? await prisma.paymentTransaction.findFirst({where:{schoolId:school.id,channel,transactionCode}}) : await prisma.paymentTransaction.findUnique({where:{idempotencyKey}});
      if (raced) {
        const concern=await prisma.$transaction(async tx=>{const created=await notifyPaymentConcern({db:tx,schoolId:school.id,paymentId:raced.id,channel,transactionCode,reason:`A concurrent submission reused payment reference ${transactionCode||idempotencyKey}. It was stopped before posting; verify the original entry.`,createdById:userId,title:'Concurrent payment collision'});await tx.auditLog.create({data:{userId,action:'FLAG_PAYMENT_CONCURRENT_COLLISION',entity:'PaymentTransaction',entityId:raced.id,details:{channel,transactionCode,concernId:created.id}}});return created;});
        return {conflict:true,payment:raced,concern};
      }
    }
    throw error;
  }
}
