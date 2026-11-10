/**
 * Fills a "Demo Model School" tenant with sample data in every module, for demos.
 * Resumable: each step skips what already exists, so a failed run can simply be run again.
 * Needs a replica-set DATABASE_URL because the services use transactions.
 *
 * Usage: npm run seed:demo
 */
import { Types } from 'mongoose';
import { connectDb, disconnectDb } from '../app/config/db';
import { hashPassword } from '../app/lib/password';
import { addDays, dayOfWeek, todayLocal } from '../app/lib/localDate';
import { runAsTenant } from '../app/lib/tenantContext';
import { registerInstitution } from '../app/modules/auth/auth.register.service';
import { Tenant } from '../app/modules/tenant/tenant.model';
import { User } from '../app/modules/user/user.model';
import { ClassModel } from '../app/modules/class/class.model';
import { Section } from '../app/modules/section/section.model';
import { Subject } from '../app/modules/subject/subject.model';
import { ClassSubject } from '../app/modules/classSubject/classSubject.model';
import { FeeHead } from '../app/modules/feeHead/feeHead.model';
import { FeeStructure } from '../app/modules/feeStructure/feeStructure.model';
import { AcademicSession } from '../app/modules/academicSession/academicSession.model';
import { Enrolment } from '../app/modules/enrolment/enrolment.model';
import { Invoice } from '../app/modules/invoice/invoice.model';
import { Exam } from '../app/modules/exam/exam.model';
import { Notice } from '../app/modules/notice/notice.model';
import { Inquiry } from '../app/modules/inquiry/inquiry.model';
import { PublicSite } from '../app/modules/publicSite/publicSite.model';
import { createStudent } from '../app/modules/student/student.service';
import { generateInvoices } from '../app/modules/invoice/invoice.generate';
import { createPayment } from '../app/modules/payment/payment.service';
import { submitSheet } from '../app/modules/attendance/attendance.service';
import { createExam, setExamStatus } from '../app/modules/exam/exam.service';
import { saveMarks, submitMarks } from '../app/modules/marks/marks.service';
import { publishExam } from '../app/modules/result/result.publish';
import { createNotice } from '../app/modules/notice/notice.service';

const DEMO_SLUG = 'demo-school';
const ADMIN_EMAIL = 'admin@demo.school';
const ADMIN_PASSWORD = 'Demo@1234';
const STAFF_PASSWORD = 'Demo@123';
const STUDENTS_PER_SECTION = 6;
const EXAM_NAME = 'Half Yearly Examination';

const STUDENT_NAMES = [
  'Ahnaf Hossain', 'Tanjila Khatun', 'Rafiul Islam', 'Nusrat Jahan', 'Mehedi Hasan', 'Sadia Sultana',
  'Imtiaz Ahmed', 'Fariha Akter', 'Zahid Hassan', 'Mitu Begum', 'Ariful Islam', 'Roksana Parvin',
  'Nazmul Huda', 'Sabina Yasmin', 'Tarek Aziz', 'Poly Khatun', 'Shamim Reza', 'Nasrin Begum',
];
const GUARDIAN_NAMES = [
  'Karim Hossain', 'Jalal Khatun', 'Jalal Uddin', 'Harun Jahan', 'Harun Rashid', 'Monir Sultana',
  'Monir Hossain', 'Abdur Akter', 'Abdur Rahman', 'Alamgir Begum', 'Alamgir Khan', 'Delwar Parvin',
  'Delwar Hossain', 'Rafiq Yasmin', 'Rafiq Islam', 'Jahangir Khatun', 'Jahangir Alam', 'Azizul Begum',
];

const TEACHERS = [
  { role: 'teacher', name: 'Kamal Uddin', email: 'kamal@demo.school', phone: '01711000001' },
  { role: 'teacher', name: 'Rekha Rani Das', email: 'rekha@demo.school', phone: '01711000002' },
  { role: 'teacher', name: 'Mizanur Rahman', email: 'mizan@demo.school', phone: '01711000004' },
  { role: 'accountant', name: 'Salim Reza', email: 'salim@demo.school', phone: '01711000003' },
] as const;

const SUBJECTS = [
  { name: 'Bangla', nameBn: 'বাংলা', components: [{ key: 'written', label: 'Written', fullMarks: 70, passMarks: 23 }, { key: 'mcq', label: 'MCQ', fullMarks: 30, passMarks: 10 }] },
  { name: 'English', nameBn: 'ইংরেজি', components: [{ key: 'written', label: 'Written', fullMarks: 100, passMarks: 33 }] },
  { name: 'Mathematics', nameBn: 'গণিত', components: [{ key: 'written', label: 'Written', fullMarks: 70, passMarks: 23 }, { key: 'mcq', label: 'MCQ', fullMarks: 30, passMarks: 10 }] },
  { name: 'Science', nameBn: 'বিজ্ঞান', components: [{ key: 'written', label: 'Written', fullMarks: 70, passMarks: 23 }, { key: 'mcq', label: 'MCQ', fullMarks: 30, passMarks: 10 }] },
  { name: 'Religion', nameBn: 'ধর্ম ও নৈতিক শিক্ষা', components: [{ key: 'written', label: 'Written', fullMarks: 100, passMarks: 33 }] },
];

const CLASSES = [
  { name: 'Class Six', nameBn: 'ষষ্ঠ শ্রেণি', order: 6, tuition: 150000 },
  { name: 'Class Seven', nameBn: 'সপ্তম শ্রেণি', order: 7, tuition: 160000 },
  { name: 'Class Eight', nameBn: 'অষ্টম শ্রেণি', order: 8, tuition: 175000 },
];

const log = (msg: string) => console.log(`[seed:demo] ${msg}`);

/** Past working days (Bangladesh weekend Fri/Sat skipped), newest first. */
const recentWorkdays = (count: number) => {
  const days: string[] = [];
  let d = addDays(todayLocal(), -1);
  while (days.length < count) {
    if (![5, 6].includes(dayOfWeek(d))) days.push(d);
    d = addDays(d, -1);
  }
  return days;
};

/** Deterministic pseudo-random so reruns give stable numbers. */
const pseudo = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

const ensureTenant = async (): Promise<Types.ObjectId> => {
  const existing = await Tenant.findOne({ slug: DEMO_SLUG }).select('_id').lean();
  if (existing) {
    log('Demo tenant exists, resuming');
    return existing._id as Types.ObjectId;
  }
  const { tenant } = await registerInstitution({
    institutionName: 'Demo Model School',
    institutionNameBn: 'ডেমো মডেল স্কুল',
    institutionType: 'school',
    slug: DEMO_SLUG,
    phone: '01700000001',
    district: 'Dhaka',
    adminName: 'Demo Admin',
    adminEmail: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  log('Demo tenant registered');
  return tenant.id as Types.ObjectId;
};

const seedTenantData = async (admin: { userId: Types.ObjectId; role: string }) => {
  const session = await AcademicSession.findOne({ isCurrent: true }).lean();
  if (!session) throw new Error('No current academic session');
  const sessionId = String(session._id);

  // Classes and sections
  for (const c of CLASSES) {
    let cls = await ClassModel.findOne({ name: c.name });
    if (!cls) cls = await ClassModel.create({ name: c.name, nameBn: c.nameBn, order: c.order });
    for (const [i, name] of ['A', 'B'].entries()) {
      if (!(await Section.exists({ classId: cls._id, name })))
        await Section.create({ classId: cls._id, name, isDefault: i === 0 });
    }
  }
  const classes = await ClassModel.find({ name: { $in: CLASSES.map((c) => c.name) } }).sort({ order: 1 }).lean();
  const sectionsA = await Section.find({ classId: { $in: classes.map((c) => c._id) }, name: 'A' }).lean();
  log(`Classes: ${classes.length}, sections ready`);

  // Staff
  const pwHash = await hashPassword(STAFF_PASSWORD);
  for (const t of TEACHERS) {
    if (!(await User.exists({ email: t.email }))) await User.create({ ...t, passwordHash: pwHash });
  }
  const teachers = await User.find({ role: 'teacher', email: { $in: TEACHERS.map((t) => t.email) } }).lean();
  log(`Staff ready: ${teachers.length} teachers + 1 accountant`);

  // Subjects and class-subject mappings
  for (const s of SUBJECTS) {
    if (!(await Subject.exists({ name: s.name }))) await Subject.create(s);
  }
  const subjects = await Subject.find({ name: { $in: SUBJECTS.map((s) => s.name) } }).lean();
  for (const cls of classes) {
    for (const [i, subj] of subjects.entries()) {
      if (await ClassSubject.exists({ sessionId: session._id, classId: cls._id, subjectId: subj._id })) continue;
      const comps = SUBJECTS.find((s) => s.name === subj.name)!.components;
      await ClassSubject.create({
        sessionId: session._id,
        classId: cls._id,
        subjectId: subj._id,
        kind: 'compulsory',
        teacherId: teachers[i % teachers.length]._id,
        fullMarks: comps.reduce((a, c) => a + c.fullMarks, 0),
        passMarks: comps.reduce((a, c) => a + c.passMarks, 0),
        components: comps,
      });
    }
  }
  log(`Subjects: ${subjects.length}, mapped to every class`);

  // Students
  let n = 0;
  for (const sec of sectionsA) {
    const have = await Enrolment.countDocuments({ sessionId: session._id, sectionId: sec._id });
    for (let i = have; i < STUDENTS_PER_SECTION; i++) {
      const idx = sectionsA.indexOf(sec) * STUDENTS_PER_SECTION + i;
      await createStudent({
        name: STUDENT_NAMES[idx],
        gender: idx % 2 === 0 ? 'male' : 'female',
        dob: `201${2 - classes.findIndex((c) => String(c._id) === String(sec.classId))}-0${(idx % 9) + 1}-15`,
        enrolment: { sessionId, classId: String(sec.classId), sectionId: String(sec._id) },
        guardians: [{ name: GUARDIAN_NAMES[idx], relation: 'father', phone: `0181${String(1000000 + idx).slice(1)}` }],
      } as any);
      n++;
    }
  }
  const enrolments = await Enrolment.find({ sessionId: session._id, sectionId: { $in: sectionsA.map((s) => s._id) } })
    .sort({ roll: 1 })
    .lean();
  log(`Students: ${n} new, ${enrolments.length} total`);

  // Fee structures and invoices
  const tuition = await FeeHead.findOne({ code: 'TUITION' }).lean();
  const examFee = await FeeHead.findOne({ code: 'EXAM' }).lean();
  if (!tuition || !examFee) throw new Error('Preset fee heads missing');
  for (const cls of classes) {
    if (await FeeStructure.exists({ sessionId: session._id, classId: cls._id })) continue;
    const fee = CLASSES.find((c) => c.name === cls.name)!.tuition;
    await FeeStructure.create({
      sessionId: session._id,
      classId: cls._id,
      group: null,
      items: [
        { feeHeadId: tuition._id, amount: fee, cycle: 'monthly', dueDay: 10 },
        { feeHeadId: examFee._id, amount: 50000, cycle: 'term', dueDay: 15 },
      ],
    });
  }
  const month = todayLocal().slice(0, 7);
  for (const cls of classes) {
    await generateInvoices(
      { sessionId, classId: String(cls._id), periodLabel: `Tuition ${month}`, cycle: 'monthly', dueDate: addDays(todayLocal(), 10) },
      `demo-invoice-${month}-${cls._id}`,
    );
  }
  log(`Invoices generated for ${month}`);

  // Payments: every 4th student stays due, every 7th pays half
  let paid = 0;
  for (const [i, e] of enrolments.entries()) {
    if (i % 4 === 3) continue;
    const open = await Invoice.find({ studentId: e.studentId, status: { $in: ['unpaid', 'partial'] } }).lean();
    const due = open.reduce((s: number, inv: any) => s + inv.dueAmount, 0);
    if (!due) continue;
    const amount = i % 7 === 6 ? Math.round(due / 200) * 100 : due;
    await createPayment(
      admin,
      { studentId: String(e.studentId), amount, method: i % 3 === 0 ? 'bkash' : 'cash' },
      `demo-payment-${month}-${e.studentId}`,
    );
    paid++;
  }
  log(`Payments recorded: ${paid}`);

  // Attendance for the last 10 working days, with a few absents and lates
  let sheets = 0;
  for (const sec of sectionsA) {
    const roster = enrolments.filter((e) => String(e.sectionId) === String(sec._id));
    for (const [d, date] of recentWorkdays(10).entries()) {
      const records = roster
        .map((e, j) => {
          const r = pseudo(d * 31 + j * 7 + sectionsA.indexOf(sec));
          const status = r < 0.1 ? 'absent' : r < 0.17 ? 'late' : null;
          return status ? { studentId: String(e.studentId), status: status as 'absent' | 'late' } : null;
        })
        .filter((x): x is { studentId: string; status: 'absent' | 'late' } => !!x);
      const res = await submitSheet(admin, { sectionId: String(sec._id), date, records, allowWeekend: false });
      if (!res.existing) sheets++;
    }
  }
  log(`Attendance sheets: ${sheets} new`);

  // Exam, marks and published result
  let exam = await Exam.findOne({ name: EXAM_NAME, sessionId: session._id });
  if (!exam) {
    exam = await createExam({ name: EXAM_NAME, sessionId, classIds: classes.map((c) => String(c._id)), kind: 'term' });
  }
  const examId = String(exam!._id);
  if (exam!.status === 'draft') await setExamStatus(examId, 'marks_open');
  if ((await Exam.findById(examId).lean())!.status === 'marks_open') {
    for (const sec of sectionsA) {
      const roster = enrolments.filter((e) => String(e.sectionId) === String(sec._id));
      for (const [si, subj] of subjects.entries()) {
        const cs: any = await ClassSubject.findOne({ sessionId: session._id, classId: sec.classId, subjectId: subj._id }).lean();
        const comps: { key: string; fullMarks: number }[] = cs?.components?.length
          ? cs.components
          : [{ key: 'total', fullMarks: cs?.fullMarks ?? 100 }];
        const scope = { classId: String(sec.classId), sectionId: String(sec._id), subjectId: String(subj._id) };
        await saveMarks(admin, examId, {
          ...scope,
          marks: roster.map((e, j) => ({
            studentId: String(e.studentId),
            components: comps.map((c, ci) => {
              const absent = j === 5 && si === 4;
              const ratio = 0.35 + pseudo(j * 13 + si * 5 + ci) * 0.6;
              return { key: c.key, obtained: absent ? null : Math.min(c.fullMarks, Math.round(c.fullMarks * ratio)), absent };
            }),
          })),
        });
        await submitMarks(admin, examId, scope);
      }
    }
    await setExamStatus(examId, 'marks_closed');
  }
  await publishExam(admin, examId, { forceMissingAsAbsent: true });
  log('Exam published with results');

  // Notices
  const notices = [
    { title: 'Half Yearly result published', body: '<p>Half Yearly Examination results are out. Check them from the portal.</p>', audience: { type: 'all' }, isPublic: true },
    { title: 'Annual Sports Day', body: '<p>Annual Sports Day will be held next month. All students are requested to take part.</p>', audience: { type: 'all' }, isPublic: true },
    { title: 'Monthly fee reminder', body: '<p>Please pay the monthly tuition fee by the 10th to avoid a late fee.</p>', audience: { type: 'students_guardians' } },
    { title: 'Staff meeting on Sunday', body: '<p>All teachers are requested to attend the staff meeting at 2 PM.</p>', audience: { type: 'staff' } },
  ];
  for (const nt of notices) {
    if (!(await Notice.exists({ title: nt.title })))
      await createNotice(admin, { ...nt, status: 'published', publishAt: new Date() });
  }
  log('Notices ready');

  // Inquiries
  const inquiries = [
    { name: 'Salma Khatun', phone: '01800000001', message: 'I want to admit my daughter to Class Six. What is the process?', status: 'new' },
    { name: 'Rahim Uddin', phone: '01800000002', message: 'What is the monthly fee for Class Eight?', status: 'contacted' },
    { name: 'Kamrun Nahar', phone: '01800000003', message: 'Is there any scholarship for good results?', status: 'new' },
  ];
  for (const q of inquiries) {
    if (!(await Inquiry.exists({ phone: q.phone }))) await Inquiry.create(q);
  }
  log('Inquiries ready');

  // Public site
  if (!(await PublicSite.exists({}))) {
    await PublicSite.create({
      isPublished: true,
      hero: { title: 'ডেমো মডেল স্কুলে স্বাগতম', subtitle: 'শিক্ষায় আলোকিত ভবিষ্যৎ' },
      about: 'ডেমো মডেল স্কুল একটি আধুনিক শিক্ষাপ্রতিষ্ঠান। অভিজ্ঞ শিক্ষক আর উন্নত পরিবেশে আমরা শিক্ষার্থীদের সামগ্রিক বিকাশে কাজ করি।',
      contact: { phone: '01700000001', email: ADMIN_EMAIL, address: 'Mirpur, Dhaka-1216' },
    });
  }
  log('Public site ready');
};

const run = async () => {
  await connectDb();
  const tenantId = await ensureTenant();
  const adminUser = await runAsTenant(tenantId, () => User.findOne({ role: 'admin' }).select('_id').lean());
  if (!adminUser) throw new Error('Demo admin user not found');
  const admin = { userId: adminUser._id as Types.ObjectId, role: 'admin' };
  await runAsTenant(tenantId, () => seedTenantData(admin), { userId: admin.userId, role: 'admin' });

  log('Done.');
  log(`  Admin:      ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}  (school slug: ${DEMO_SLUG})`);
  for (const t of TEACHERS) log(`  ${t.role.padEnd(10)}  ${t.email} / ${STAFF_PASSWORD}`);
  await disconnectDb();
};

run().catch(async (err) => {
  console.error('[seed:demo] FAILED:', err?.message ?? err, err?.details ?? '');
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
