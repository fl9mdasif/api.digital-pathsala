/**
 * Demo data for the modules added after the first demo seed: HR, staff attendance and leave, class and exam
 * routines, ID/admit card settings, the website extras and the student/guardian portal logins.
 * Every step skips what already exists, so it is safe to run again. Called from seedDemo.ts.
 */
import type { Types } from 'mongoose';
import { hashPassword } from '../app/lib/password';
import { addDays, dayOfWeek, todayLocal } from '../app/lib/localDate';
import { nextSeq } from '../app/modules/counter/counter.model';
import { Department } from '../app/modules/department/department.model';
import { Designation } from '../app/modules/designation/designation.model';
import { Employee } from '../app/modules/employee/employee.model';
import { StaffProfile } from '../app/modules/staffProfile/staffProfile.model';
import { PublicSite } from '../app/modules/publicSite/publicSite.model';
import { Exam } from '../app/modules/exam/exam.model';
import { createExam } from '../app/modules/exam/exam.service';
import { save as saveExamPaper } from '../app/modules/examRoutine/examRoutine.service';
import { RoutinePeriod } from '../app/modules/routinePeriod/routinePeriod.model';
import { saveSlot } from '../app/modules/classRoutine/classRoutine.service';
import { submitSheet as submitStaffSheet, saveConfig as saveStaffTimes } from '../app/modules/teacherAttendance/teacherAttendance.service';
import { TeacherAttendance } from '../app/modules/teacherAttendance/teacherAttendance.model';
import { apply as applyLeave, decide as decideLeave, cancel as cancelLeave, saveAllowances } from '../app/modules/teacherLeave/teacherLeave.service';
import { TeacherLeave } from '../app/modules/teacherLeave/teacherLeave.model';
import { getConfig as getIdCardConfig, saveConfig as saveIdCard } from '../app/modules/idCard/idCard.service';
import { saveConfig as saveAdmitCard, saveLockRule } from '../app/modules/admitCard/admitCard.service';
import { DEFAULT_ADMIT_CARD_CONFIG } from '../app/modules/admitCard/admitCard.model';
import { DEFAULT_TESTIMONIAL_CONFIG, Testimonial } from '../app/modules/testimonial/testimonial.model';
import { candidates as testimonialCandidates, issue as issueTestimonials, saveConfig as saveTestimonialConfig } from '../app/modules/testimonial/testimonial.service';
import { Student } from '../app/modules/student/student.model';
import { Guardian } from '../app/modules/guardian/guardian.model';
import { User } from '../app/modules/user/user.model';

export interface ExtrasContext {
  admin: { userId: Types.ObjectId; role: string };
  sessionId: string;
  adminEmail: string;
  staffPassword: string;
  /** Class order ascending, each with its sections (A then B). */
  classes: { id: string; name: string; sections: { id: string; name: string }[] }[];
  /** Subject names in the same order as the subject teachers. */
  subjects: { id: string; name: string }[];
  /** User id of the teacher for each subject, in the same order as `subjects`. */
  subjectTeacherIds: string[];
  /** Student ids of the first enrolment, to attach the portal logins to. */
  firstStudentId: string;
  /** Working days newest first, today included when it is a school day. */
  workdays: string[];
}

const log = (msg: string) => console.log(`[seed:demo] ${msg}`);

/** Deterministic pseudo-random so reruns give stable numbers. */
const pseudo = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

/** First Sunday-Thursday school day on or after `from`. */
const schoolDay = (from: string) => {
  let d = from;
  while ([5, 6].includes(dayOfWeek(d))) d = addDays(d, 1);
  return d;
};

const DESIGNATIONS = [
  { name: 'Headmaster', nameBn: 'প্রধান শিক্ষক' },
  { name: 'Senior Teacher', nameBn: 'জ্যেষ্ঠ শিক্ষক' },
  { name: 'Assistant Teacher', nameBn: 'সহকারী শিক্ষক' },
  { name: 'Accountant', nameBn: 'হিসাবরক্ষক' },
];
const DEPARTMENTS = [
  { name: 'Administration', nameBn: 'প্রশাসন' },
  { name: 'Languages', nameBn: 'ভাষা' },
  { name: 'Science and Maths', nameBn: 'বিজ্ঞান ও গণিত' },
  { name: 'Religion', nameBn: 'ধর্ম' },
  { name: 'Accounts', nameBn: 'হিসাব' },
];

/** Keyed by user email; the admin uses the admin email. */
const STAFF_HR: Record<string, { designation: string; department: string; type: 'permanent' | 'contractual' | 'part_time'; joined: string; salary: number; gender: 'male' | 'female'; bio: string; religion: string; blood: string; dob: string }> = {
  admin: { designation: 'Headmaster', department: 'Administration', type: 'permanent', joined: '2015-01-05', salary: 85000, gender: 'male', bio: 'Leads the school with over twenty years of teaching and administration experience.', religion: 'Islam', blood: 'O+', dob: '1972-03-14' },
  'kamal@demo.school': { designation: 'Senior Teacher', department: 'Languages', type: 'permanent', joined: '2016-02-01', salary: 52000, gender: 'male', bio: 'Teaches Bangla and leads the school literary club.', religion: 'Islam', blood: 'B+', dob: '1980-07-21' },
  'rekha@demo.school': { designation: 'Assistant Teacher', department: 'Languages', type: 'permanent', joined: '2019-07-15', salary: 38000, gender: 'female', bio: 'Teaches English and coaches the debating team.', religion: 'Hindu', blood: 'A+', dob: '1990-01-01' },
  'mizan@demo.school': { designation: 'Senior Teacher', department: 'Science and Maths', type: 'permanent', joined: '2017-03-10', salary: 50000, gender: 'male', bio: 'Teaches Mathematics and runs the olympiad preparation classes.', religion: 'Islam', blood: 'AB+', dob: '1983-11-02' },
  'farhana@demo.school': { designation: 'Assistant Teacher', department: 'Science and Maths', type: 'contractual', joined: '2021-01-10', salary: 32000, gender: 'female', bio: 'Teaches Science and supervises the school science fair.', religion: 'Islam', blood: 'O-', dob: '1994-05-30' },
  'abdul@demo.school': { designation: 'Assistant Teacher', department: 'Religion', type: 'part_time', joined: '2022-06-01', salary: 18000, gender: 'male', bio: 'Teaches Religion and Moral Education.', religion: 'Islam', blood: 'A-', dob: '1978-01-09' },
  'salim@demo.school': { designation: 'Accountant', department: 'Accounts', type: 'permanent', joined: '2018-09-01', salary: 42000, gender: 'male', bio: 'Manages fee collection and school accounts.', religion: 'Buddhist', blood: 'B-', dob: '1986-09-18' },
};

export const seedExtras = async (ctx: ExtrasContext) => {
  const { admin } = ctx;
  const today = todayLocal();

  // HR: designations, departments, one employee record per staff member
  for (const d of DESIGNATIONS) if (!(await Designation.exists({ name: d.name }))) await Designation.create(d);
  for (const d of DEPARTMENTS) if (!(await Department.exists({ name: d.name }))) await Department.create(d);
  const designations = new Map((await Designation.find().lean()).map((d: any) => [d.name, d._id]));
  const departments = new Map((await Department.find().lean()).map((d: any) => [d.name, d._id]));
  const staffUsers: any[] = await User.find({ role: { $in: ['admin', 'teacher', 'accountant'] }, status: 'active' }).lean();
  let employees = 0;
  for (const u of staffUsers) {
    const hr = STAFF_HR[u.role === 'admin' && u.email === ctx.adminEmail ? 'admin' : u.email];
    if (!hr) continue;
    // Staff birthdays: Rekha's is today so the dashboard has a birthday to show
    const dob = new Date(`${u.email === 'rekha@demo.school' ? `1990-${today.slice(5)}` : hr.dob}T00:00:00+06:00`);
    const existing: any = await Employee.findOne({ userId: u._id }).lean();
    if (existing) {
      const fill: Record<string, unknown> = {};
      if (!existing.religion) fill.religion = hr.religion;
      if (!existing.bloodGroup) fill.bloodGroup = hr.blood;
      if (!existing.dateOfBirth || u.email === 'rekha@demo.school') fill.dateOfBirth = dob;
      if (Object.keys(fill).length) await Employee.updateOne({ _id: existing._id }, { $set: fill });
      continue;
    }
    await Employee.create({
      religion: hr.religion,
      bloodGroup: hr.blood,
      dateOfBirth: dob,
      userId: u._id,
      employeeCode: `EMP-${String(await nextSeq('employee')).padStart(4, '0')}`,
      designationId: designations.get(hr.designation),
      departmentId: departments.get(hr.department),
      joinDate: new Date(`${hr.joined}T00:00:00Z`),
      employmentType: hr.type,
      gender: hr.gender,
      basicSalary: hr.salary,
      qualification: u.role === 'accountant' ? 'B.Com' : 'M.A., B.Ed.',
      address: 'Mirpur, Dhaka',
    });
    employees++;
  }
  log(`HR: ${designations.size} designations, ${departments.size} departments, ${employees} new employee records`);

  // Staff attendance for the same days as student attendance, then leave on top of it
  await saveStaffTimes({ inTime: '09:00', outTime: '15:00', graceMinutes: 10 });
  const everyone: any[] = await Employee.find({ employmentStatus: 'active' }).sort({ employeeCode: 1 }).lean();
  let staffSheets = 0;
  for (const [d, date] of ctx.workdays.entries()) {
    if (await TeacherAttendance.exists({ date })) continue;
    const records = everyone.map((e, j) => {
      const r = pseudo(d * 17 + j * 5 + 3);
      if (r < 0.05) return { employeeId: String(e._id), status: 'absent' as const, note: 'Sick' };
      if (r < 0.14) return { employeeId: String(e._id), status: 'present' as const, checkIn: `09:${20 + Math.floor(pseudo(j + d) * 30)}` };
      if (r < 0.18) return { employeeId: String(e._id), status: 'half_day' as const, checkIn: '09:05', note: 'Left early' };
      return { employeeId: String(e._id), status: 'present' as const, checkIn: `08:${40 + Math.floor(pseudo(j * 3 + d) * 19)}` };
    });
    await submitStaffSheet(admin, { date, records, allowWeekend: false });
    staffSheets++;
  }
  log(`Staff attendance sheets: ${staffSheets} new`);

  await saveAllowances({ casual: 10, sick: 14, annual: 15, maternity: 120 });
  const byEmail = new Map(staffUsers.map((u) => [u.email, u]));
  const employeeOf = async (email: string) => {
    const u = byEmail.get(email);
    return u ? ((await Employee.findOne({ userId: u._id }).lean()) as any) : null;
  };
  const leaves: { email: string; type: 'casual' | 'sick' | 'annual'; from: string; to: string; reason: string; outcome: 'approved' | 'pending' | 'rejected' | 'cancelled'; note?: string }[] = [
    { email: 'kamal@demo.school', type: 'casual', from: ctx.workdays[6], to: ctx.workdays[5], reason: 'Family function', outcome: 'approved', note: 'Approved' },
    { email: 'rekha@demo.school', type: 'sick', from: schoolDay(addDays(today, 3)), to: addDays(schoolDay(addDays(today, 3)), 1), reason: 'Fever and rest advised by the doctor', outcome: 'pending' },
    { email: 'mizan@demo.school', type: 'annual', from: schoolDay(addDays(today, 15)), to: addDays(schoolDay(addDays(today, 15)), 4), reason: 'Travel to the village', outcome: 'rejected', note: 'Exam period, please choose later dates' },
    { email: 'salim@demo.school', type: 'casual', from: schoolDay(addDays(today, 8)), to: schoolDay(addDays(today, 8)), reason: 'Bank work', outcome: 'cancelled' },
  ];
  let leaveCount = 0;
  for (const l of leaves) {
    const emp = await employeeOf(l.email);
    if (!emp || (await TeacherLeave.exists({ employeeId: emp._id, fromDate: l.from }))) continue;
    const from = l.from <= l.to ? l.from : l.to;
    const to = l.from <= l.to ? l.to : l.from;
    const leave: any = await applyLeave(admin, { employeeId: String(emp._id), type: l.type, fromDate: from, toDate: to, reason: l.reason });
    if (l.outcome === 'approved') await decideLeave(admin, String(leave._id), { status: 'approved', note: l.note });
    if (l.outcome === 'rejected') await decideLeave(admin, String(leave._id), { status: 'rejected', note: l.note });
    if (l.outcome === 'cancelled') await cancelLeave(admin, String(leave._id));
    leaveCount++;
  }
  log(`Leave requests: ${leaveCount} new`);

  // Class periods and a clash-free weekly routine: (section + day + period) % 6 picks the subject, 5 means a free period
  const periods = [
    { name: '1st', nameBn: '১ম', startTime: '09:00', endTime: '09:45', order: 1, isBreak: false },
    { name: '2nd', nameBn: '২য়', startTime: '09:45', endTime: '10:30', order: 2, isBreak: false },
    { name: '3rd', nameBn: '৩য়', startTime: '10:30', endTime: '11:15', order: 3, isBreak: false },
    { name: 'Tiffin', nameBn: 'টিফিন', startTime: '11:15', endTime: '11:45', order: 4, isBreak: true },
    { name: '4th', nameBn: '৪র্থ', startTime: '11:45', endTime: '12:30', order: 5, isBreak: false },
    { name: '5th', nameBn: '৫ম', startTime: '12:30', endTime: '13:15', order: 6, isBreak: false },
  ];
  for (const p of periods) if (!(await RoutinePeriod.exists({ name: p.name }))) await RoutinePeriod.create(p);
  const periodDocs: any[] = await RoutinePeriod.find({ isBreak: false }).sort({ order: 1 }).lean();
  const allSections = ctx.classes.flatMap((c) => c.sections.map((s) => ({ ...s, className: c.name })));
  let slots = 0;
  for (const [s, sec] of allSections.entries()) {
    for (let day = 0; day < 5; day++) {
      for (const [p, period] of periodDocs.entries()) {
        const k = (s + day + p) % 6;
        if (k === 5) continue;
        await saveSlot({
          sectionId: sec.id,
          day,
          periodId: String(period._id),
          subjectId: ctx.subjects[k].id,
          teacherId: ctx.subjectTeacherIds[k],
          room: `Room ${sec.className.replace('Class ', '').slice(0, 3)}-${sec.name}`,
        });
        slots++;
      }
    }
  }
  log(`Class routine: ${slots} slots across ${allSections.length} sections`);

  // An upcoming exam with its routine, so exam routine and admit cards have something to show
  const annual = 'Annual Examination';
  let exam: any = await Exam.findOne({ name: annual, sessionId: ctx.sessionId });
  if (!exam) {
    exam = await createExam({
      name: annual,
      kind: 'term',
      sessionId: ctx.sessionId,
      classIds: ctx.classes.map((c) => c.id),
      startDate: schoolDay(addDays(today, 30)),
      endDate: addDays(today, 42),
    });
  }
  let papers = 0;
  for (const [ci, cls] of ctx.classes.entries()) {
    let date = exam.startDate as string;
    for (const subject of ctx.subjects) {
      date = schoolDay(date);
      await saveExamPaper({
        examId: String(exam._id),
        classId: cls.id,
        subjectId: subject.id,
        date,
        startTime: '10:00',
        endTime: '12:00',
        room: `Hall ${ci + 1}`,
      });
      papers++;
      date = addDays(date, 1);
    }
  }
  log(`Exam routine: ${papers} papers for ${annual}`);

  // Card settings: the admit card holds cards of students with overdue fees
  const idBase = await getIdCardConfig();
  await saveIdCard({
    ...idBase,
    design: 'modern',
    themeColor: '#0f766e',
    signatureTitle: 'Headmaster',
    backTop: 'This card is the property of the school. If found, please return it to the school office.',
    backBottom: 'Helpline 01700000001',
    qrMode: 'dynamic',
    qrData: 'ID {student_id} | {name} | Class {class_name} | Roll {roll}',
    show: { ...idBase.show, bloodGroup: true, mother: true },
  });
  await saveAdmitCard({
    ...DEFAULT_ADMIT_CARD_CONFIG,
    signatureTitle: 'Headmaster',
    instructions: 'Bring this card and your own pen to every paper. Mobile phones are not allowed in the exam hall.',
    blockIfDue: true,
    maxDueAllowed: 0,
    themeColor: '#0f766e',
    perPage: 2,
    show: { ...DEFAULT_ADMIT_CARD_CONFIG.show, qr: true, sigClassTeacher: true, sigAccounts: true },
  });
  // The Annual Examination has its own lockdown: dues above 500 Tk block the card, and an admin can still print it.
  await saveLockRule(String(exam._id), { active: true, maxDueAllowed: 50000, feeHeadIds: [], adminCanPrint: true });
  await saveTestimonialConfig({
    ...DEFAULT_TESTIMONIAL_CONFIG,
    language: 'bn',
    layout: 'classic',
    themeColor: '#0f766e',
    sigLeftLabel: 'শ্রেণি শিক্ষক',
    sigRightLabel: 'প্রধান শিক্ষক',
  });
  // A few issued testimonials for the highest class, so Generate and History have something to show.
  if ((await Testimonial.countDocuments()) === 0) {
    const top = ctx.classes[ctx.classes.length - 1];
    const people = (await testimonialCandidates(top.sections[0].id)).slice(0, 3);
    const places = [
      { village: 'রামপুর', postOffice: 'রামপুর', upazila: 'চুয়াডাঙ্গা সদর', district: 'চুয়াডাঙ্গা' },
      { village: 'কালীগঞ্জ', postOffice: 'কালীগঞ্জ', upazila: 'আলমডাঙ্গা', district: 'চুয়াডাঙ্গা' },
      { village: 'বাঁশবাড়িয়া', postOffice: 'বাঁশবাড়িয়া', upazila: 'দামুড়হুদা', district: 'চুয়াডাঙ্গা' },
    ];
    if (people.length > 0)
      await issueTestimonials({
        issueDate: addDays(schoolDay(today), -7),
        items: people.map((p, i) => ({
          studentId: p.studentId,
          exam: 'SSC',
          passingYear: String(new Date().getFullYear()),
          gpa: ['5.00', '4.89', '4.67'][i],
          boardRoll: String(210400 + i * 17),
          boardReg: String(1810000000 + i * 123),
          conduct: 'ভালো',
          ...places[i],
        })),
      });
  }
  log('ID card, admit card and testimonial settings ready');

  // Website: the sections the first seed left empty (no images on purpose)
  await PublicSite.updateOne(
    {},
    {
      $set: {
        'theme.primaryColor': '#0f766e',
        mission: 'প্রতিটি শিশুর মধ্যে জ্ঞান, মূল্যবোধ আর সৃজনশীলতার বিকাশ ঘটানো আমাদের লক্ষ্য।',
        headMessage: {
          name: 'Demo Admin',
          designation: 'প্রধান শিক্ষক',
          text: 'আমাদের বিদ্যালয়ে প্রতিটি শিক্ষার্থী নিরাপদ পরিবেশে মানসম্মত শিক্ষা পায়। অভিভাবকদের সহযোগিতায় আমরা শিক্ষার্থীদের আলোকিত ভবিষ্যতের পথে এগিয়ে নিয়ে যাচ্ছি।',
        },
        admissionInfo: {
          isOpen: true,
          text: 'নতুন শিক্ষাবর্ষের ভর্তি চলছে। আবেদন করতে ওয়েবসাইটের ফর্ম পূরণ করুন অথবা অফিসে যোগাযোগ করুন।',
          classes: ['Class Six', 'Class Seven', 'Class Eight'],
          lastDate: addDays(today, 45),
        },
        social: { facebook: 'https://facebook.com/demomodelschool', youtube: 'https://youtube.com/@demomodelschool' },
        seo: { title: 'ডেমো মডেল স্কুল - ঢাকা', description: 'ডেমো মডেল স্কুল, মিরপুর, ঢাকা। ভর্তি, ফলাফল ও নোটিশ এক জায়গায়।' },
      },
    },
  );
  let profiles = 0;
  for (const [i, u] of staffUsers.entries()) {
    const hr = STAFF_HR[u.role === 'admin' && u.email === ctx.adminEmail ? 'admin' : u.email];
    if (!hr || u.role === 'accountant' || (await StaffProfile.exists({ userId: u._id }))) continue;
    await StaffProfile.create({ userId: u._id, name: u.name, designation: hr.designation, bio: hr.bio, showOnPublicSite: true, order: i });
    profiles++;
  }
  log(`Website extras ready, ${profiles} teacher profiles added`);

  // Portal logins with fixed, memorable identifiers (generated student ids are not predictable)
  const student: any = await Student.findById(ctx.firstStudentId).select('name guardianIds').lean();
  const pwHash = await hashPassword(ctx.staffPassword);
  if (student && !(await User.exists({ role: 'student', linkedStudentId: student._id })) && !(await User.exists({ studentLoginId: 'demo.student' }))) {
    await User.create({ role: 'student', name: student.name, studentLoginId: 'demo.student', linkedStudentId: student._id, passwordHash: pwHash, mustChangePassword: false });
  }
  const guardianId = student?.guardianIds?.[0];
  if (guardianId && !(await User.exists({ role: 'guardian', linkedGuardianId: guardianId })) && !(await User.exists({ email: 'guardian@demo.school' }))) {
    const guardian: any = await Guardian.findById(guardianId).select('name').lean();
    await User.create({ role: 'guardian', name: guardian?.name ?? 'Demo Guardian', email: 'guardian@demo.school', linkedGuardianId: guardianId, passwordHash: pwHash, mustChangePassword: false });
  }
  log('Student and guardian portal logins ready');
};
