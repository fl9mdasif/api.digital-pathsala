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
import { Student } from '../app/modules/student/student.model';
import { Payment } from '../app/modules/payment/payment.model';
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
import { FeeAdjustment } from '../app/modules/feeAdjustment/feeAdjustment.model';
import { seedExtras } from './seedDemoExtras';

const DEMO_SLUG = process.env.DEMO_SLUG ?? 'demo-school';
const ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL ?? 'admin@demo.school';
const ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD ?? 'Demo@1234';
const STAFF_PASSWORD = process.env.DEMO_STAFF_PASSWORD ?? 'Demo@123';
const STUDENTS_PER_SECTION = 6;
const EXAM_NAME = 'Half Yearly Examination';

// Section A of each class uses indexes 0-17 (as in the first seed), section B uses 18-35.
const STUDENT_NAMES = [
  'Ahnaf Hossain', 'Tanjila Khatun', 'Rafiul Islam', 'Nusrat Jahan', 'Mehedi Hasan', 'Sadia Sultana',
  'Imtiaz Ahmed', 'Fariha Akter', 'Zahid Hassan', 'Mitu Begum', 'Ariful Islam', 'Roksana Parvin',
  'Nazmul Huda', 'Sabina Yasmin', 'Tarek Aziz', 'Poly Khatun', 'Shamim Reza', 'Nasrin Begum',
  'Rakib Hasan', 'Sumi Akter', 'Jubayer Ahmed', 'Mahfuza Khanam', 'Shihab Uddin', 'Tahmina Rahman',
  'Asif Mahmud', 'Shapla Khatun', 'Naimur Rahman', 'Lipi Akter', 'Sohel Rana', 'Moushumi Islam',
  'Alamin Hossain', 'Ruma Begum', 'Hasibul Hasan', 'Jesmin Ara', 'Mamun Sarker', 'Bristy Das',
];
const GUARDIAN_NAMES = [
  'Karim Hossain', 'Jalal Khatun', 'Jalal Uddin', 'Harun Jahan', 'Harun Rashid', 'Monir Sultana',
  'Monir Hossain', 'Abdur Akter', 'Abdur Rahman', 'Alamgir Begum', 'Alamgir Khan', 'Delwar Parvin',
  'Delwar Hossain', 'Rafiq Yasmin', 'Rafiq Islam', 'Jahangir Khatun', 'Jahangir Alam', 'Azizul Begum',
  'Nurul Hasan', 'Selim Akter', 'Ahmed Ali', 'Babul Khanam', 'Mokbul Uddin', 'Shafiq Rahman',
  'Mahmud Hasan', 'Idris Khatun', 'Habibur Rahman', 'Kabir Akter', 'Rana Miah', 'Shahjahan Islam',
  'Hossain Ali', 'Abul Begum', 'Hanif Hasan', 'Sirajul Ara', 'Sarker Ali', 'Gopal Das',
];

const TEACHERS = [
  { role: 'teacher', name: 'Kamal Uddin', email: 'kamal@demo.school', phone: '01711000001' },
  { role: 'teacher', name: 'Rekha Rani Das', email: 'rekha@demo.school', phone: '01711000002' },
  { role: 'teacher', name: 'Mizanur Rahman', email: 'mizan@demo.school', phone: '01711000004' },
  { role: 'teacher', name: 'Farhana Yasmin', email: 'farhana@demo.school', phone: '01711000005' },
  { role: 'teacher', name: 'Abdul Karim', email: 'abdul@demo.school', phone: '01711000006' },
  { role: 'accountant', name: 'Salim Reza', email: 'salim@demo.school', phone: '01711000003' },
] as const;
/** Each subject has its own teacher in every class, which keeps the class routine free of clashes. */
const SUBJECT_TEACHER_EMAILS = ['kamal@demo.school', 'rekha@demo.school', 'mizan@demo.school', 'farhana@demo.school', 'abdul@demo.school'];

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
  let tenantId: Types.ObjectId;
  if (existing) {
    log('Demo tenant exists, resuming');
    tenantId = existing._id as Types.ObjectId;
  } else {
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
    tenantId = tenant.id as Types.ObjectId;
  }
  // A permanent public demo must never look "suspended" just because its original trial
  // window ran out; force it active every run, whether freshly created or resumed.
  await Tenant.updateOne({ _id: tenantId }, { $set: { status: 'active' } });
  return tenantId;
};

const seedTenantData = async (admin: { userId: Types.ObjectId; role: string }) => {
  const session = await AcademicSession.findOne({ isCurrent: true }).lean();
  if (!session) throw new Error('No current academic session');
  const sessionId = String(session._id);

  // Classes and sections. Both sections are normal, visible sections: a "default" section is hidden from the
  // section lists the routine, ID card and admit card pages use.
  for (const c of CLASSES) {
    let cls = await ClassModel.findOne({ name: c.name });
    if (!cls) cls = await ClassModel.create({ name: c.name, nameBn: c.nameBn, order: c.order });
    for (const name of ['A', 'B']) {
      if (!(await Section.exists({ classId: cls._id, name }))) await Section.create({ classId: cls._id, name });
    }
  }
  const classes = await ClassModel.find({ name: { $in: CLASSES.map((c) => c.name) } }).sort({ order: 1 }).lean();
  await Section.updateMany({ classId: { $in: classes.map((c) => c._id) }, name: { $in: ['A', 'B'] } }, { $set: { isDefault: false } });
  const sections = (await Section.find({ classId: { $in: classes.map((c) => c._id) }, name: { $in: ['A', 'B'] } }).lean()).sort(
    (a: any, b: any) =>
      classes.findIndex((c) => String(c._id) === String(a.classId)) - classes.findIndex((c) => String(c._id) === String(b.classId)) ||
      a.name.localeCompare(b.name),
  );
  log(`Classes: ${classes.length}, ${sections.length} sections ready`);

  // Staff
  const pwHash = await hashPassword(STAFF_PASSWORD);
  for (const t of TEACHERS) {
    if (!(await User.exists({ email: t.email }))) await User.create({ ...t, passwordHash: pwHash });
  }
  const staff = await User.find({ email: { $in: TEACHERS.map((t) => t.email) } }).lean();
  const teacherByEmail = new Map(staff.map((u: any) => [u.email, u._id]));
  log(`Staff ready: ${TEACHERS.length - 1} teachers + 1 accountant`);

  // Subjects and class-subject mappings (one teacher per subject, the same in every class)
  for (const s of SUBJECTS) {
    if (!(await Subject.exists({ name: s.name }))) await Subject.create(s);
  }
  const subjects = SUBJECTS.map((s) => ({ def: s, doc: null as any }));
  for (const s of subjects) s.doc = await Subject.findOne({ name: s.def.name }).lean();
  for (const cls of classes) {
    for (const [i, { def, doc }] of subjects.entries()) {
      const teacherId = teacherByEmail.get(SUBJECT_TEACHER_EMAILS[i]);
      const existing = await ClassSubject.findOne({ sessionId: session._id, classId: cls._id, subjectId: doc._id });
      if (existing) {
        if (String(existing.teacherId) !== String(teacherId)) await ClassSubject.updateOne({ _id: existing._id }, { $set: { teacherId } });
        continue;
      }
      await ClassSubject.create({
        sessionId: session._id,
        classId: cls._id,
        subjectId: doc._id,
        kind: 'compulsory',
        teacherId,
        fullMarks: def.components.reduce((a, c) => a + c.fullMarks, 0),
        passMarks: def.components.reduce((a, c) => a + c.passMarks, 0),
        components: def.components,
      });
    }
  }
  const subjectDocs = subjects.map((s) => s.doc);
  log(`Subjects: ${subjects.length}, mapped to every class`);

  // Students: 6 per section, section A first so the first seed's names stay where they were
  let n = 0;
  for (const sec of sections) {
    const have = await Enrolment.countDocuments({ sessionId: session._id, sectionId: sec._id });
    const classIdx = classes.findIndex((c) => String(c._id) === String(sec.classId));
    for (let i = have; i < STUDENTS_PER_SECTION; i++) {
      const idx = (sec.name === 'A' ? 0 : 18) + classIdx * STUDENTS_PER_SECTION + i;
      await createStudent({
        name: STUDENT_NAMES[idx],
        gender: idx % 2 === 0 ? 'male' : 'female',
        dob: `201${2 - classIdx}-0${(idx % 9) + 1}-15`,
        enrolment: { sessionId, classId: String(sec.classId), sectionId: String(sec._id) },
        guardians: [{ name: GUARDIAN_NAMES[idx], relation: 'father', phone: `0181${String(1000000 + idx).slice(1)}` }],
      } as any);
      n++;
    }
  }
  const enrolments = await Enrolment.find({ sessionId: session._id, sectionId: { $in: sections.map((s) => s._id) } })
    .sort({ roll: 1 })
    .lean();
  log(`Students: ${n} new, ${enrolments.length} total`);

  // Religion and blood group for the dashboard tables, and one student whose birthday is today
  const BLOODS = ['O+', 'A+', 'B+', 'AB+', 'O-', 'A-', 'B-', 'AB-'];
  const demoStudents = await Student.find({ _id: { $in: enrolments.map((e) => e.studentId) } })
    .select('_id religion bloodGroup')
    .sort({ studentId: 1 })
    .lean();
  for (const [i, st] of demoStudents.entries()) {
    const religion = i % 9 === 4 ? 'Hindu' : i % 17 === 5 ? 'Christian' : i % 23 === 7 ? 'Buddhist' : 'Islam';
    const set: Record<string, string> = {};
    if (!st.religion) set.religion = religion;
    if (!st.bloodGroup) set.bloodGroup = BLOODS[(i * 3) % BLOODS.length];
    if (Object.keys(set).length) await Student.updateOne({ _id: st._id }, { $set: set });
  }
  if (demoStudents[2]) await Student.updateOne({ _id: demoStudents[2]._id }, { $set: { dob: `2012-${todayLocal().slice(5)}` } });

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
  // Last month's tuition, already past its due date, so dues, overdue and the admit card hold have data
  const prevMonth = addDays(todayLocal(), -35).slice(0, 7);
  for (const cls of classes) {
    await generateInvoices(
      { sessionId, classId: String(cls._id), periodLabel: `Tuition ${prevMonth}`, cycle: 'monthly', dueDate: addDays(todayLocal(), -20) },
      `demo-invoice-${prevMonth}-${cls._id}`,
    );
  }
  const month = todayLocal().slice(0, 7);
  for (const cls of classes) {
    await generateInvoices(
      { sessionId, classId: String(cls._id), periodLabel: `Tuition ${month}`, cycle: 'monthly', dueDate: addDays(todayLocal(), 10) },
      `demo-invoice-${month}-${cls._id}`,
    );
  }
  log(`Invoices generated for ${month}`);

  // The 4th student of every section stays due (so every section has an overdue student); every 7th pays half
  const seen = new Map<string, number>();
  const posInSection = new Map<string, number>();
  for (const e of enrolments) {
    const k = String(e.sectionId);
    posInSection.set(String(e._id), seen.get(k) ?? 0);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  let paid = 0;
  for (const [i, e] of enrolments.entries()) {
    if (posInSection.get(String(e._id)) === 3) continue;
    const open = await Invoice.find({ studentId: e.studentId, status: { $in: ['unpaid', 'partial'] } }).lean();
    const due = open.reduce((s: number, inv: any) => s + inv.dueAmount, 0);
    if (!due) continue;
    const amount = i % 7 === 6 ? Math.round(due / 200) * 100 : due;
    await createPayment(
      admin,
      { studentId: String(e.studentId), amount, method: i % 3 === 0 ? 'bkash_manual' : 'cash' },
      `demo-payment-${month}-${e.studentId}`,
    );
    paid++;
  }
  log(`Payments recorded: ${paid}`);

  // Pay last month for the same students (a no-op on a fresh run, where the loop above already paid both months)
  let paidPrev = 0;
  for (const [i, e] of enrolments.entries()) {
    if (posInSection.get(String(e._id)) === 3) continue;
    const overdue = await Invoice.find({ studentId: e.studentId, status: { $in: ['unpaid', 'partial'] }, dueDate: { $lt: todayLocal() } }).lean();
    const due = overdue.reduce((s: number, inv: any) => s + inv.dueAmount, 0);
    if (!due) continue;
    const amount = i % 7 === 6 ? Math.round(due / 200) * 100 : due;
    await createPayment(
      admin,
      { studentId: String(e.studentId), amount, method: i % 3 === 0 ? 'bkash_manual' : 'cash' },
      `demo-payment-prev-${prevMonth}-${e.studentId}`,
    );
    paidPrev++;
  }
  log(`Last month payments recorded: ${paidPrev}`);

  // Spread payment dates over the last ten months so the monthly collection chart has a shape. Deterministic by
  // receipt order, so a rerun sets the same dates.
  const allPayments = await Payment.find().sort({ receiptNo: 1 }).select('_id').lean();
  for (const [k, p] of allPayments.entries()) {
    const back = k % 10;
    if (back === 0) continue;
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - back, 15);
    d.setUTCHours(6, 0, 0, 0);
    await Payment.updateOne({ _id: p._id }, { $set: { receivedAt: d } });
  }

  // Waivers
  const waivers = [
    { at: 1, type: 'percent', value: 50, reason: 'Sibling concession' },
    { at: 8, type: 'fixed', value: 30000, reason: 'Merit scholarship' },
    { at: 14, type: 'percent', value: 100, reason: 'Freedom fighter quota' },
  ] as const;
  for (const w of waivers) {
    const e = enrolments[w.at];
    if (!e || (await FeeAdjustment.exists({ studentId: e.studentId, reason: w.reason }))) continue;
    await FeeAdjustment.create({ studentId: e.studentId, sessionId: session._id, feeHeadId: tuition._id, type: w.type, value: w.value, reason: w.reason, approvedBy: admin.userId });
  }
  log('Fee waivers ready');

  // Attendance for the last 10 working days and today, with a few absents and lates. Class Eight B is left
  // untaken today so the Take attendance page has something to do.
  const today = todayLocal();
  const past = recentWorkdays(10);
  const attDates = ![5, 6].includes(dayOfWeek(today)) ? [today, ...past] : past;
  let sheets = 0;
  for (const sec of sections) {
    const roster = enrolments.filter((e) => String(e.sectionId) === String(sec._id));
    const classIdx = classes.findIndex((c) => String(c._id) === String(sec.classId));
    for (const [d, date] of attDates.entries()) {
      if (date === today && classIdx === 2 && sec.name === 'B') continue;
      const records = roster
        .map((e, j) => {
          const r = pseudo(d * 31 + j * 7 + sections.indexOf(sec));
          const status = r < 0.1 ? 'absent' : r < 0.17 ? 'late' : null;
          return status ? { studentId: String(e.studentId), status: status as 'absent' | 'late' } : null;
        })
        .filter((x): x is { studentId: string; status: 'absent' | 'late' } => !!x);
      const res = await submitSheet(admin, { sectionId: String(sec._id), date, records, allowWeekend: false });
      if (!res.existing) sheets++;
    }
  }
  log(`Attendance sheets: ${sheets} new`);

  // Exams: two published ones covering every section (one student fails a paper each time, for the fail list and
  // tabulation sheet) and one still open for marks entry, which is what the teacher login sees.
  const runExam = async (
    name: string,
    kind: 'term' | 'class_test' | 'monthly',
    finish: 'publish' | 'open',
    seed: number,
    absentAt: [number, number],
  ) => {
    let exam: any = await Exam.findOne({ name, sessionId: session._id });
    if (!exam) exam = await createExam({ name, sessionId, classIds: classes.map((c) => String(c._id)), kind });
    const examId = String(exam._id);
    if (exam.status === 'draft') await setExamStatus(examId, 'marks_open');
    if ((await Exam.findById(examId).lean())!.status === 'marks_open') {
      for (const sec of sections) {
        const roster = enrolments.filter((e) => String(e.sectionId) === String(sec._id));
        for (const [si, subj] of subjectDocs.entries()) {
          if (finish === 'open' && si > 0) break; // only Bangla is entered, and not submitted
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
                const absent = finish === 'publish' && j === absentAt[0] && si === absentAt[1];
                const ratio = 0.35 + pseudo(seed + j * 13 + si * 5 + ci) * 0.6;
                return { key: c.key, obtained: absent ? null : Math.min(c.fullMarks, Math.round(c.fullMarks * ratio)), absent };
              }),
            })),
          });
          if (finish === 'publish') await submitMarks(admin, examId, scope);
        }
      }
      if (finish === 'publish') await setExamStatus(examId, 'marks_closed');
    }
    if (finish === 'publish') await publishExam(admin, examId, { forceMissingAsAbsent: true });
  };
  await runExam(EXAM_NAME, 'term', 'publish', 0, [5, 4]);
  await runExam('Class Test 1', 'class_test', 'publish', 101, [4, 2]);
  await runExam('Monthly Test', 'monthly', 'open', 202, [-1, -1]);
  log('Exams ready: two published, one open for marks entry');

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

  await seedExtras({
    admin,
    sessionId,
    adminEmail: ADMIN_EMAIL,
    staffPassword: STAFF_PASSWORD,
    classes: classes.map((c) => ({
      id: String(c._id),
      name: c.name,
      sections: sections.filter((s: any) => String(s.classId) === String(c._id)).map((s: any) => ({ id: String(s._id), name: s.name })),
    })),
    subjects: subjectDocs.map((s: any) => ({ id: String(s._id), name: s.name })),
    subjectTeacherIds: SUBJECT_TEACHER_EMAILS.map((e) => String(teacherByEmail.get(e))),
    firstStudentId: String(enrolments[0].studentId),
    workdays: attDates,
  });
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
  log(`  student     demo.student / ${STAFF_PASSWORD}`);
  log(`  guardian    guardian@demo.school / ${STAFF_PASSWORD}`);
  await disconnectDb();
};

run().catch(async (err) => {
  console.error('[seed:demo] FAILED:', err?.message ?? err, err?.details ?? '');
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
