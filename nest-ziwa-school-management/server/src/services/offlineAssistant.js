import { IN_KIND_ITEMS } from './paymentService.js';

const FINANCE_ROLES = new Set(['SYSTEM_ADMIN','HEADTEACHER','BURSAR','DIRECTOR']);
const EXAM_ROLES = new Set(['SYSTEM_ADMIN','HEADTEACHER','EXAM_OFFICER','TEACHER','DIRECTOR']);
const admissionOf = row => String(row?.data?.['Admission number'] || '').trim().toUpperCase();
const guardianAdmissions = row => String(row?.data?.['Student admission number'] || row?.data?.['Admission number'] || '').split(/[,;\s]+/).map(value => value.trim().toUpperCase()).filter(Boolean);
async function linkedAdmissions(prisma, user) {
  if (user.role === 'STUDENT') {
    const link = await prisma.studentAccount.findUnique({ where: { userId: user.id }, include: { record: { select: { data: true } } } });
    return new Set(link ? [admissionOf(link.record)] : []);
  }
  if (user.role !== 'PARENT') return null;
  const email = String(user.email || '').trim().toLowerCase();
  if (!email) return new Set();
  const guardians = await prisma.moduleRecord.findMany({ where: { module: 'guardians' }, select: { data: true } });
  const own = guardians.filter(row => String(row.data?.Email || '').trim().toLowerCase() === email);
  return new Set(own.flatMap(guardianAdmissions));
}

function findMentionedStudent(students, message) {
  const normalized = message.toLowerCase();
  return students.find(row => {
    const admission = admissionOf(row).toLowerCase();
    const name = String(row.data?.['Full name'] || row.title || '').trim().toLowerCase();
    return (admission.length > 2 && normalized.includes(admission)) || (name.length > 3 && normalized.includes(name));
  }) || null;
}

function balancesFor(students, rows, assignments) {
  const balances = new Map(students.map(student => [admissionOf(student), { student, fees: 0, paid: 0, transportFees: 0, transportPaid: 0 }]));
  for (const row of rows) {
    const data = row.data || {};
    const admission = String(data['Student admission number'] || data['Admission number'] || '').trim().toUpperCase();
    const value = balances.get(admission);
    const amount = Number(data['Amount (KES)'] ?? data.Amount ?? 0);
    if (!value || !Number.isFinite(amount)) continue;
    const isTransport = `${row.title || ''} ${data.Category || ''} ${data['Fee type'] || ''}`.toUpperCase().includes('TRANSPORT');
    const status = String(data.Status || '').toUpperCase();
    if (row.module === 'fees' && !['CANCELLED','WAIVED','REJECTED'].includes(status)) {
      value.fees += amount;
      if (isTransport) value.transportFees += amount;
    } else if (row.module === 'payments' && (!data['Verification status'] || data['Verification status'] === 'VERIFIED_BALANCED') && !['CANCELLED','VOID','REVERSED','REJECTED'].includes(status)) {
      value.paid += amount;
      if (isTransport) value.transportPaid += amount;
    }
  }
  for (const assignment of assignments) {
    const value = balances.get(admissionOf(assignment.studentRecord));
    if (value) value.assignedTransportFees = (value.assignedTransportFees || 0) + Number(assignment.feeAmount);
  }
  return [...balances.values()].map(value => {
    if (value.transportFees === 0) { value.transportFees = value.assignedTransportFees || 0; value.fees += value.transportFees; }
    return { ...value, transportBalance: value.transportFees - value.transportPaid, balance: value.fees - value.paid };
  });
}

function itemBalanceSummary(admission, pledges, movements) {
  return IN_KIND_ITEMS.map(item => {
    const expected = pledges.filter(row => row.admissionNumber === admission && row.item === item);
    const received = movements.filter(row => row.admissionNumber === admission && row.item === item);
    const units = [...new Set([...expected.map(row => row.unit), ...received.map(row => row.unit)])];
    return `${item.replaceAll('_',' ')}: ${units.length ? units.map(unit => {
      const planned = expected.filter(row => row.unit === unit).reduce((sum,row) => sum + Number(row.quantity),0);
      const actual = received.filter(row => row.unit === unit).reduce((sum,row) => sum + Number(row.quantity),0);
      return `${Math.max(0,planned-actual).toFixed(3)} ${unit} outstanding (${actual.toFixed(3)} received)`;
    }).join(', ') : 'no pledge recorded'}`;
  }).join('; ');
}

export async function answerPermittedDataQuestion(prisma, user, message) {
  const text = message.toLowerCase();
  const isFinance = FINANCE_ROLES.has(user.role);
  const isStudentFamily = ['PARENT','STUDENT'].includes(user.role);

  if (/unverified|unbalanced|bank payment|bank statement|reconcil|collision|pending payment/.test(text)) {
    if (!isFinance) return 'Bank reconciliation and unverified payment details are limited to Finance and school administrators.';
    const schools = user.role === 'DIRECTOR' ? await prisma.schoolLink.findMany({ where: { directorId: user.id }, select: { schoolId: true } }) : await prisma.school.findMany({ where: { code: 'NEST-ZIWA' }, select: { id: true } });
    const ids = schools.map(row => row.schoolId || row.id);
    if (!ids.length) return 'No linked school ledger is available for this account.';
    const [bank, staged] = await Promise.all([
      prisma.bankTransaction.findMany({ where: { schoolId: { in: ids }, status: { not: 'POSTED' } }, orderBy: { createdAt: 'desc' }, take: 25 }),
      prisma.paymentTransaction.findMany({ where: { schoolId: { in: ids }, status: { in: ['PENDING_VERIFICATION','CONCERN','UNBALANCED'] } }, orderBy: { createdAt: 'desc' }, take: 25 })
    ]);
    const summary = [...bank.map(row => `Bank ${row.reference}: KES ${Number(row.amount).toFixed(2)} (${row.status}${row.conflictReason ? ` — ${row.conflictReason}` : ''})`), ...staged.map(row => `${row.admissionNumber} ${row.channel}: ${row.transactionCode || 'missing reference'}, KES ${Number(row.amount).toFixed(2)} (${row.status})`)];
    return summary.length ? `Open reconciliation items (${summary.length} shown): ${summary.slice(0,12).join('; ')}.` : 'There are no unposted bank rows or staged student payments in the linked school ledger.';
  }

  if (/fail|failing|below|struggl|need attention|academic concern/.test(text)) {
    if (!EXAM_ROLES.has(user.role) && !isStudentFamily) return 'Exam results and academic attention summaries are available to authorized teaching staff and linked parent/student accounts.';
    let students = await prisma.moduleRecord.findMany({ where: { module: 'students' }, select: { id: true, title: true, data: true }, take: 3000 });
    const linked = await linkedAdmissions(prisma, user);
    if (linked) students = students.filter(row => linked.has(admissionOf(row)));
    let results = await prisma.moduleRecord.findMany({ where: { module: 'examinations' }, select: { title: true, data: true }, orderBy: { updatedAt: 'desc' }, take: 1500 });
    if (user.role === 'TEACHER') results = results.filter(row => String(row.data?.['Assigned teacher'] || '').trim().toLowerCase() === String(user.name || '').trim().toLowerCase());
    const index = new Map(students.map(row => [admissionOf(row), row]));
    const concerns = results.map(row => {
      const data = row.data || {};
      const admission = String(data['Student admission number'] || data['Admission number'] || '').trim().toUpperCase();
      const score = Number(data.Score), maximum = Number(data['Maximum score'] || 100);
      const percent = maximum > 0 && Number.isFinite(score) ? score / maximum * 100 : null;
      const grade = String(data.Grade || '').toUpperCase();
      return { student: index.get(admission), subject: data.Subject || row.title, score, maximum, percent, term: data.Term || '', grade };
    }).filter(row => row.student && ((row.percent !== null && row.percent < 50) || ['F','E','BELOW EXPECTATION','BELOW STANDARD'].includes(row.grade)));
    const unique = concerns.slice(0,10).map(row => `${row.student.data?.['Full name'] || row.student.title} (${admissionOf(row.student)}): ${row.subject} ${Number.isFinite(row.percent) ? `${row.percent.toFixed(1)}%` : row.grade}${row.term ? `, ${row.term}` : ''}`);
    return unique.length ? `These recorded results may need teacher review: ${unique.join('; ')}. Use the latest assessment and discuss support with the teacher; this is not a diagnosis.` : 'No recent below-50% or failing-grade examination entries were found within your permitted records.';
  }

  if (/balance|fees|maize|beans|millet|ream paper|foodstuff|foodstuff/.test(text)) {
    if (!isFinance && !isStudentFamily) return 'Student fee and in-kind balances are restricted to Finance and the linked parent or student account.';
    let students = await prisma.moduleRecord.findMany({ where: { module: 'students' }, select: { id: true, title: true, data: true }, take: 3000 });
    const linked = await linkedAdmissions(prisma, user);
    if (linked) students = students.filter(row => linked.has(admissionOf(row)));
    const matched = findMentionedStudent(students, text);
    if (isStudentFamily && /\b(students|everyone|all|class)\b/.test(text)) return 'Family and student accounts can only request records for their own linked child. Ask the school office to review class-wide balances.';
    const selected = matched ? [matched] : students;
    if (isStudentFamily && !matched && selected.length > 1) return `I found ${selected.length} linked child records. Include a child's name or admission number to get a specific balance.`;
    const admissions = selected.map(admissionOf).filter(Boolean);
    if (!admissions.length) return 'I could not find a student you are permitted to view matching that name or admission number.';
    const records = await prisma.moduleRecord.findMany({ where: { module: { in: ['fees','payments'] } }, select: { module: true, title: true, data: true }, take: 5000 });
    let assignments = [];
    const school = await prisma.school.findUnique({ where: { code: 'NEST-ZIWA' }, select: { id: true } });
    if (school) assignments = await prisma.transportAssignment.findMany({ where: { schoolId: school.id, status: 'ACTIVE', studentRecordId: { in: selected.map(row => row.id) } }, select: { feeAmount: true, studentRecord: { select: { data: true } } } });
    const balances = balancesFor(selected, records, assignments);
    const pledges = await prisma.inKindPledge.findMany({ where: { admissionNumber: { in: admissions }, status: { not: 'CANCELLED' } }, select: { admissionNumber: true, item: true, quantity: true, unit: true } });
    const movements = await prisma.inKindMovement.findMany({ where: { admissionNumber: { in: admissions } }, select: { admissionNumber: true, item: true, quantity: true, unit: true } });
    return balances.map(value => `${value.student.data?.['Full name'] || value.student.title} (${admissionOf(value.student)}): fee balance KES ${value.balance.toFixed(2)}; transport KES ${value.transportBalance.toFixed(2)}; ${itemBalanceSummary(admissionOf(value.student),pledges,movements)}.`).join('\n');
  }

  if (/transport|vehicle|bus|van|car|route/.test(text)) {
    if (!['SYSTEM_ADMIN','HEADTEACHER','BURSAR','DIRECTOR','TRANSPORT_MANAGER','DRIVER','PARENT','STUDENT'].includes(user.role)) return 'Transport assignments and vehicle details are limited to transport staff, school leaders, and linked parent/student accounts.';
    const students = await prisma.moduleRecord.findMany({ where: { module: 'students' }, select: { id: true, title: true, data: true }, take: 3000 });
    const linked = await linkedAdmissions(prisma,user);
    const permitted = linked ? students.filter(row => linked.has(admissionOf(row))) : students;
    const matched = findMentionedStudent(permitted,text);
    const targets = matched ? [matched] : permitted;
    const school = await prisma.school.findUnique({ where: { code: 'NEST-ZIWA' }, select: { id: true } });
    if (!school) return 'No transport assignment data is available yet.';
    const assignments = await prisma.transportAssignment.findMany({ where: { schoolId: school.id, status: 'ACTIVE', ...(matched ? { studentRecordId: matched.id } : linked ? { studentRecordId: { in: targets.map(row => row.id) } } : {}) }, include: { studentRecord: { select: { data: true, title: true } }, vehicle: { include: { route: true } }, route: true }, take: 100 });
    if (!assignments.length) return 'No active transport assignments were found within your permitted records.';
    return assignments.slice(0,15).map(row => `${row.studentRecord.data?.['Full name'] || row.studentRecord.title}: ${row.vehicle.name || row.vehicle.registrationNo} (${row.vehicle.vehicleClass}), ${row.route?.name || row.vehicle.route?.name || 'no route'}, KES ${Number(row.feeAmount).toFixed(2)} per ${row.billingCycle.toLowerCase()}`).join('\n');
  }
  return null;
}

export function offlineGuidance(message, role) {
  const text = message.toLowerCase();
  const routes = [
    [/admission|enrol|student record/, 'Admissions / Students: open Students, choose Add record or the Excel template, and use the suggested admission number. Student photos and login links are managed from the student profile.'],
    [/fee|payment|cashbook|bank|reconcil/, 'Finance: use Payments to stage a receipt, confirm it against a statement, and review follow-up alerts. Accounting contains journals, cashbooks, bank reconciliation, budgets, and financial summaries.'],
    [/maize|beans|millet|ream paper|foodstuff|in.kind/, 'In-kind items: use Finance → In-kind balances to record expected quantities and verified deliveries. Unit standards are kg/sack for grains and ream/box for paper; these balances stay out of Learning.'],
    [/exam|result|rank|marklist|failing/, 'Examinations: choose the class, assessment, teacher, term, score, maximum score, and ranking method. Class mark lists and student report cards are available from the Examinations and Report Card modules.'],
    [/transport|vehicle|bus|van|car|route/, 'Transport: create a route and named vehicle, set vehicle class/capacity, and assign the student fare and billing cycle. Active fares appear in the student financial summary.'],
    [/salary|payroll|installment/, 'Salary runs: the Director can create a batch or individual installment in Salary disbursements. It remains pending until confirmation; sandbox confirmations do not move money.'],
    [/id card|identity card|photo/, 'Student ID cards: upload a photo from the student profile or bulk upload photos named with the admission number, then open Student ID Cards to preview and print.'],
    [/newsletter|notice|letter|document|lesson plan|timetable/, 'Drafts: use Newsletter Studio or the staff assistant document studio. Provide only approved facts, review the draft, then download or print it. Email sending requires configured SMTP.'],
    [/signature|stamp|logo|setting|theme/, 'Branding: System Settings lets authorized administrators upload the school logo, processed signature/stamp artwork, and choose the green and sky blue colors.'],
    [/parent|whatsapp|guardian/, 'Parent communication: save the school WhatsApp number and class invite links in System Settings. Finance can download linked class guardian contacts. Staff must share invitations and attach documents in WhatsApp.'],
    [/audit|director|school/, 'Director tools: Linked Schools shows connected school ledgers. The audit log is Director-only, and salary runs are available from Salary disbursements.']
  ];
  if (/draft|write|template/.test(text)) {
    if (/lesson/.test(text)) return 'LESSON PLAN DRAFT\nClass: [ADD CLASS]\nSubject: [ADD SUBJECT]\nDate: [ADD DATE]\nLearning objectives: [ADD OBJECTIVES]\nMaterials: [ADD MATERIALS]\nLesson steps: [INTRODUCTION] → [ACTIVITY] → [PRACTICE]\nAssessment: [ADD CHECK FOR UNDERSTANDING]\nTeacher notes: [ADD NOTES]';
    if (/timetable/.test(text)) return 'TIMETABLE TEMPLATE\nClass: [ADD CLASS]\nDay | Time | Subject | Teacher | Room\n[ADD DAY] | [START–END] | [SUBJECT] | [TEACHER] | [ROOM]';
    return 'PARENT FEE REMINDER DRAFT\nDear Parent/Guardian,\nThis is a reminder about the school account for [STUDENT NAME], admission number [ADMISSION NUMBER]. The current recorded balance is [AMOUNT]. Please contact the school office if you need a statement or believe a payment is missing.\nRegards,\nNest Ziwa Schools';
  }
  const match = routes.find(([pattern]) => pattern.test(text));
  if (match) return match[1];
  return `I’m running Offline Built-In Mode. I can guide ${role === 'PARENT' || role === 'STUDENT' ? 'you through your linked child/student records' : 'you through admissions, students, fees, in-kind items, payments, reconciliation, exams, transport, salaries, reports, ID cards, and settings'}. Ask a module how-to question or request a permitted fee, in-kind, transport, academic, or bank follow-up summary.`;
}
