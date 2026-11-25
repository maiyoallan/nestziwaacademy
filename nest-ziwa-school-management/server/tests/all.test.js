import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { spawn,spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { reportHtml,downloadDocx,downloadXlsx,printHtml } from '../../client/src/exportUtils.js';
import { cleanSignaturePixels } from '../../client/src/imageProcessing.js';
import { renderStudentIdCardsHtml } from '../../client/src/studentIdUtils.js';

const serverDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const repoDir=path.resolve(serverDir,'..');
dotenv.config({path:path.join(serverDir,'.env')});
const roleNames=['SYSTEM_ADMIN','HEADTEACHER','BURSAR','TEACHER','PARENT','EXAM_OFFICER','STOREKEEPER','TRANSPORT_MANAGER','DRIVER','DIRECTOR','ADMISSIONS'];
const authRoles=['SYSTEM_ADMIN','HEADTEACHER','BURSAR','TEACHER','PARENT','DIRECTOR','TRANSPORT_MANAGER'];
const password='TestPass123!';
let schemaName,dbUrl,adminDb,testDb,serverProcess,mockAi,mockAiPort,apiPort,baseApi,aiOnline=true,aiRequests=[],tokens={},users={},student,secondStudent,unlinkedStudent,parentEmail='e2e-parent@nestziwa.test',feeRecord,transportAssignment,staffRecords=[],testFiles=[];

async function freePort(){return new Promise((resolve,reject)=>{const socket=createTcpServer();socket.once('error',reject);socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(error=>error?reject(error):resolve(port));});});}
function api(pathname,token,options={}){
 const headers={...(options.body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})};
 return fetch(`${baseApi}${pathname}`,{method:options.method||'GET',headers,body:options.body===undefined?undefined:JSON.stringify(options.body)}).then(async response=>{const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(data.message||`HTTP ${response.status}`),{status:response.status,data});return{status:response.status,data,response};});
}
async function login(role){const response=await api('/auth/login',null,{method:'POST',body:{email:users[role].email,password}});tokens[role]=response.data.token;return response.data;}
async function createRecord(module,title,data,token=tokens.SYSTEM_ADMIN){return(await api(`/records/${module}`,token,{method:'POST',body:{title,data}})).data.record;}
async function createStudent(name,token=tokens.SYSTEM_ADMIN){return createRecord('students','NEW STUDENT',{'Full name':name,'Section':'PRIMARY','Class':'GRADE 4','Date of birth':'2016-06-10','Status':'ACTIVE'},token);}
async function postPayment(channel,fields={}){return api('/payments',tokens.BURSAR,{method:'POST',body:{studentRecordId:student.id,channel,idempotencyKey:`e2e-${crypto.randomUUID()}`,...fields}});}

before(async()=>{
  const baseDatabaseUrl=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;
  if(!baseDatabaseUrl)throw new Error('Set DATABASE_URL in server/.env or TEST_DATABASE_URL to run the isolated integration suite.');
  const parsedUrl=new URL(baseDatabaseUrl);
  if(!process.env.TEST_DATABASE_URL&&!['localhost','127.0.0.1','::1'].includes(parsedUrl.hostname))throw new Error('For safety, the test suite requires a loopback DATABASE_URL or an explicit disposable TEST_DATABASE_URL.');
  schemaName=`nz_test_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const testUrl=new URL(baseDatabaseUrl);testUrl.searchParams.set('schema',schemaName);dbUrl=testUrl.toString();
  adminDb=new PrismaClient({datasources:{db:{url:baseDatabaseUrl}}});
  await adminDb.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  const prismaCli=path.join(serverDir,'node_modules','prisma','build','index.js');
  const migrate=spawnSync(process.execPath,[prismaCli,'migrate','deploy'],{cwd:serverDir,env:{...process.env,DATABASE_URL:dbUrl},encoding:'utf8',timeout:120000});
  if(migrate.status!==0)throw new Error(`Isolated Prisma migrations failed:\n${migrate.stdout}\n${migrate.stderr}`);
  testDb=new PrismaClient({datasources:{db:{url:dbUrl}}});
  const passwordHash=await bcrypt.hash(password,5);
  for(const role of roleNames)users[role]=await testDb.user.create({data:{name:`E2E ${role}`,email:`e2e-${role.toLowerCase()}@nestziwa.test`,passwordHash,role}});

  mockAi=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;aiRequests.push(JSON.parse(raw||'{}'));res.setHeader('Content-Type','application/json');if(!aiOnline){res.writeHead(503);return res.end(JSON.stringify({error:{message:'AI test endpoint offline'}}));}res.end(JSON.stringify({model:'mock-free-model',choices:[{message:{role:'assistant',content:'<p>REMOTE AI RESPONSE</p>'}}]}));});
  mockAiPort=await freePort();await new Promise((resolve,reject)=>{mockAi.once('error',reject);mockAi.listen(mockAiPort,'127.0.0.1',resolve);});
  apiPort=await freePort();baseApi=`http://127.0.0.1:${apiPort}/api`;
  serverProcess=spawn(process.execPath,['src/index.js'],{cwd:serverDir,env:{...process.env,DATABASE_URL:dbUrl,JWT_SECRET:'e2e-test-secret-that-is-not-used-outside-the-disposable-schema',PORT:String(apiPort),NODE_ENV:'test',CLIENT_ORIGIN:'http://localhost:5175',AI_API_KEY:'e2e-mock-only',AI_API_BASE_URL:`http://127.0.0.1:${mockAiPort}/v1`,AI_MODEL:'mock-free-model',AI_TIMEOUT_MS:'900',OLLAMA_URL:'http://127.0.0.1:1/api/generate',PAYMENT_GATEWAY_DRIVER:'mock_sandbox'},stdio:['ignore','pipe','pipe']});
  serverProcess.stdout.on('data',chunk=>{serverProcess.log=(serverProcess.log||'')+chunk.toString();});serverProcess.stderr.on('data',chunk=>{serverProcess.log=(serverProcess.log||'')+chunk.toString();});
  const deadline=Date.now()+30000;let lastError;
  while(Date.now()<deadline){try{const response=await fetch(`${baseApi}/health`);if(response.ok)break;lastError=new Error(`Health endpoint returned ${response.status}`);}catch(error){lastError=error;}await new Promise(resolve=>setTimeout(resolve,200));}
  const health=await fetch(`${baseApi}/health`).catch(()=>null);
  if(!health?.ok)throw new Error(`The isolated API did not start: ${lastError?.message||''}\n${serverProcess.log||''}`);
});

after(async()=>{
  if(serverProcess){serverProcess.kill('SIGTERM');await Promise.race([new Promise(resolve=>serverProcess.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);}
  if(mockAi?.listening)await new Promise(resolve=>mockAi.close(resolve));
  for(const file of testFiles)await rm(file,{force:true,recursive:true}).catch(()=>{});
  if(testDb){await testDb.$disconnect().catch(()=>{});testDb=null;}
  if(adminDb&&schemaName){await adminDb.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(error=>console.error(`Could not clean isolated test schema ${schemaName}: ${error.message}`));}
  if(adminDb)await adminDb.$disconnect().catch(()=>{});
});

test('full-system persistence, permissions, finance, offline assistant, exports, and integration suite',{timeout:180000},async t=>{
  await t.test('health, CORS, role logins, and access controls',async()=>{
    const health=await fetch(`${baseApi}/health`);assert.equal((await health.json()).database,'connected');
    const cors=await fetch(`${baseApi}/health`,{headers:{Origin:'http://localhost:5175'}});assert.equal(cors.headers.get('access-control-allow-origin'),'http://localhost:5175');
    for(const role of authRoles){const session=await login(role);assert.equal(session.user.role,role);assert.ok(tokens[role]);}
    const forbidden=await api('/director/audit',tokens.BURSAR).catch(error=>error);assert.equal(forbidden.status,403);
    assert.equal((await api('/director/audit',tokens.DIRECTOR)).data.logs.length,authRoles.length);
    const studentWrite=await api('/records/students',tokens.BURSAR,{method:'POST',body:{title:'X',data:{'Full name':'No Permission'}}}).catch(error=>error);assert.equal(studentWrite.status,403);
  });

  await t.test('create, retrieve, update, and delete module records',async()=>{
    student=await createStudent('E2E LEARNER ONE');
    secondStudent=await createStudent('E2E LEARNER SIBLING');
    unlinkedStudent=await createStudent('E2E UNLINKED LEARNER');
    assert.match(student.data['Admission number'],/\d/);assert.equal(student.data['Full name'],'E2E LEARNER ONE');
    const modules={
      admissions:['APPLICATION','ADMISSION',{'Applicant name':'E2E APPLICANT','Guardian phone':'0712345000','Previous school':'E2E PREVIOUS','Application date':'2026-11-25','Status':'APPLICATION RECEIVED'}],
      guardians:['PARENT','GUARDIAN',{'Full name':'E2E PARENT','Phone':'0712345000','Email':parentEmail,'Relationship':'PARENT','Student admission number':student.data['Admission number']}],
      classes:['GRADE 4 CLASS','CLASSES',{'Class name':'GRADE 4','Section':'PRIMARY','Stream':'E2E','Academic year':'2026'}],
      academics:['MATHEMATICS','ACADEMICS',{'Subject':'MATHEMATICS','Class':'GRADE 4','Teacher':'E2E TEACHER','Academic year':'2026'}],
      attendance:['ATTENDANCE','ATTENDANCE',{'Class':'GRADE 4','Student':'E2E LEARNER ONE','Date':'2026-11-25','Status':'PRESENT','Remarks':'E2E'}],
      inventory:['EXERCISE BOOK','INVENTORY',{'Item code':'E2E-BOOK','Item name':'EXERCISE BOOK','Category':'STATIONERY','Quantity':'50','Unit':'PIECES','Reorder level':'10'}],
      procurement:['E2E SUPPLIER','PROCUREMENT',{'Supplier':'E2E SUPPLIER','Item':'EXERCISE BOOK','Quantity':'50','Total cost (KES)':'2000','Purchase date':'2026-11-25','Status':'REQUESTED'}],
      transport:['LEGACY TRANSPORT ROW','TRANSPORT',{'Vehicle registration':'E2E-OLD','Route':'E2E ROUTE','Driver':'E2E DRIVER','Capacity':'12','Status':'ACTIVE'}],
      timetable:['GRADE 4 MATHEMATICS','TIMETABLE',{'Class':'GRADE 4','Subject':'MATHEMATICS','Teacher':'E2E TEACHER','Day':'MONDAY','Start time':'08:00','End time':'09:00'}],
      communications:['E2E NOTICE','COMMUNICATIONS',{'Title':'E2E NOTICE','Message':'Persistence check','Audience':'ALL FAMILIES','Publish date':'2026-11-25'}],
      reports:['E2E REPORT','REPORTS',{'Report name':'E2E REPORT','Period':'TERM 3','Description':'Persistence check'}],
      documents:['E2E CERTIFICATE','DOCUMENTS',{'Document type':'CERTIFICATE','Student admission number':student.data['Admission number'],'Issue date':'2026-11-25','Notes':'E2E'}],
      settings:['E2E SETTING','SETTINGS',{'Setting':'E2E','Value':'Saved','Description':'Persistence check'}]
    };
    const saved={};
    for(const[module,[title,recordTitle,data]]of Object.entries(modules))saved[module]=await createRecord(module,recordTitle,data);
    const hr1=await createRecord('hr','E2E STAFF ONE',{'Staff number':'E2E-STAFF-1','Full name':'E2E STAFF ONE','Job title':'TEACHER','Phone':'0712345678','Email':'staff1@nestziwa.test','Employment status':'ACTIVE','Salary (KES)':'50000'});
    const hr2=await createRecord('hr','E2E STAFF TWO',{'Staff number':'E2E-STAFF-2','Full name':'E2E STAFF TWO','Job title':'ACCOUNTANT','Phone':'0712345679','Email':'staff2@nestziwa.test','Employment status':'ACTIVE','Salary (KES)':'60000'});
    staffRecords=[hr1,hr2];saved.hr=hr1;
    feeRecord=(await api('/records/fees',tokens.SYSTEM_ADMIN,{method:'POST',body:{title:'TERM FEES INVOICE',data:{'Student admission number':student.data['Admission number'],Class:'GRADE 4',Term:'TERM 3','Academic year':'2026','Amount (KES)':12000,'Due date':'2026-12-01',Status:'UNPAID'}}})).data.record;saved.fees=feeRecord;
    const expense=(await api('/records/expenses',tokens.SYSTEM_ADMIN,{method:'POST',body:{title:'E2E SCHOOL EXPENSE',data:{'Expense number':'E2E-EXP-1',Category:'SUPPLIES',Description:'Test stationery','Amount (KES)':700,Date:'2026-11-25',Approval:'PAID',Method:'CASH'}}})).data.record;saved.expenses=expense;
    const exam=await createRecord('examinations','CONTINUOUS ASSESSMENT',{Assessment:'E2E MIDTERM',Subject:'MATHEMATICS',Class:'GRADE 4','Student admission number':student.data['Admission number'],Score:35,'Maximum score':100,Term:'TERM 3','Academic year':'2026','Assigned teacher':users.TEACHER.name,Grade:'F','Rank by':'PERCENTAGE'});saved.examinations=exam;
    for(const[module,record]of Object.entries(saved)){const list=(await api(`/records/${module}`,tokens.SYSTEM_ADMIN)).data.records;assert.ok(list.some(row=>row.id===record.id),`${module} record must be retrievable after save`);}
    const updated=await api(`/records/communications/${saved.communications.id}`,tokens.SYSTEM_ADMIN,{method:'PATCH',body:{title:'E2E NOTICE UPDATED',data:{...saved.communications.data,Message:'Updated and persisted'}}});assert.equal(updated.data.record.data.Message,'Updated and persisted');
    const deleted=await api(`/records/reports/${saved.reports.id}`,tokens.SYSTEM_ADMIN,{method:'DELETE'});assert.equal(deleted.data.message,'Record deleted.');
    const admissionList=(await api('/records/students',tokens.SYSTEM_ADMIN)).data.records;assert.ok(admissionList.some(row=>row.id===student.id));
    const bulk=(await api('/records/students/import',tokens.SYSTEM_ADMIN,{method:'POST',body:{records:[
      {title:'bulk learner one',data:{'Full name':'bulk learner one',Section:'PRIMARY',Class:'GRADE 1','Date of birth':'2017-03-04',Status:'ACTIVE'}},
      {title:'bulk learner two',data:{'Full name':'bulk learner two',Section:'PRIMARY',Class:'GRADE 2','Date of birth':'2016-02-03',Status:'ACTIVE'}}
    ]}})).data;assert.equal(bulk.imported,2);assert.equal(bulk.records[0].data['Full name'],'BULK LEARNER ONE');assert.notEqual(bulk.records[0].data['Admission number'],bulk.records[1].data['Admission number']);
    const learning=(await api('/records/academics',tokens.SYSTEM_ADMIN)).data;assert.ok(!learning.module.fields.some(field=>/maize|beans|millet|ream paper|in.kind balance/i.test(field)));
    const duplicate=await api('/records/students',tokens.SYSTEM_ADMIN,{method:'POST',body:{title:'NEW STUDENT',data:{...student.data,'Full name':'DUPLICATE E2E'}}}).catch(error=>error);assert.equal(duplicate.status,409);
  });

  await t.test('photos, guardian sibling links, and per-child portal access',async()=>{
    for(const record of [student,secondStudent])await createRecord('guardians','E2E GUARDIAN',{'Full name':'E2E PARENT','Phone':'0712345000','Email':parentEmail,'Relationship':'PARENT','Student admission number':record.data['Admission number']});
    const photoBase64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/E9sAAAAASUVORK5CYII=';
    await api(`/records/students/${student.id}/photo`,tokens.SYSTEM_ADMIN,{method:'POST',body:{fileName:'e2e-student.png',mimeType:'image/png',dataBase64:photoBase64}});
    await api(`/records/students/${secondStudent.id}/photo`,tokens.SYSTEM_ADMIN,{method:'POST',body:{fileName:'e2e-sibling.png',mimeType:'image/png',dataBase64:photoBase64}});
    const photo=await fetch(`${baseApi}/records/students/${student.id}/photo`,{headers:{Authorization:`Bearer ${tokens.SYSTEM_ADMIN}`}});assert.equal(photo.status,200);assert.equal(photo.headers.get('content-type'),'image/png');
    const link=(await api(`/records/students/${student.id}/student-account`,tokens.SYSTEM_ADMIN,{method:'POST',body:{email:'e2e-student@nestziwa.test'}})).data;
    const studentSession=await api('/auth/login',null,{method:'POST',body:{email:'e2e-student@nestziwa.test',password:link.temporaryPassword}});tokens.STUDENT_LOGIN=studentSession.data.token;
    const own=(await api('/records/students',tokens.STUDENT_LOGIN)).data.records;assert.equal(own.length,1);assert.equal(own[0].id,student.id);
    const ownHub=(await api(`/student-hub/${student.id}`,tokens.STUDENT_LOGIN)).data.hub;assert.equal(ownHub.siblings.length,0,'student views must not include sibling profiles');
    const privateProfile=await api(`/student-hub/${unlinkedStudent.id}`,tokens.STUDENT_LOGIN).catch(error=>error);assert.equal(privateProfile.status,403);
    const parentChildren=(await api('/student-hub/children',tokens.PARENT)).data.children;assert.equal(parentChildren.length,2);
    assert.ok(parentChildren.some(row=>row.siblings.some(sibling=>sibling.id===secondStudent.id)));
    await createRecord('guardians','UNRELATED SHARED PHONE',{'Full name':'UNRELATED PARENT','Phone':'0712345000','Email':'unrelated-parent@nestziwa.test','Relationship':'PARENT','Student admission number':unlinkedStudent.data['Admission number']});
    const unrelated=await api(`/student-hub/${unlinkedStudent.id}`,tokens.PARENT).catch(error=>error);assert.equal(unrelated.status,403);
    const refreshedChildren=(await api('/student-hub/children',tokens.PARENT)).data.children;assert.equal(refreshedChildren.length,2);assert.ok(refreshedChildren.every(child=>!child.siblings.some(sibling=>sibling.id===unlinkedStudent.id)));
    const assistantPrivate=(await api('/assistant/chat',tokens.PARENT,{method:'POST',body:{message:`What is ${unlinkedStudent.data['Full name']} fee balance?`}})).data;assert.doesNotMatch(assistantPrivate.answer,/E2E UNLINKED LEARNER/);
  });

  await t.test('fees, transport assignments, all in-kind items, and statement balances',async()=>{
    const route=(await api('/transport/routes',tokens.TRANSPORT_MANAGER,{method:'POST',body:{name:'E2E NORTH ROUTE',description:'Automated test route',fee:1500}})).data.route;
    const vehicle=(await api('/transport/vehicles',tokens.TRANSPORT_MANAGER,{method:'POST',body:{name:'E2E SHUTTLE ONE',registrationNo:'KTEST 100A',vehicleClass:'SHUTTLE_CAR',capacity:12,routeId:route.id}})).data.vehicle;
    transportAssignment=(await api('/transport/assignments',tokens.TRANSPORT_MANAGER,{method:'POST',body:{studentRecordId:student.id,vehicleId:vehicle.id,routeId:route.id,feeAmount:1500,billingCycle:'TERM'}})).data.assignment;
    for(const[item,unit]of [['MAIZE','KG'],['BEANS','SACK'],['MILLET','KG'],['REAM_PAPER','REAM']])await api('/payments/in-kind/pledges',tokens.BURSAR,{method:'POST',body:{studentRecordId:student.id,item,quantity:5,unit,unitValue:100,notes:'E2E contribution'}});
    const itemBalances=(await api('/payments/in-kind/balances',tokens.BURSAR)).data.balances;assert.deepEqual(new Set(itemBalances.map(row=>row.item)),new Set(['MAIZE','BEANS','MILLET','REAM_PAPER']));
    const studentBalances=(await api('/accounting/student-balances',tokens.BURSAR)).data.balances.find(row=>row.admissionNumber===student.data['Admission number']);
    assert.equal(studentBalances.fees,13500);assert.equal(studentBalances.transportFees,1500);assert.equal(studentBalances.transportBalance,1500);
    const hub=(await api(`/student-hub/${student.id}`,tokens.BURSAR)).data.hub;assert.equal(hub.transportBalance,1500);assert.equal(hub.itemBalances.length,4);
    const parentPledge=await api(`/student-hub/${student.id}/food-pledge`,tokens.PARENT,{method:'POST',body:{item:'BEANS',quantity:2,unit:'KG',notes:'Parent portal pledge'}});assert.equal(parentPledge.status,201);
    const transportList=(await api('/transport',tokens.TRANSPORT_MANAGER)).data.assignments;assert.ok(transportList.some(row=>row.id===transportAssignment.id));
    assert.ok(transportList.some(row=>row.vehicleId===vehicle.id&&row.vehicle.name==='E2E SHUTTLE ONE'));
  });

  await t.test('multi-channel payment staging, verification, collision alerts, and payment prompts',async()=>{
    const channels=[['MPESA_PAYBILL',{transactionCode:'E2E-MPESA-1',amount:100}],['AIRTEL_MONEY',{transactionCode:'E2E-AIRTEL-1',amount:100}],['CHEQUE',{transactionCode:'E2E-CHEQUE-1',amount:100}],['BANK_TRANSFER',{transactionCode:'E2E-BANK-1',amount:100}],['CASH',{amount:100,cashAmount:100}],['OTHER',{amount:25,explanation:'E2E parent cheque replacement'}],['IN_KIND',{item:'MAIZE',quantity:2,unit:'KG',unitValue:100,deliveryReference:'E2E-DELIVERY-1'}]];
    const staged={};for(const[channel,fields]of channels)staged[channel]=(await postPayment(channel,fields)).data.payment;
    for(const[channel]of channels)assert.ok(staged[channel].id,`${channel} payment persists`);
    assert.equal(staged.OTHER.status,'CONCERN');
    const cash=await api(`/payments/${staged.CASH.id}/verify`,tokens.BURSAR,{method:'POST',body:{statementAmount:100,verificationNote:'Cash counted in E2E run'}});assert.equal(cash.data.payment.status,'VERIFIED_BALANCED');
    const kind=await api(`/payments/${staged.IN_KIND.id}/verify`,tokens.BURSAR,{method:'POST',body:{verifiedQuantity:2,verificationNote:'Delivery physically counted'}});assert.equal(kind.data.payment.status,'VERIFIED_BALANCED');
    const colliding=(await postPayment('CHEQUE',{transactionCode:'E2E-COLLISION-1',amount:70})).data.payment;
    const collision=await postPayment('CHEQUE',{transactionCode:'E2E-COLLISION-1',amount:70}).catch(error=>error);assert.equal(collision.status,409);assert.equal((await testDb.paymentTransaction.findUnique({where:{id:colliding.id}})).status,'PENDING_VERIFICATION');
    assert.ok(await testDb.paymentConcern.count({where:{transactionCode:'E2E-COLLISION-1',status:'OPEN'}}));
    assert.ok(await testDb.notification.count({where:{entity:'PaymentConcern',entityId:(await testDb.paymentConcern.findFirst({where:{transactionCode:'E2E-COLLISION-1'}})).id,targetRole:'BURSAR'}}));
    const parentPrompt=(await api('/payment-gateway/prompts',tokens.PARENT,{method:'POST',body:{studentRecordId:student.id,channel:'MPESA_PAYBILL',purpose:'school_fees',amount:50,phone:'0712345000',idempotencyKey:`parent-${crypto.randomUUID()}`}})).data.prompt;
    assert.equal(parentPrompt.status,'PENDING_PROMPT');
    const promptConfirmation=await api(`/payment-gateway/prompts/${parentPrompt.id}/sandbox-confirm`,tokens.BURSAR,{method:'POST',body:{}});assert.equal(promptConfirmation.data.prompt.status,'PAID_CONFIRMED');
    const replay=await api(`/payment-gateway/prompts/${parentPrompt.id}/sandbox-confirm`,tokens.BURSAR,{method:'POST',body:{providerReference:promptConfirmation.data.prompt.providerReference}});assert.equal(replay.data.idempotent,true);
    const stagedInDb=await testDb.paymentTransaction.findUnique({where:{id:promptConfirmation.data.payment.id}});assert.equal(stagedInDb.status,'VERIFIED_BALANCED');
    const accountantPrompt=(await api('/payment-gateway/prompts',tokens.BURSAR,{method:'POST',body:{studentRecordId:student.id,channel:'AIRTEL_MONEY',purpose:'transport',amount:25,phone:'0712345000',idempotencyKey:`accountant-${crypto.randomUUID()}`}})).data.prompt;assert.equal(accountantPrompt.status,'PENDING_PROMPT');assert.equal(accountantPrompt.purpose,'transport');
    const accountantConfirmation=await api(`/payment-gateway/prompts/${accountantPrompt.id}/sandbox-confirm`,tokens.BURSAR,{method:'POST',body:{}});assert.equal(accountantConfirmation.data.prompt.status,'PAID_CONFIRMED');
    const prompts=(await api('/payment-gateway/prompts',tokens.BURSAR)).data.prompts;assert.ok(prompts.some(row=>row.id===parentPrompt.id));
  });

  await t.test('double-entry statements, budgets, bank reconciliation, and salary runs',async()=>{
    const summary=(await api('/accounting/summary',tokens.BURSAR)).data;assert.equal(summary.balanced,true);assert.ok(Math.abs(summary.balanceSheet.assets-(summary.balanceSheet.liabilities+summary.balanceSheet.equity))<0.01);assert.ok(summary.mainCashbook.length>0);
    const now=new Date(),period=(await api('/accounting/periods',tokens.BURSAR,{method:'POST',body:{name:'E2E FINANCIAL PERIOD',startsAt:new Date(now.getFullYear(),0,1).toISOString(),endsAt:new Date(now.getFullYear(),11,31,23,59,59).toISOString()}})).data.period;
    const accounts=(await api('/accounting/accounts',tokens.BURSAR)).data.accounts,receivable=accounts.find(row=>row.code==='1100'),income=accounts.find(row=>row.code==='4000');
    const journal=(await api('/accounting/journals',tokens.BURSAR,{method:'POST',body:{description:'E2E budget actual',periodId:period.id,transactionDate:new Date().toISOString(),lines:[{accountId:receivable.id,debit:500,credit:0},{accountId:income.id,debit:0,credit:500}]}})).data.entry;
    assert.equal(Number(journal.lines.reduce((sum,line)=>sum+Number(line.debit),0)),500);
    await api('/accounting/budgets',tokens.BURSAR,{method:'POST',body:{periodId:period.id,accountId:income.id,amount:1000}});
    const updatedSummary=(await api('/accounting/summary',tokens.BURSAR)).data;assert.equal(updatedSummary.balanced,true);assert.ok(Math.abs(updatedSummary.budgetVariance.find(row=>row.account==='Tuition and Fee Income').variance-500)<0.01);
    const bankImport=(await api('/accounting/bank-import',tokens.BURSAR,{method:'POST',body:{transactions:[{reference:'E2E-OVERPAYMENT-REF',admissionNumber:student.data['Admission number'],amount:50000,method:'BANK',transactionDate:new Date().toISOString()}]}})).data;assert.equal(bankImport.imported,1);assert.equal(bankImport.conflicts,1);
    const bankRows=(await api('/accounting/bank-transactions',tokens.BURSAR)).data.transactions;assert.ok(bankRows.some(row=>row.reference==='E2E-OVERPAYMENT-REF'&&row.status==='OVERPAYMENT'));
    const firstSchool=(await api('/accounting/schools/link',tokens.DIRECTOR,{method:'POST',body:{code:'NEST-ZIWA',name:'Nest Ziwa E2E School'}})).data.school;
    await api('/accounting/schools/link',tokens.DIRECTOR,{method:'POST',body:{code:'E2E-SECOND-SCHOOL',name:'E2E Second School'}});
    assert.equal((await api('/accounting/schools',tokens.DIRECTOR)).data.schools.length,2);
    const batch=(await api('/salaries/runs',tokens.DIRECTOR,{method:'POST',body:{schoolId:firstSchool.id,channel:'BANK_TRANSFER',idempotencyKey:`salary-${crypto.randomUUID()}`,items:[{staffRecordId:staffRecords[0].id,amount:12000},{staffRecordId:staffRecords[1].id,amount:15000}]}})).data.run;
    assert.equal(batch.items.length,2);assert.equal(batch.status,'PENDING_CONFIRMATION');
    const paid=(await api(`/salaries/runs/${batch.id}/sandbox-confirm`,tokens.DIRECTOR,{method:'POST',body:{}})).data.run;assert.equal(paid.status,'PAID_CONFIRMED');assert.ok(paid.journalEntryId);
    const installment=(await api('/salaries/runs',tokens.DIRECTOR,{method:'POST',body:{schoolId:firstSchool.id,channel:'CHEQUE',idempotencyKey:`salary-${crypto.randomUUID()}`,items:[{staffRecordId:staffRecords[0].id,amount:2500,description:'E2E salary installment'}]}})).data.run;
    assert.equal(installment.items.length,1);assert.equal((await api(`/salaries/runs/${installment.id}/sandbox-confirm`,tokens.DIRECTOR,{method:'POST',body:{}})).data.run.status,'PAID_CONFIRMED');
  });

  await t.test('offline data-grounded assistant, online provider fallback, and read-only behavior',async()=>{
    const before=await testDb.moduleRecord.count();const calls=aiRequests.length;
    const balance=(await api('/assistant/chat',tokens.BURSAR,{method:'POST',body:{message:`What is the fee, maize, and beans balance for ${student.data['Full name']}?`,module:'students'}})).data;
    assert.equal(balance.mode,'OFFLINE_BUILT_IN');assert.match(balance.answer,/E2E LEARNER ONE/);assert.match(balance.answer,/maize/i);assert.equal(aiRequests.length,calls);
    const failing=(await api('/assistant/chat',tokens.TEACHER,{method:'POST',body:{message:'Which students are failing?',module:'examinations'}})).data;assert.match(failing.answer,/E2E LEARNER ONE/);
    const restricted=(await api('/assistant/chat',tokens.TEACHER,{method:'POST',body:{message:'Show unverified bank payments'}})).data;assert.match(restricted.answer,/limited to Finance/);
    const bank=(await api('/assistant/chat',tokens.BURSAR,{method:'POST',body:{message:'Show unverified bank payments'}})).data;assert.match(bank.answer,/E2E-OVERPAYMENT-REF/);
    const online=(await api('/assistant/chat',tokens.TEACHER,{method:'POST',body:{message:'How do I prepare a lesson plan?',module:'academics'}})).data;assert.equal(online.mode,'ONLINE_AI');assert.match(online.answer,/REMOTE AI RESPONSE/);
    assert.ok(!JSON.stringify(aiRequests.at(-1)).includes('E2E LEARNER ONE'));assert.ok(!JSON.stringify(aiRequests.at(-1)).includes('12000'));
    aiOnline=false;const fallback=(await api('/assistant/chat',tokens.TEACHER,{method:'POST',body:{message:'Draft a timetable template',module:'timetable'}})).data;assert.equal(fallback.mode,'OFFLINE_BUILT_IN');assert.match(fallback.answer,/Timetable/i);
    const document=(await api('/assistant/generate-document',tokens.TEACHER,{method:'POST',body:{kind:'NOTICE',audience:'Parents',notes:'School meeting will be held on Monday at 10:00.'}})).data;assert.equal(document.mode,'OFFLINE_BUILT_IN');assert.match(document.draft,/School meeting will be held/);
    const parentData=(await api('/assistant/chat',tokens.PARENT,{method:'POST',body:{message:`What is ${unlinkedStudent.data['Full name']} fee balance?`}})).data;assert.doesNotMatch(parentData.answer,/E2E UNLINKED LEARNER/);assert.match(parentData.answer,/linked child records|could not find a student/i);
    const after=await testDb.moduleRecord.count();assert.equal(after,before,'assistant questions must not change school records');
  });

  await t.test('HTML/PDF, Excel, Word export formats and processed signature persistence',async()=>{
    const idHtml=renderStudentIdCardsHtml([student,secondStudent],{logoSrc:'/nest-ziwa-logo.png',photos:{[student.id]:'/student-one.png',[secondStudent.id]:'/student-two.png'},stampSrc:'/school-stamp.png'});assert.equal((idHtml.match(/class="id-card"/g)||[]).length,2);assert.match(idHtml,/STUDENT IDENTITY CARD/);assert.match(idHtml,/E2E LEARNER ONE/);assert.match(idHtml,/student-two\.png/);assert.match(idHtml,/page-break-inside:avoid/);
    const maliciousId=renderStudentIdCardsHtml([{id:'unsafe',data:{'Full name':'<script>alert(1)</script>','Admission number':'<A>','Class':'GRADE 4'}}]);assert.doesNotMatch(maliciousId,/<script>alert/);assert.match(maliciousId,/&lt;script&gt;/);
    const pixels=Uint8ClampedArray.from([255,255,255,255,30,30,30,255,245,245,245,255]);const cleaned=cleanSignaturePixels(pixels,3,1);assert.equal(cleaned.pixels[3],0);assert.equal(cleaned.pixels[7],255);assert.deepEqual(cleaned.bounds,{left:1,top:0,right:1,bottom:0});assert.throws(()=>cleanSignaturePixels(Uint8ClampedArray.from([255,255,255,255]),1,1),/No dark handwritten marks/);
    const html=reportHtml('E2E Student Register',['Name','Class'],[['<script>NO</script>','GRADE 4']]);assert.match(html,/NEST ZIWA SCHOOLS/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>NO/);
    const originalWindow=globalThis.window;let printedHtml='';globalThis.window={open:()=>({document:{write(value){printedHtml=value;},close(){}},focus(){},print(){}})};try{printHtml('E2E PDF letterhead',['Name'],[['E2E LEARNER ONE']]);assert.match(printedHtml,/NEST ZIWA SCHOOLS/);assert.match(printedHtml,/nest-ziwa-crest\.png/);}finally{if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;}
    const directory=await mkdtemp(path.join(os.tmpdir(),'nest-ziwa-export-'));testFiles.push(directory);const xlsxPath=path.join(directory,'e2e.xlsx');await downloadXlsx('Students',['Name','Admission'],[['E2E LEARNER ONE',student.data['Admission number']]],xlsxPath);const XLSX=(await import('node:module')).createRequire(path.join(repoDir,'client','package.json'))('xlsx');const workbook=XLSX.read(await readFile(xlsxPath));assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Students,{header:1})[3][0],'E2E LEARNER ONE');
    const originalDocument=globalThis.document,originalCreate=URL.createObjectURL;let docxBlob;globalThis.document={createElement:()=>({click(){}})};URL.createObjectURL=blob=>{docxBlob=blob;return'blob:e2e';};try{await downloadDocx('E2E Result',['Student','Score'],[['E2E LEARNER ONE','35/100']],'e2e.docx','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/E9sAAAAASUVORK5CYII=');}finally{if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;URL.createObjectURL=originalCreate;}
    const docx=Buffer.from(await docxBlob.arrayBuffer());assert.equal(docx.readUInt32LE(0),0x04034b50);assert.match(docx.toString('utf8'),/NEST ZIWA SCHOOLS/);assert.match(docx.toString('utf8'),/rIdLogo/);
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/E9sAAAAASUVORK5CYII=';const upload=(await api('/assets/signature',tokens.SYSTEM_ADMIN,{method:'PUT',body:{fileName:'processed-signature.png',mimeType:'image/png',dataBase64:png}}));assert.equal(upload.status,200);const signature=await fetch(`${baseApi}/assets/signature`,{headers:{Authorization:`Bearer ${tokens.SYSTEM_ADMIN}`}});assert.equal(signature.status,200);assert.equal(signature.headers.get('content-type'),'image/png');
    const stampUpload=await api('/assets/stamp',tokens.SYSTEM_ADMIN,{method:'PUT',body:{fileName:'processed-school-stamp.png',mimeType:'image/png',dataBase64:png}});assert.equal(stampUpload.status,200);const stamp=await fetch(`${baseApi}/assets/stamp`,{headers:{Authorization:`Bearer ${tokens.SYSTEM_ADMIN}`}});assert.equal(stamp.status,200);
    const newsletter=(await api('/newsletters/drafts',tokens.SYSTEM_ADMIN,{method:'POST',body:{subject:'E2E parent newsletter',html:'<article><h1>Week update</h1><p>School opens Monday.</p></article>'}})).data.draft;assert.ok((await api('/newsletters/drafts',tokens.SYSTEM_ADMIN)).data.drafts.some(row=>row.id===newsletter.id));
    const updatedNewsletter=(await api('/newsletters/drafts',tokens.SYSTEM_ADMIN,{method:'POST',body:{id:newsletter.id,subject:'E2E updated newsletter',html:'<article><p>Updated content.</p></article>'}})).data.draft;assert.match(updatedNewsletter.html,/Updated content/);
    const report=(await api('/report-cards/drafts',tokens.SYSTEM_ADMIN,{method:'POST',body:{title:'E2E report card',html:'<article><h1>Term result</h1><p>Score: 35</p></article>'}})).data.draft;assert.ok((await api('/report-cards/drafts',tokens.SYSTEM_ADMIN)).data.drafts.some(row=>row.id===report.id));
  });
});
