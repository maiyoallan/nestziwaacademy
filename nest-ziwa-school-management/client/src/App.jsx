import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, LayoutDashboard, Users, Wallet, BookOpen, ClipboardCheck, BriefcaseBusiness, Package, Bus, MessageSquare, CalendarDays, FileText, Settings, LogOut, Menu, Search, Plus, RefreshCw, GraduationCap, ShieldCheck, Eye, EyeOff, Pencil, Upload, Mail, X } from 'lucide-react';
import ImageAssetTools from './ImageAssetTools.jsx';
import NewsletterDesigner from './NewsletterDesigner.jsx';
import UserManagement from './UserManagement.jsx';
import ThemeSettings from './ThemeSettings.jsx';
import ReportCardStudio from './ReportCardStudio.jsx';
import FinanceWorkbench from './FinanceWorkbench.jsx';
import AlertCenter from './AlertCenter.jsx';
import AssistantPanel from './AssistantPanel.jsx';
import FloatingAssistant from './FloatingAssistant.jsx';
import DirectorWorkspace from './DirectorWorkspace.jsx';
import StudentIDStudio from './StudentIDStudio.jsx';
import SearchableStudentSelect from './SearchableStudentSelect.jsx';
import WhatsAppSettings from './WhatsAppSettings.jsx';
import PaymentVerificationStudio from './PaymentVerificationStudio.jsx';
import PaymentPromptConsole from './PaymentPromptConsole.jsx';
import ParentPortal from './ParentPortal.jsx';
import SalaryRunStudio from './SalaryRunStudio.jsx';
import TransportWorkbench from './TransportWorkbench.jsx';
import {downloadDocx,downloadHtml,downloadXlsx,printHtml} from './exportUtils.js';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const NAV = [
 ['dashboard','Overview',LayoutDashboard],
 ['mychildren','My children & payments',Users],['payroll','Salary disbursements',Wallet],
 ['admissions','Admissions',ClipboardCheck],['students','Students',Users],['guardians','Parents & Guardians',Users],
 ['classes','Classes & Streams',BookOpen],['academics','Academics & Subjects',GraduationCap],['attendance','Attendance',CalendarDays],
 ['fees','Fees & Invoices',Wallet],['payments','Payments & Receipts',Wallet],['expenses','Expenses & Cashbook',Wallet],
 ['hr','Staff & HR',BriefcaseBusiness],['examinations','Examinations & Results',BookOpen],
 ['inventory','Inventory & Stores',Package],['procurement','Suppliers & Procurement',Package],
 ['transport','Transport & Buses',Bus],['timetable','Timetable & Calendar',CalendarDays],
 ['communications','Announcements',MessageSquare],['newsletter','Newsletter Studio',Mail],['reportcards','Report Card Studio',FileText],['idcards','Student ID Cards',FileText],['accounting','Accounting & Cashbooks',Wallet],['notifications','Alerts & Conflicts',MessageSquare],['assistant','AI Staff Assistant',GraduationCap],['schools','Linked Schools',BriefcaseBusiness],['audit','Director Audit Log',ShieldCheck],['reports','Reports & Analytics',FileText],['documents','Documents & Certificates',FileText],['settings','System Settings',Settings]
];
const ROLE_LABEL = { SYSTEM_ADMIN:'System Administrator', HEADTEACHER:'Headteacher', EXAM_OFFICER:'Chief Examinations Officer', DIRECTOR:'Director', BURSAR:'Bursar / Accountant', TEACHER:'Teacher', ADMISSIONS:'Admissions Officer', STOREKEEPER:'Storekeeper', TRANSPORT_MANAGER:'Transport Manager', DRIVER:'Driver', PARENT:'Parent / Guardian', STUDENT:'Student' };
const CUSTOM_SCREENS=['newsletter','reportcards','accounting','payments','payroll','mychildren','notifications','assistant','schools','audit','idcards'];
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));}
function normalizeSchoolTheme(theme={}){const legacy={'#16804a':'#15803D','#36a9dc':'#0284C7'};const green=String(theme.green||'').toLowerCase(),sky=String(theme.sky||'').toLowerCase();return{...theme,...(green?{green:legacy[green]||theme.green}:{}),...(sky?{sky:legacy[sky]||theme.sky}:{})};}
function App(){
 const [token,setToken]=useState(localStorage.getItem('nz_token')||'');
 const [user,setUser]=useState(JSON.parse(localStorage.getItem('nz_user')||'null'));
  const [logoSrc,setLogoSrc]=useState('/nest-ziwa-crest.png');
 const [active,setActive]=useState('dashboard');
 const [records,setRecords]=useState([]);
 const [moduleInfo,setModuleInfo]=useState(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [query,setQuery]=useState('');
 const [showForm,setShowForm]=useState(false);
 const [formTitle,setFormTitle]=useState('');
 const [formData,setFormData]=useState({});
  const [editingRecordId,setEditingRecordId]=useState('');
  const [admissionSuggestion,setAdmissionSuggestion]=useState('');
  const [importing,setImporting]=useState(false);
  const [importMessage,setImportMessage]=useState('');
  const [accountingNotice,setAccountingNotice]=useState('');
  const [studentProfile,setStudentProfile]=useState(null);
  const [reportCardStudentId,setReportCardStudentId]=useState('');
  const [idCardStudentId,setIdCardStudentId]=useState('');
  const [studentClassFilter,setStudentClassFilter]=useState('');
  const [studentStatusFilter,setStudentStatusFilter]=useState('');
  const [balanceMin,setBalanceMin]=useState('');
  const [balanceMax,setBalanceMax]=useState('');
  const [balanceStatusFilter,setBalanceStatusFilter]=useState('');
  const [studentBalances,setStudentBalances]=useState({});
  const [studentChoices,setStudentChoices]=useState([]);
  const [marklistClass,setMarklistClass]=useState('');
  const fileInputRef=React.useRef(null);
  const photoInputRef=React.useRef(null);
  const [photoImporting,setPhotoImporting]=useState(false);
  const [photoImportMessage,setPhotoImportMessage]=useState('');
 const [mobileOpen,setMobileOpen]=useState(false);
 const allowed = useMemo(()=>NAV.filter(([key])=>key==='dashboard'||!user||true),[user]);
 async function request(path,opts={}){
  const res=await fetch(`${API}${path}`,{...opts,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...(opts.headers||{})}});
  const data=await res.json().catch(()=>({}));
   if(!res.ok) throw Object.assign(new Error(data.message||'Request failed'),{nextAdmissionNumber:data.nextAdmissionNumber});
  return data;
 }
 async function login(email,password){
  const data=await request('/auth/login',{method:'POST',body:JSON.stringify({email,password})});
  localStorage.setItem('nz_token',data.token);localStorage.setItem('nz_user',JSON.stringify(data.user));setToken(data.token);setUser(data.user);
 }
 function logout(){request('/auth/logout',{method:'POST'}).catch(()=>{});localStorage.removeItem('nz_token');localStorage.removeItem('nz_user');setToken('');setUser(null);setActive('dashboard');}
  useEffect(()=>{
   let objectUrl='';
   fetch(`${API}/public/logo`,{cache:'no-store'}).then(response=>response.ok?response.blob():null).then(blob=>{if(blob){objectUrl=URL.createObjectURL(blob);setLogoSrc(objectUrl);}}).catch(()=>{});
   return ()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[]);
  useEffect(()=>{let alive=true;const apply=value=>{const theme=normalizeSchoolTheme(value);if(theme?.green)document.documentElement.style.setProperty('--theme-green',theme.green);if(theme?.sky)document.documentElement.style.setProperty('--theme-sky',theme.sky);return theme;};try{const local=JSON.parse(localStorage.getItem('nz_theme')||'{}');const normalized=apply(local);localStorage.setItem('nz_theme',JSON.stringify(normalized));}catch{}fetch(`${API}/public/theme`).then(response=>response.ok?response.json():null).then(theme=>{if(alive&&theme){const normalized=apply(theme);localStorage.setItem('nz_theme',JSON.stringify(normalized));}}).catch(()=>{});return()=>{alive=false;};},[]);
 useEffect(()=>{if(token&&!user){request('/auth/me').then(d=>setUser(d.user)).catch(logout)}},[token]);
  useEffect(()=>{if(active==='students'&&['SYSTEM_ADMIN','HEADTEACHER','BURSAR','DIRECTOR'].includes(user?.role))request('/accounting/student-balances').then(d=>setStudentBalances(Object.fromEntries((d.balances||[]).map(row=>[row.admissionNumber,row])))).catch(()=>setStudentBalances({}));},[active,user?.role]);
  useEffect(()=>{if(!token||!showForm||active==='students'||!(moduleInfo?.fields||[]).some(field=>/student|admission number/i.test(field))){setStudentChoices([]);return;}let alive=true;request('/records/students').then(data=>{if(alive)setStudentChoices(data.records||[]);}).catch(()=>{if(alive)setStudentChoices([]);});if(['SYSTEM_ADMIN','HEADTEACHER','BURSAR','DIRECTOR'].includes(user?.role))request('/accounting/student-balances').then(data=>{if(alive)setStudentBalances(Object.fromEntries((data.balances||[]).map(row=>[row.admissionNumber,row])));}).catch(()=>{});return()=>{alive=false;};},[token,showForm,active,moduleInfo?.fields?.join(','),user?.role]);
  useEffect(()=>{if(token&&active!=='dashboard'&&!CUSTOM_SCREENS.includes(active))loadRecords(active);},[token,active]);
  useEffect(()=>{if(active==='examinations'&&moduleInfo?.options?.Class?.length)setMarklistClass(current=>current||moduleInfo.options.Class[0]);},[active,moduleInfo]);
  useEffect(()=>{
   if(!token||active!=='students'||!showForm){setAdmissionSuggestion('');return;}
   let cancelled=false;
   request('/records/admission-number/suggest').then(({nextAdmissionNumber})=>{
    if(cancelled)return;
    setAdmissionSuggestion(nextAdmissionNumber);
    setFormData(current=>current['Admission number']?current:{...current,'Admission number':nextAdmissionNumber});
   }).catch(e=>{if(!cancelled)setError(e.message)});
   return ()=>{cancelled=true;};
  },[showForm,active,token]);
  async function loadRecords(module){setLoading(true);setError('');try{const d=await request(`/records/${module}`);setRecords(d.records||[]);setModuleInfo(d.module);}catch(e){setError(e.message);setRecords([])}finally{setLoading(false)}}
  function updateField(field,value){setFormData(current=>({...current,[field]:/name/i.test(field)?String(value).toUpperCase():value}));}
  function editRecord(record){setEditingRecordId(record.id);setFormTitle(record.title||'');setFormData(record.data||{});setImportMessage('');setError('');setShowForm(true);}
  function openStudentProfile(record){setStudentProfile(record);}
  async function downloadStudentTemplate(){
   const XLSX=await import('xlsx');
   const columns=['Admission number','Full name','Section','Class','Date of birth','Status','Record title'];
   const studentsSheet=XLSX.utils.aoa_to_sheet([columns]);
   studentsSheet['!cols']=[{wch:22},{wch:30},{wch:20},{wch:16},{wch:18},{wch:22},{wch:26}];
   const exampleSheet=XLSX.utils.aoa_to_sheet([columns,['','MARY WANJIKU NJOROGE','PRIMARY','GRADE 1','2019-05-14','ACTIVE','NEW STUDENT']]);
   exampleSheet['!cols']=studentsSheet['!cols'];
   const instructionSheet=XLSX.utils.aoa_to_sheet([
    ['NEST ZIWA STUDENT UPLOAD - HOW TO FILL THIS WORKBOOK'],
    ['1. Enter one student per row on the Students sheet. Keep the header row unchanged.'],
    ['2. The Example sheet shows the required format. Do not upload or copy the example row.'],
    ['3. Leave Admission number blank to assign the next available number automatically.'],
    ['4. Enter every name in CAPITAL LETTERS. The system will also convert names to capitals.'],
    ['5. Choose Section from: '+(moduleInfo?.options?.Section||[]).join(', ')],
    ['6. Choose Class from: '+(moduleInfo?.options?.Class||[]).join(', ')],
    ['7. Choose Status from: '+(moduleInfo?.options?.Status||[]).join(', ')],
    ['8. Enter Date of birth as YYYY-MM-DD (for example, 2019-05-14). It may be left blank.'],
    ['9. Record title choices: '+(moduleInfo?.titleOptions||[]).join(', ')],
    ['10. Remove all example or blank rows before upload. Maximum 500 students per file.']
   ]);
   instructionSheet['!cols']=[{wch:120}];
   const workbook=XLSX.utils.book_new();
   XLSX.utils.book_append_sheet(workbook,studentsSheet,'Students');
   XLSX.utils.book_append_sheet(workbook,exampleSheet,'Example');
   XLSX.utils.book_append_sheet(workbook,instructionSheet,'Instructions');
   XLSX.writeFile(workbook,'Nest-Ziwa-Student-Upload-Template.xlsx');
  }
  function excelDate(value,XLSX){
   if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
   if(typeof value==='number'){
    const parsed=XLSX.SSF.parse_date_code(value);
    if(parsed)return `${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;
   }
   return String(value??'').trim();
  }
  async function importStudents(event){
   const file=event.target.files?.[0];
   if(!file)return;
   setImporting(true);setError('');setImportMessage('');
   try{
    const XLSX=await import('xlsx');
    const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});
    const sheet=workbook.Sheets.Students||workbook.Sheets[workbook.SheetNames[0]];
    if(!sheet)throw new Error('The workbook does not contain a Students sheet. Download the template and fill that sheet.');
    const rows=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:true});
    const keyFor=value=>String(value).trim().toLowerCase().replace(/\s+/g,' ');
    const read=(row,label)=>{
     const target=keyFor(label);
     const key=Object.keys(row).find(column=>keyFor(column)===target);
     return key?row[key]:'';
    };
    const populated=rows.filter(row=>Object.values(row).some(value=>String(value??'').trim()!==''));
    if(!populated.length)throw new Error('No student rows found. Fill the Students sheet and try again.');
    if(populated.length>500)throw new Error('Upload up to 500 students at a time.');
    const recordsToImport=populated.map(row=>({
     title:String(read(row,'Record title')||'NEW STUDENT').trim().toUpperCase(),
     data:{
      'Admission number':String(read(row,'Admission number')||'').trim().toUpperCase(),
      'Full name':String(read(row,'Full name')||'').trim().toUpperCase(),
      Section:String(read(row,'Section')||'').trim().toUpperCase(),
      Class:String(read(row,'Class')||'').trim().toUpperCase(),
      'Date of birth':excelDate(read(row,'Date of birth'),XLSX),
      Status:String(read(row,'Status')||'').trim().toUpperCase()
     }
    }));
    const result=await request('/records/students/import',{method:'POST',body:JSON.stringify({records:recordsToImport})});
    setImportMessage(`Imported ${result.imported} students. Admission numbers were checked and any blank numbers were assigned automatically.`);
    loadRecords('students');
   }catch(e){setError(e.message)}finally{setImporting(false);event.target.value='';}
  }
  function compressPhoto(file){return new Promise((resolve,reject)=>{const image=new Image();const source=URL.createObjectURL(file);image.onload=()=>{const scale=Math.min(1,1000/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);URL.revokeObjectURL(source);resolve(canvas.toDataURL('image/jpeg',.82));};image.onerror=()=>{URL.revokeObjectURL(source);reject(new Error(`Could not read ${file.name}.`));};image.src=source;});}
  async function importStudentPhotos(event){
   const files=[...(event.target.files||[])];if(!files.length)return;setPhotoImporting(true);setPhotoImportMessage('');setError('');let uploaded=0;const unmatched=[];const normalize=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
   try{for(const file of files){const stem=file.name.replace(/\.[^.]+$/,'');const key=normalize(stem);const student=records.find(row=>normalize(row.data?.['Admission number'])===key)||records.find(row=>normalize(row.data?.['Full name'])===key);if(!student){unmatched.push(file.name);continue;}const dataUrl=await compressPhoto(file);await request(`/records/students/${student.id}/photo`,{method:'POST',body:JSON.stringify({fileName:file.name,mimeType:'image/jpeg',dataBase64:dataUrl.split(',')[1]})});uploaded++;}
    setPhotoImportMessage(`Added photos to ${uploaded} student record${uploaded===1?'':'s'}.${unmatched.length?` Could not match: ${unmatched.join(', ')}. Name each image with the student's admission number to match it automatically.`:''}`);
   }catch(e){setError(`Photo upload stopped after ${uploaded} photo${uploaded===1?'':'s'}: ${e.message}`);}finally{setPhotoImporting(false);event.target.value='';}
  }
  async function downloadMarkList(){
   const XLSX=await import('xlsx');
   const studentData=await request('/records/students');
   const classStudents=(studentData.records||[]).filter(student=>student.data?.Class===marklistClass).sort((a,b)=>String(a.data?.['Full name']||'').localeCompare(String(b.data?.['Full name']||'')));
   const classResults=records.filter(record=>record.data?.Class===marklistClass);
   const columns=['No.','Admission number','Full name','Section','Class','Assessment','Term','Subject','Score','Maximum score','Grade','Teacher remarks'];
   const rows=classStudents.flatMap((student,index)=>{
    const admission=String(student.data?.['Admission number']||'').toUpperCase();
    const matches=classResults.filter(result=>String(result.data?.['Student admission number']||'').trim().toUpperCase()===admission);
    return (matches.length?matches:[null]).map(result=>[index+1,admission,student.data?.['Full name']||'',student.data?.Section||'',student.data?.Class||'',result?.data?.Assessment||'',result?.data?.Term||'',result?.data?.Subject||'',result?.data?.Score??'',result?.data?.['Maximum score']??'',result?.data?.Grade||'',result?.data?.Remarks||'']);
   });
   const sheet=XLSX.utils.aoa_to_sheet([[`NEST ZIWA SCHOOLS - ${marklistClass} CLASS MARK LIST`],columns,...rows]);
   sheet['!cols']=columns.map((column,index)=>({wch:index<5?22:18}));
   const workbook=XLSX.utils.book_new();
   XLSX.utils.book_append_sheet(workbook,sheet,'Class Mark List');
   XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Instructions'],['Fill score, maximum score, grade, and teacher remarks after assessment.'],['Student and class details are copied from the school student register.'],['If marks exist in the Examinations module, they are included as of the download date.']]),'Instructions');
   XLSX.writeFile(workbook,`Nest-Ziwa-${marklistClass.replace(/\s+/g,'-')}-Mark-List.xlsx`);
  }
  async function saveRecord(e){
   e.preventDefault();
   const editing=Boolean(editingRecordId);
   const path=editing?`/records/${active}/${editingRecordId}`:`/records/${active}`;
   try{
    const saved=await request(path,{method:editing?'PATCH':'POST',body:JSON.stringify({title:formTitle,data:formData})});
    if(['fees','payments','expenses'].includes(active)&&saved.accounting)setAccountingNotice(saved.accounting.posted?`Posted to double-entry ledger as ${saved.accounting.entryNumber}.`:saved.accounting.message||'Financial record saved for review.');
    setShowForm(false);setEditingRecordId('');setFormTitle('');setFormData({});loadRecords(active);
   }catch(e){setError(e.message);if(e.nextAdmissionNumber){setAdmissionSuggestion(e.nextAdmissionNumber);setFormData(current=>({...current,'Admission number':e.nextAdmissionNumber}));}}
  }
 async function deleteRecord(id){if(!confirm('Delete this record?'))return;try{await request(`/records/${active}/${id}`,{method:'DELETE'});loadRecords(active)}catch(e){setError(e.message)}}
 const visible=records.filter(r=>{const data=r.data||{};if(!(r.title+' '+JSON.stringify(data)).toLowerCase().includes(query.toLowerCase()))return false;if(active==='students'){const balance=studentBalances[String(data['Admission number']||'').toUpperCase()];if(studentClassFilter&&data.Class!==studentClassFilter)return false;if(studentStatusFilter&&data.Status!==studentStatusFilter)return false;if(balanceMin!==''&&Number(balance?.balance||0)<Number(balanceMin))return false;if(balanceMax!==''&&Number(balance?.balance||0)>Number(balanceMax))return false;if(balanceStatusFilter&&balance?.status!==balanceStatusFilter)return false;}if(active==='fees'){const amount=Number(data['Amount (KES)']??data.Amount??data.Balance??data['Fee balance']??0);if(balanceMin!==''&&amount<Number(balanceMin))return false;if(balanceMax!==''&&amount>Number(balanceMax))return false;if(studentStatusFilter&&String(data.Status||'').toUpperCase()!==studentStatusFilter)return false;}return true;});
 async function exportStudents(format){const columns=['Admission number','Full name','Section','Class','Date of birth','Status','Fee total','Paid','Balance'];const rows=visible.map(row=>{const d=row.data||{},b=studentBalances[String(d['Admission number']||'').toUpperCase()]||{};return[d['Admission number'],d['Full name'],d.Section,d.Class,d['Date of birth'],d.Status,b.fees??'',b.paid??'',b.balance??''];});if(format==='xlsx')await downloadXlsx('Students',columns,rows,'Nest-Ziwa-Filtered-Students.xlsx');if(format==='docx')downloadDocx('Filtered Student Register',columns,rows,'Nest-Ziwa-Student-Register.docx',logoSrc);if(format==='html')downloadHtml('Filtered Student Register',columns,rows,'Nest-Ziwa-Student-Register.html',logoSrc);if(format==='print')printHtml('Filtered Student Register',columns,rows,logoSrc);}
 async function exportCurrentRecords(format){const columns=moduleInfo?.fields?.length?moduleInfo.fields:Object.keys(visible[0]?.data||{});const rows=visible.map(record=>columns.map(column=>record.data?.[column]??''));const title=moduleInfo?.label||current?.[1]||'School report';const base=title.toLowerCase().replace(/[^a-z0-9]+/g,'-');if(format==='xlsx')await downloadXlsx(title,columns,rows,`Nest-Ziwa-${base}.xlsx`);if(format==='docx')downloadDocx(title,columns,rows,`Nest-Ziwa-${base}.docx`,logoSrc);if(format==='html')downloadHtml(title,columns,rows,`Nest-Ziwa-${base}.html`,logoSrc);if(format==='print')printHtml(title,columns,rows,logoSrc);}
  if(!token||!user)return <Login onLogin={login} logoSrc={logoSrc}/>;
  if(user.mustChangePassword)return <ChangePassword user={user} onComplete={async(currentPassword,newPassword)=>{const data=await request('/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})});localStorage.setItem('nz_user',JSON.stringify(data.user));setUser(data.user);}}/>;
 const current=NAV.find(x=>x[0]===active);
  const customScreen=active==='newsletter'?<NewsletterDesigner request={request} logoSrc={logoSrc}/>:active==='reportcards'?<ReportCardStudio request={request} records={records} logoSrc={logoSrc} initialStudentId={reportCardStudentId}/>:active==='accounting'?<FinanceWorkbench request={request} user={user} logoSrc={logoSrc} onOpenPayments={()=>setActive('payments')}/>:active==='payments'?<><PaymentVerificationStudio request={request} user={user} logoSrc={logoSrc}/><PaymentPromptConsole request={request} user={user}/></>:active==='payroll'?<SalaryRunStudio request={request} user={user}/>:active==='mychildren'?<ParentPortal request={request} user={user} token={token} logoSrc={logoSrc}/>:active==='notifications'?<AlertCenter request={request}/>:active==='assistant'?<AssistantPanel request={request}/>:active==='schools'||active==='audit'?<DirectorWorkspace request={request} mode={active}/>:active==='idcards'?<StudentIDStudio request={request} token={token} logoSrc={logoSrc} initialStudentId={idCardStudentId}/>:null;
 return <div className="shell theme-school">
  <aside className={`sidebar ${mobileOpen?'open':''}`}>
    <div className="brand"><img className="brand-mark-image" src={logoSrc} alt="Nest Ziwa Schools crest"/><div><b>NEST ZIWA</b><small>SCHOOL MANAGEMENT</small></div><button className="mobile-close" onClick={()=>setMobileOpen(false)}><X/></button></div>
   <div className="school-label">VIRTUES ARE SUCCESS.</div>
     <nav>{NAV.filter(([key])=>{const role=user.role;const screenRoles={payments:['SYSTEM_ADMIN','HEADTEACHER','BURSAR'],payroll:['DIRECTOR'],mychildren:['PARENT'],reportcards:['SYSTEM_ADMIN','HEADTEACHER','EXAM_OFFICER','TEACHER'],idcards:['SYSTEM_ADMIN','HEADTEACHER','ADMISSIONS','TEACHER'],accounting:['SYSTEM_ADMIN','HEADTEACHER','BURSAR','DIRECTOR'],notifications:['SYSTEM_ADMIN','HEADTEACHER','BURSAR','EXAM_OFFICER','TEACHER','ADMISSIONS','STOREKEEPER','TRANSPORT_MANAGER','DIRECTOR'],assistant:['SYSTEM_ADMIN','HEADTEACHER','BURSAR','TEACHER','EXAM_OFFICER','ADMISSIONS','DIRECTOR'],schools:['DIRECTOR'],audit:['DIRECTOR'],settings:['SYSTEM_ADMIN','HEADTEACHER']};return(!screenRoles[key]||screenRoles[key].includes(role))&&(role!=='STUDENT'||['dashboard','students','examinations'].includes(key))&&(role!=='PARENT'||['dashboard','mychildren'].includes(key));}).map(([key,label,Icon])=><button key={key} className={`nav-item ${active===key?'selected':''}`} onClick={()=>{setActive(key);setMobileOpen(false)}}><Icon size={18}/><span>{label}</span></button>)}</nav>
   <div className="sidebar-bottom"><ShieldCheck size={16}/><span>Secure school workspace</span></div>
  </aside>
  <main className="main">
   <header className="topbar"><button className="menu-btn" onClick={()=>setMobileOpen(true)}><Menu/></button><div className="crumb">Nest Ziwa <span>/</span> {current?.[1]||'Overview'}</div><div className="user-area"><div className="avatar">{user.name?.[0]||'N'}</div><div className="user-meta"><b>{user.name}</b><small>{ROLE_LABEL[user.role]||user.role}</small></div><button className="icon-btn" title="Sign out" onClick={logout}><LogOut size={18}/></button></div></header>
   <section className="content">
      {active==='dashboard'?(user.role==='STUDENT'?<StudentDashboard request={request} user={user} token={token} logoSrc={logoSrc}/>:user.role==='PARENT'?<ParentPortal request={request} user={user} token={token} logoSrc={logoSrc}/>:<Dashboard user={user} onNavigate={setActive} logoSrc={logoSrc}/>):customScreen||<div className="page-head"><div><div className="eyebrow">SCHOOL OPERATIONS</div><h1>{moduleInfo?.label||current?.[1]}</h1><p>Manage {current?.[1]?.toLowerCase()} records for Nest Ziwa Schools.</p></div><div className="page-actions">{active==='students'&&<><button className="secondary-btn" onClick={downloadStudentTemplate}><Download size={16}/> Excel template</button><button className="secondary-btn" onClick={()=>fileInputRef.current?.click()} disabled={importing}><Upload size={16}/>{importing?'Uploading...':'Upload students'}</button><input ref={fileInputRef} className="visually-hidden" type="file" accept=".xlsx,.xls,.csv" onChange={importStudents}/><button className="secondary-btn" onClick={()=>photoInputRef.current?.click()} disabled={photoImporting}><Upload size={16}/>{photoImporting?'Uploading photos...':'Bulk student photos'}</button><input ref={photoInputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={importStudentPhotos}/></>}{active==='students'&&<button className="secondary-btn" onClick={()=>setActive('idcards')}><FileText size={16}/> Print ID cards</button>}{active==='examinations'&&<div className="exam-marklist-controls"><select aria-label="Mark list class" value={marklistClass} onChange={e=>setMarklistClass(e.target.value)}>{(moduleInfo?.options?.Class||[]).map(option=><option key={option} value={option}>{option}</option>)}</select><button className="secondary-btn" onClick={downloadMarkList}><Download size={16}/> Class mark list</button></div>}{user.role!=='BURSAR'&&<button className="primary-btn" onClick={()=>{setEditingRecordId('');setFormTitle(moduleInfo?.titleOptions?.[0]||'');setFormData({});setImportMessage('');setError('');setShowForm(true)}}><Plus size={17}/> Add record</button>}</div></div>}
     {active==='transport'&&<TransportWorkbench request={request} user={user} onOpenStudent={openStudentProfile}/>}
     {active!=='dashboard'&&!CUSTOM_SCREENS.includes(active)&&<><div className="toolbar"><div className="searchbox"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search records..."/></div><button className="secondary-btn" onClick={()=>loadRecords(active)}><RefreshCw size={16}/> Refresh</button></div>
    {active==='students'&&<><div className="student-filter-row"><label>Class<select value={studentClassFilter} onChange={e=>setStudentClassFilter(e.target.value)}><option value="">All classes</option>{(moduleInfo?.options?.Class||[]).map(value=><option key={value}>{value}</option>)}</select></label><label>Student status<select value={studentStatusFilter} onChange={e=>setStudentStatusFilter(e.target.value)}><option value="">All statuses</option>{(moduleInfo?.options?.Status||[]).map(value=><option key={value}>{value}</option>)}</select></label>{['SYSTEM_ADMIN','HEADTEACHER','BURSAR','DIRECTOR'].includes(user.role)&&<><label>Balance status<select value={balanceStatusFilter} onChange={e=>setBalanceStatusFilter(e.target.value)}><option value="">Any balance</option><option>OWING</option><option>CLEAR</option><option>CREDIT</option></select></label><label>Minimum balance<input type="number" value={balanceMin} onChange={e=>setBalanceMin(e.target.value)}/></label><label>Maximum balance<input type="number" value={balanceMax} onChange={e=>setBalanceMax(e.target.value)}/></label></>}<button className="secondary-btn" onClick={()=>{setStudentClassFilter('');setStudentStatusFilter('');setBalanceStatusFilter('');setBalanceMin('');setBalanceMax('');setQuery('');}}>Clear filters</button></div><div className="export-actions"><button className="secondary-btn" onClick={()=>exportStudents('xlsx')}>Excel</button><button className="secondary-btn" onClick={()=>exportStudents('docx')}>Word</button><button className="secondary-btn" onClick={()=>exportStudents('html')}>Download report</button><button className="secondary-btn" onClick={()=>exportStudents('print')}><Download size={14}/> Print / PDF</button></div></>}
      {active==='fees'&&<><div className="student-filter-row"><label>Minimum amount<input type="number" min="0" value={balanceMin} onChange={e=>setBalanceMin(e.target.value)}/></label><label>Maximum amount<input type="number" min="0" value={balanceMax} onChange={e=>setBalanceMax(e.target.value)}/></label><label>Payment status<select value={studentStatusFilter} onChange={e=>setStudentStatusFilter(e.target.value)}><option value="">All statuses</option>{(moduleInfo?.options?.Status||[]).map(value=><option key={value}>{value}</option>)}</select></label></div><div className="export-actions"><button className="secondary-btn" onClick={()=>exportCurrentRecords('xlsx')}>Excel</button><button className="secondary-btn" onClick={()=>exportCurrentRecords('docx')}>Word</button><button className="secondary-btn" onClick={()=>exportCurrentRecords('html')}>Download report</button><button className="secondary-btn" onClick={()=>exportCurrentRecords('print')}>Print / PDF</button></div></>}
      {active==='settings'&&<><ThemeSettings request={request}/><ImageAssetTools request={request} token={token} logoSrc={logoSrc} onLogoChange={setLogoSrc}/><WhatsAppSettings request={request}/>{user.role==='SYSTEM_ADMIN'&&<UserManagement request={request}/>}</>}
      {active==='students'&&importMessage&&<div className="success-banner"><FileSpreadsheet size={17}/>{importMessage}</div>}
      {active==='students'&&photoImportMessage&&<div className="success-banner"><Upload size={17}/>{photoImportMessage}</div>}
      {accountingNotice&&['fees','payments','expenses','accounting'].includes(active)&&<div className="success-banner"><FileSpreadsheet size={17}/>{accountingNotice}</div>}
      {error&&<div className="alert">{error}</div>}
      {showForm&&<form className="record-form" onSubmit={saveRecord}>
       <div className="form-head"><b>{editingRecordId?'Update':'New'} {moduleInfo?.label||'record'}</b><button type="button" className="icon-btn" onClick={()=>{setShowForm(false);setEditingRecordId('')}}><X size={18}/></button></div>
       <label>{active==='students'?'Record title / student type':'Record title'}<input required list={moduleInfo?.titleOptions?.length?'record-title-options':undefined} value={formTitle} onChange={e=>setFormTitle(e.target.value.toUpperCase())} placeholder="Choose or enter a title"/>{moduleInfo?.titleOptions?.length>0&&<datalist id="record-title-options">{moduleInfo.titleOptions.map(option=><option key={option} value={option}/>)}</datalist>}</label>
       <div className="field-grid">{(moduleInfo?.fields||[]).map(field=>{
        const options=moduleInfo?.options?.[field]||[];
        const required=active==='students'&&['Full name','Class','Section','Status'].includes(field);
        const value=formData[field]??'';
        const studentValueKey=field==='Student'?'fullName':/admission number/i.test(field)?'admissionNumber':'';
        const useStudentSelector=Boolean(studentValueKey&&studentChoices.length);
        return <div className="record-field" key={field}>{useStudentSelector?<SearchableStudentSelect students={studentChoices} value={String(value)} valueKey={studentValueKey} balances={['SYSTEM_ADMIN','HEADTEACHER','BURSAR','DIRECTOR'].includes(user.role)?studentBalances:{}} label={field} onChange={selected=>updateField(field,selected)}/>:<label>{field}{options.length>0?<select required={required} value={value} onChange={e=>updateField(field,e.target.value)}><option value="">Select {field.toLowerCase()}</option>{value&&!options.includes(value)&&<option value={value}>{value}</option>}{options.map(option=><option key={option} value={option}>{option}</option>)}</select>:<input required={required} type={field==='Date of birth'?'date':'text'} list={active==='students'&&field==='Admission number'?'admission-number-options':undefined} autoComplete={field==='Admission number'?'off':undefined} value={value} onChange={e=>updateField(field,e.target.value)} placeholder={field}/>}</label>}
         {active==='students'&&field==='Admission number'&&<><datalist id="admission-number-options">{admissionSuggestion&&<option value={admissionSuggestion}/>}</datalist><small className="admission-number-hint">Next available: <b>{admissionSuggestion||'Checking...'}</b></small></>}
         {moduleInfo?.fieldHelp?.[field]&&<small className="field-help">{moduleInfo.fieldHelp[field]}</small>}
        </div>;
       })}</div>
       <div className="form-actions"><button type="button" className="secondary-btn" onClick={()=>{setShowForm(false);setEditingRecordId('')}}>Cancel</button><button className="primary-btn">{editingRecordId?'Update record':'Save record'}</button></div>
      </form>}
      <div className="records-card">{loading?<div className="empty"><RefreshCw className="spin"/> Loading records...</div>:visible.length===0?<div className="empty"><FileText size={30}/><b>No records found</b><span>Create your first record using Add record.</span></div>:<div className="record-list">{visible.map(r=>{const admission=String(r.data?.['Admission number']||'').toUpperCase();const balance=studentBalances[admission];return <div className="record-row" key={r.id}><div className="record-icon"><FileText size={18}/></div><div className="record-copy"><b>{active==='students'?<button className="student-name" onClick={()=>openStudentProfile(r)}>{r.data?.['Full name']||r.title}</button>:r.title}</b><small>{active==='students'&&r.data?.['Admission number']?r.data['Admission number']+' · ':''}{Object.entries(r.data||{}).filter(([,v])=>v).slice(0,3).map(([k,v])=>k+': '+v).join(' · ')||'No additional details'}</small>{active==='students'&&balance&&['SYSTEM_ADMIN','HEADTEACHER','BURSAR','DIRECTOR'].includes(user.role)&&<small>Fee balance: {balance.balance.toFixed(2)} · {balance.status}</small>}{active==='students'&&balance&&Object.keys(balance.itemBalances||{}).length>0&&<small>In-kind balances: {Object.entries(balance.itemBalances).flatMap(([item,units])=>Object.entries(units).map(([unit,value])=>`${item.replace('_',' ')} ${value.balance} ${unit}`)).join(' · ')}</small>}<small>Updated {new Date(r.updatedAt).toLocaleString()}</small></div>{user.role!=='BURSAR'&&<button className="icon-btn edit-btn" aria-label={'Edit '+r.title} title="Edit record" onClick={()=>editRecord(r)}><Pencil size={16}/></button>}{['SYSTEM_ADMIN','HEADTEACHER'].includes(user.role)&&<button className="delete-btn" onClick={()=>deleteRecord(r.id)}>Delete</button>}</div>;})}</div>}</div>
    </>}
   {studentProfile&&<StudentProfilePanel record={studentProfile} token={token} user={user} request={request} onClose={()=>setStudentProfile(null)} onEdit={!['BURSAR','STUDENT'].includes(user.role)?()=>{editRecord(studentProfile);setStudentProfile(null);}:undefined} onReportCard={['SYSTEM_ADMIN','HEADTEACHER','EXAM_OFFICER','TEACHER'].includes(user.role)?()=>{setReportCardStudentId(studentProfile.id);setStudentProfile(null);setActive('reportcards');}:undefined} onIdCard={['SYSTEM_ADMIN','HEADTEACHER','ADMISSIONS','TEACHER'].includes(user.role)?()=>{setIdCardStudentId(studentProfile.id);setStudentProfile(null);setActive('idcards');}:undefined} onOpenFinance={['SYSTEM_ADMIN','HEADTEACHER','BURSAR'].includes(user.role)?()=>{setStudentProfile(null);setActive('payments');}:undefined} onOpenSibling={sibling=>setStudentProfile(sibling)} logoSrc={logoSrc}/>}
    </section>
  </main>
  <FloatingAssistant request={request} user={user} module={active}/>
 </div>;
}
function Login({onLogin,logoSrc}){
 const [email,setEmail]=useState('admin@nestziwa.ac.ke'),[password,setPassword]=useState('ChangeMe123!'),[showPassword,setShowPassword]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(e){e.preventDefault();setBusy(true);setError('');try{await onLogin(email,password)}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <div className="login-page"><div className="login-art"><img className="login-logo-image" src="/nest-ziwa-crest.png" alt="Nest Ziwa Schools crest"/><div className="login-brand">NEST ZIWA <span>SCHOOLS</span></div><h1>Virtues are<br/><em>Success.</em></h1><p>One connected platform for school administration, learning and growth.</p><div className="art-footer">PRIMARY & SECONDARY EDUCATION</div></div><div className="login-panel"><form onSubmit={submit} className="login-form"><div className="eyebrow">WELCOME BACK</div><h2>Sign in to your workspace</h2><p>Use your authorized school account to continue.</p><label>Email address<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<div className="password-input-wrap"><input id="login-password" type={showPassword?'text':'password'} required value={password} onChange={e=>setPassword(e.target.value)}/><button className="password-visibility" type="button" aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} aria-controls="login-password" onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff size={17}/>:<Eye size={17}/>}</button></div></label>{error&&<div className="alert">{error}</div>}<button className="primary-btn full" disabled={busy}>{busy?'Signing in...':'Sign in securely'}</button><small className="login-note">Development seed account is shown for first-time setup. Change its password before real use.</small></form></div></div>
}
function Dashboard({user,onNavigate,logoSrc}){
 const tiles=[['students','Student records','Admissions and learner profiles',Users],['fees','Fees & finance','Billing, collections and balances',Wallet],['attendance','Attendance','Daily learner attendance',ClipboardCheck],['examinations','Academic results','Assessments and performance',BookOpen],['hr','Staff & HR','Staff records and operations',BriefcaseBusiness],['inventory','Stores & inventory','Stock and procurement',Package],['transport','Transport','Buses and route records',Bus],['communications','Communication','Notices and announcements',MessageSquare],['newsletter','Newsletter Studio','Design school updates',Mail]];
 return <><div className="welcome"><div><div className="eyebrow">SCHOOL ADMINISTRATION</div><h1>Good day, {user.name.split(' ')[0]}.</h1><p>Welcome to the Nest Ziwa Schools management workspace.</p></div><div className="welcome-seal"><img src="/nest-ziwa-crest.png" alt="Nest Ziwa Schools crest"/></div></div><div className="stat-grid"><div className="stat-card"><span>School sections</span><b>02</b><small>Primary & Secondary</small></div><div className="stat-card"><span>Platform status</span><b className="status-ok">Ready</b><small>Development environment</small></div><div className="stat-card"><span>Your access</span><b className="stat-role">{ROLE_LABEL[user.role]||user.role}</b><small>Role-based workspace</small></div></div><div className="section-title"><div><h2>School modules</h2><p>Choose a module to manage its records.</p></div></div><div className="module-grid">{tiles.map(([key,title,desc,Icon])=><button className="module-card" key={key} onClick={()=>onNavigate(key)}><div className="module-icon"><Icon size={21}/></div><b>{title}</b><span>{desc}</span><div className="module-arrow">Open module →</div></button>)}</div><div className="dashboard-note"><ShieldCheck size={18}/><span>Protect pupil information. Use only authorized accounts and never share login credentials.</span></div></>
}
export default App;

function ChangePassword({user,onComplete}){
 const [current,setCurrent]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(event){event.preventDefault();setError('');if(next!==confirm){setError('The new passwords do not match.');return;}setBusy(true);try{await onComplete(current,next);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <div className="login-page"><div className="login-art"><div className="login-brand">NEST ZIWA <span>SCHOOLS</span></div><h1>Secure your<br/><em>account.</em></h1><p>This student login must have its temporary password changed before records can be viewed.</p></div><div className="login-panel"><form className="login-form" onSubmit={submit}><div className="eyebrow">FIRST SIGN IN</div><h2>Change temporary password</h2><p>{user.email}</p><label>Temporary password<input required minLength="8" type="password" value={current} onChange={event=>setCurrent(event.target.value)}/></label><label>New password<input required minLength="8" type="password" value={next} onChange={event=>setNext(event.target.value)}/></label><label>Confirm new password<input required minLength="8" type="password" value={confirm} onChange={event=>setConfirm(event.target.value)}/></label>{error&&<div className="alert">{error}</div>}<button className="primary-btn full" disabled={busy}>{busy?'Updating...':'Update password'}</button></form></div></div>;
}

function StudentDashboard({request,user,token,logoSrc}){
 const [record,setRecord]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{request('/records/students').then(data=>setRecord(data.records?.[0]||null)).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[user.id]);
 return <div className="student-dashboard">{loading?<div className="empty">Loading your school record...</div>:error?<div className="alert">{error}</div>:record?<StudentProfilePanel record={record} request={request} token={token} user={user} logoSrc={logoSrc} fullPage/>:<div className="empty">Your student record is not available.</div>}</div>;
}

 function StudentProfilePanel({record,request,token,user,onClose,onEdit,onReportCard,onIdCard,onOpenFinance,onOpenSibling,logoSrc,fullPage=false}){
 const data=record.data||{};
 const admission=String(data['Admission number']||'').trim().toUpperCase();
  const [results,setResults]=useState([]),[hub,setHub]=useState(null),[loading,setLoading]=useState(true),[photo,setPhoto]=useState(''),[selectedTerm,setSelectedTerm]=useState('ALL TERMS');
 const [photoBusy,setPhotoBusy]=useState(false),[accountEmail,setAccountEmail]=useState(''),[accountMessage,setAccountMessage]=useState(''),[accountError,setAccountError]=useState(''),[linkBusy,setLinkBusy]=useState(false);
 useEffect(()=>{
  let photoUrl='';let cancelled=false;
   request(`/student-hub/${record.id}`).then(result=>{if(!cancelled){setHub(result.hub);setResults(result.hub?.results||[]);}}).catch(()=>{}).finally(()=>{if(!cancelled)setLoading(false);});
   fetch(`${API}/student-hub/${record.id}/photo`,{headers:{Authorization:`Bearer ${token}`}}).then(response=>response.ok?response.blob():null).then(blob=>{if(blob&&!cancelled){photoUrl=URL.createObjectURL(blob);setPhoto(photoUrl);}}).catch(()=>{});
  return ()=>{cancelled=true;if(photoUrl)URL.revokeObjectURL(photoUrl);};
 },[record.id,token]);
 const terms=[...new Set(results.map(item=>item.data?.Term).filter(Boolean))];
 const visibleResults=selectedTerm==='ALL TERMS'?results:results.filter(item=>item.data?.Term===selectedTerm);
 const chartValues=visibleResults.map(item=>({record:item,score:Number(item.data?.Score)||0,max:Number(item.data?.['Maximum score'])||100}));
 const chartWidth=Math.max(560,chartValues.length*82),chartHeight=250,plotHeight=160;
 const chart=chartValues.length?`<svg viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="Student results chart"><line x1="40" y1="190" x2="${chartWidth-20}" y2="190" stroke="#b8b0c2"/>${chartValues.map((entry,index)=>{const percent=Math.max(0,Math.min(100,entry.score/entry.max*100));const height=percent/100*plotHeight;const x=55+index*82;const subject=String(entry.record.data?.Subject||entry.record.data?.Assessment||'Result').slice(0,12);return `<rect x="${x}" y="${190-height}" width="42" height="${height}" rx="5" fill="#3567b8"/><text x="${x+21}" y="${184-height}" text-anchor="middle" font-size="11" fill="#251b31">${Math.round(percent)}%</text><text x="${x+21}" y="210" text-anchor="middle" font-size="10" fill="#62586e">${escapeHtml(subject)}</text>`;}).join('')}</svg>`:'';
 const rankData=(()=>{
  const current=visibleResults[0];if(!current||user.role==='STUDENT')return null;
  const group=results.filter(item=>item.data?.Assessment===current.data?.Assessment&&item.data?.Class===current.data?.Class&&item.data?.Term===current.data?.Term);
  const totals=new Map();
  for(const item of group){const number=String(item.data?.['Student admission number']||'').toUpperCase();const score=Number(item.data?.Score)||0;const max=Number(item.data?.['Maximum score'])||100;const currentTotal=totals.get(number)||{score:0,max:0};currentTotal.score+=score;currentTotal.max+=max;totals.set(number,currentTotal);}
  const method=current.data?.['Rank by']||'PERCENTAGE';
  const sorted=[...totals.entries()].sort((a,b)=>method==='RAW SCORE'?b[1].score-a[1].score:(b[1].score/b[1].max)-(a[1].score/a[1].max));
  const rank=sorted.findIndex(([number])=>number===admission);
  return rank>=0?{rank:rank+1,total:sorted.length,method}:null;
 })();
 function reportHtml(){
  const rows=visibleResults.map(item=>`<tr><td>${escapeHtml(item.data?.Term||'')}</td><td>${escapeHtml(item.data?.Assessment||'')}</td><td>${escapeHtml(item.data?.Subject||'')}</td><td>${escapeHtml(item.data?.Score??'')}</td><td>${escapeHtml(item.data?.['Maximum score']??'')}</td><td>${escapeHtml(item.data?.Grade||'')}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(data['Full name']||record.title)} - Results</title><style>body{font-family:Arial,sans-serif;color:#211b2c;margin:36px}h1{color:#163b91}table{width:100%;border-collapse:collapse}td,th{padding:9px;border:1px solid #ddd;text-align:left}svg{width:100%;max-height:330px}.school{color:#62586e}</style></head><body><h1>Nest Ziwa Schools</h1><p class="school">STUDENT RESULTS REPORT</p><h2>${escapeHtml(data['Full name']||record.title)}</h2><p>Admission number: ${escapeHtml(admission)} | Class: ${escapeHtml(data.Class||'')} | Section: ${escapeHtml(data.Section||'')}</p>${chart||'<p>No results have been recorded for this student.</p>'}<table><thead><tr><th>Term</th><th>Assessment</th><th>Subject</th><th>Score</th><th>Maximum</th><th>Grade</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
 }
 function downloadResults(){const url=URL.createObjectURL(new Blob([reportHtml()],{type:'text/html'}));const link=document.createElement('a');link.href=url;link.download=`${(data['Full name']||'Student').replace(/\s+/g,'-')}-Results.html`;link.click();URL.revokeObjectURL(url);}
 function printResults(){const win=window.open('','_blank','width=900,height=900');if(!win)return;win.document.write(reportHtml());win.document.close();win.focus();setTimeout(()=>win.print(),250);}
  function printFinancialStatement(){if(!hub)return;const win=window.open('','_blank','width=900,height=900');if(!win)return;const items=(hub.itemBalances||[]).flatMap(row=>row.units.map(unit=>`<tr><td>${escapeHtml(row.item.replaceAll('_',' '))}</td><td>${escapeHtml(unit.unit)}</td><td>${Number(unit.pledged).toFixed(3)}</td><td>${Number(unit.received).toFixed(3)}</td><td>${Number(unit.balance).toFixed(3)}</td></tr>`)).join('');const rides=(hub.transportAssignments||[]).map(row=>`<tr><td>${escapeHtml(row.vehicle?.name||row.vehicle?.registrationNo||'')}</td><td>${escapeHtml(row.route?.name||row.vehicle?.route?.name||'')}</td><td>${Number(row.feeAmount).toFixed(2)}</td><td>${escapeHtml(row.billingCycle)}</td></tr>`).join('');const html=`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(data['Full name']||record.title)} Financial Statement</title><style>body{font:13px Arial;color:#173847;max-width:850px;margin:28px auto}header{display:flex;align-items:center;gap:16px;border-bottom:4px solid #15803d;padding-bottom:12px}header img{width:80px;height:80px;object-fit:contain}h1,h2{color:#166534}table{width:100%;border-collapse:collapse;margin:12px 0}td,th{border:1px solid #d7e8dc;padding:7px;text-align:left}th{background:#f0fdf4}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.summary div{border:1px solid #d7e8dc;padding:12px}</style></head><body><header><img src="${escapeHtml(logoSrc)}"><div><h1>NEST ZIWA SCHOOLS</h1><p>STUDENT ACCOUNT STATEMENT</p></div></header><h2>${escapeHtml(data['Full name']||record.title)}</h2><p>${escapeHtml(admission)} · ${escapeHtml(data.Class||'')}</p><div class="summary"><div>School fee balance<br><b>KES ${Number(Math.max(0,Number(hub.balance||0)-Number(hub.transportBalance||0))).toFixed(2)}</b></div><div>Transport balance<br><b>KES ${Number(hub.transportBalance||0).toFixed(2)}</b></div><div>Total fee balance<br><b>KES ${Number(hub.balance||0).toFixed(2)}</b></div></div><h2>Assigned transport</h2><table><thead><tr><th>Vehicle</th><th>Route</th><th>Fare</th><th>Cycle</th></tr></thead><tbody>${rides||'<tr><td colspan="4">No vehicle assignment.</td></tr>'}</tbody></table><h2>Foodstuffs and school items</h2><table><thead><tr><th>Item</th><th>Unit</th><th>Pledged</th><th>Received</th><th>Balance</th></tr></thead><tbody>${items||'<tr><td colspan="5">No item pledges recorded.</td></tr>'}</tbody></table><script>window.onload=()=>setTimeout(()=>window.print(),200)</script></body></html>`;win.document.write(html);win.document.close();win.focus();}
 async function uploadPhoto(event){const file=event.target.files?.[0];if(!file)return;if(file.size>3*1024*1024){setAccountError('Choose a photo smaller than 3 MB.');return;}setPhotoBusy(true);setAccountError('');try{const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Could not read that photo.'));reader.readAsDataURL(file);});await request(`/records/students/${record.id}/photo`,{method:'POST',body:JSON.stringify({fileName:file.name,mimeType:file.type,dataBase64:dataUrl.split(',')[1]})});const response=await fetch(`${API}/records/students/${record.id}/photo`,{headers:{Authorization:`Bearer ${token}`}});if(response.ok){const nextUrl=URL.createObjectURL(await response.blob());setPhoto(current=>{if(current.startsWith('blob:'))URL.revokeObjectURL(current);return nextUrl;});}}catch(e){setAccountError(e.message);}finally{setPhotoBusy(false);event.target.value='';}}
 async function linkAccount(event){event.preventDefault();setLinkBusy(true);setAccountError('');setAccountMessage('');try{const result=await request(`/records/students/${record.id}/student-account`,{method:'POST',body:JSON.stringify({email:accountEmail})});setAccountMessage(result.temporaryPassword?`Student login created. Temporary password: ${result.temporaryPassword}. Give it directly to the student or guardian; it must be changed at first sign-in.`:`This student account is linked to ${result.email}.`);}catch(e){setAccountError(e.message);}finally{setLinkBusy(false);}}
 const canLink=['SYSTEM_ADMIN','HEADTEACHER'].includes(user.role);
 const content=<div className="student-profile-content"><div className="student-profile-heading"><div className="student-photo-frame">{photo?<img src={photo} alt={`${data['Full name']||'Student'} identity`}/>:<Users size={34}/>}</div><div><div className="eyebrow">STUDENT PROFILE</div><h2>{data['Full name']||record.title}</h2><p>{admission} · {data.Class||''} · {data.Section||''}</p><span className="status-pill">{data.Status||'ACTIVE'}</span></div><div className="student-profile-actions">{onReportCard&&<button className="secondary-btn" onClick={onReportCard}><FileText size={15}/> Design report card</button>}{onIdCard&&<button className="secondary-btn" onClick={onIdCard}><FileText size={15}/> Print ID card</button>}{user.role!=='BURSAR'&&<label className="secondary-btn"><Upload size={15}/>{photoBusy?'Uploading...':'Add photo'}<input className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadPhoto}/></label>}{onEdit&&<button className="secondary-btn" onClick={onEdit}><Pencil size={15}/> Edit student</button>}</div></div>
   {accountError&&<div className="alert">{accountError}</div>}{accountMessage&&<div className="success-banner">{accountMessage}</div>}
   {hub&&<section className="hub-finance-summary"><div className="hub-balance-grid"><article><small>School fees balance</small><b>KES {Math.max(0,Number(hub.balance||0)-Number(hub.transportBalance||0)).toFixed(2)}</b><span>Paid KES {Math.max(0,Number(hub.paid||0)-Number(hub.transportPaid||0)).toFixed(2)}</span></article><article><small>Transport balance</small><b>KES {Number(hub.transportBalance||0).toFixed(2)}</b><span>{hub.transportAssignments?.map(row=>row.vehicle?.name||row.vehicle?.registrationNo).join(', ')||'No vehicle assigned'}</span></article><article><small>Total balance</small><b>KES {Number(hub.balance||0).toFixed(2)}</b><span>Current recorded fees</span></article></div><div className="hub-item-balance-row">{(hub.itemBalances||[]).map(item=><article key={item.item}><b>{item.item.replaceAll('_',' ')}</b>{item.units.map(unit=><small key={unit.unit}>{Number(unit.balance).toFixed(3)} {unit.unit} balance</small>)}{!item.units.length&&<small>No quantity recorded</small>}</article>)}</div><div className="hub-siblings"><b>Siblings linked by shared guardian contact</b>{hub.siblings?.length?hub.siblings.map(sibling=><button key={sibling.id} className="secondary-btn" onClick={()=>onOpenSibling?.(sibling)}>{sibling.data?.['Full name']||sibling.title} · {sibling.data?.['Admission number']}</button>):<small>No linked siblings found.</small>}</div><div className="hub-quick-actions"><button className="secondary-btn" onClick={printFinancialStatement}><Printer size={15}/> Print account statement</button>{onOpenFinance&&<button className="primary-btn" onClick={onOpenFinance}><Wallet size={15}/> Open payment records</button>}</div></section>}
  {canLink&&<form className="link-student-login" onSubmit={linkAccount}><label>Student portal email<input type="email" required value={accountEmail} onChange={event=>setAccountEmail(event.target.value)} placeholder="student@example.com"/></label><button className="secondary-btn" disabled={linkBusy}>{linkBusy?'Linking...':'Create private student login'}</button></form>}
  <div className="student-results-heading"><div><h3>Results and progress</h3><p>Only results linked to this admission number are shown.</p></div><div className="student-results-actions"><select aria-label="Filter results by term" value={selectedTerm} onChange={event=>setSelectedTerm(event.target.value)}><option>ALL TERMS</option>{terms.map(term=><option key={term}>{term}</option>)}</select><button className="secondary-btn" onClick={downloadResults}><Download size={15}/> Download results</button><button className="secondary-btn" onClick={printResults}><Printer size={15}/> Print / Save PDF</button></div></div>
  {loading?<div className="empty">Loading results...</div>:chartValues.length?<div className="student-chart" dangerouslySetInnerHTML={{__html:chart}}/>:<div className="empty compact-empty">No results have been recorded for this student yet.</div>}
  {rankData&&<div className="rank-summary">Class position: <b>{rankData.rank} of {rankData.total}</b> <span>(ranked by {rankData.method.toLowerCase()})</span></div>}
  {visibleResults.length>0&&<div className="student-results-table"><div className="student-result-row header"><span>Term</span><span>Assessment</span><span>Subject</span><span>Score</span><span>Grade</span></div>{visibleResults.map(result=><div className="student-result-row" key={result.id}><span>{result.data?.Term||'—'}</span><span>{result.data?.Assessment||result.title}</span><span>{result.data?.Subject||'—'}</span><span>{result.data?.Score??'—'} / {result.data?.['Maximum score']??'—'}</span><span>{result.data?.Grade||'—'}</span></div>)}</div>}
 </div>;
 return fullPage?<section className="student-profile-page">{content}</section>:<div className="student-profile-overlay"><div className="student-profile-modal"><button className="icon-btn modal-close" onClick={onClose} aria-label="Close student profile"><X/></button>{content}</div></div>;
}
