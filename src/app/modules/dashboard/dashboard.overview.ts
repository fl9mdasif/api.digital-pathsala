import { addDays, dayOfWeek, localDateStart, todayLocal } from '../../lib/localDate';
import { requireTenantId } from '../../lib/tenantContext';
import { AcademicSession } from '../academicSession/academicSession.model';
import { ClassModel } from '../class/class.model';
import { Designation } from '../designation/designation.model';
import { Employee } from '../employee/employee.model';
import { Enrolment } from '../enrolment/enrolment.model';
import { Payment } from '../payment/payment.model';
import { Section } from '../section/section.model';
import { Student } from '../student/student.model';
import { Subject } from '../subject/subject.model';
import { TeacherLeave } from '../teacherLeave/teacherLeave.model';
import { Tenant } from '../tenant/tenant.model';
import { User } from '../user/user.model';

const BLOOD_GROUPS = ['A+', 'A-', 'AB+', 'AB-', 'B+', 'B-', 'O+', 'O-'] as const;
const RELIGIONS = ['Islam', 'Hindu', 'Christian', 'Buddhist'] as const;

const religionKey = (raw?: string | null) => {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return 'none';
  if (['islam', 'muslim'].includes(v)) return 'Islam';
  if (v === 'hindu' || v === 'hinduism') return 'Hindu';
  if (['christian', 'christianity'].includes(v)) return 'Christian';
  if (['buddhist', 'buddhism'].includes(v)) return 'Buddhist';
  return 'Others';
};

const countBy = <T>(rows: T[], key: (r: T) => string, weight: (r: T) => number = () => 1) => {
  const out: Record<string, number> = {};
  for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + weight(r);
  return out;
};

const genderCounts = (by: Record<string, number>) => ({
  male: by.male ?? 0,
  female: by.female ?? 0,
  other: Object.entries(by).reduce((s, [k, n]) => (k === 'male' || k === 'female' ? s : s + n), 0),
});

const sumPayments = async (from: Date) => {
  const rows = await Payment.aggregate([
    { $match: { status: 'succeeded', receivedAt: { $gte: from } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return (rows[0]?.total as number | undefined) ?? 0;
};

/** The numbers behind the admin home: school, money, people, birthdays, religion, blood groups and chart data. */
export const adminOverview = async () => {
  const today = todayLocal();
  const [, m, d] = today.split('-');
  const year = today.slice(0, 4);
  const weekStart = addDays(today, -dayOfWeek(today));

  const [tenant, session] = await Promise.all([
    Tenant.findById(requireTenantId()).select('name nameBn slug eiin contact.address').lean(),
    AcademicSession.findOne({ isCurrent: true }).select('name').lean(),
  ]);

  const [classes, sections, subjects, staffUsers] = await Promise.all([
    ClassModel.countDocuments(),
    Section.countDocuments({ isDefault: { $ne: true } }),
    Subject.countDocuments(),
    User.countDocuments({ role: { $in: ['admin', 'teacher', 'accountant'] }, status: 'active' }),
  ]);

  const [today$, week$, month$, year$, monthlyRows] = await Promise.all([
    sumPayments(localDateStart(today)),
    sumPayments(localDateStart(weekStart)),
    sumPayments(localDateStart(`${today.slice(0, 7)}-01`)),
    sumPayments(localDateStart(`${year}-01-01`)),
    Payment.aggregate([
      { $match: { status: 'succeeded', receivedAt: { $gte: localDateStart(`${year}-01-01`) } } },
      { $group: { _id: { $month: { date: '$receivedAt', timezone: 'Asia/Dhaka' } }, total: { $sum: '$amount' } } },
    ]),
  ]);
  const monthly = Array.from({ length: 12 }, (_, i) => (monthlyRows.find((r: any) => r._id === i + 1)?.total as number | undefined) ?? 0);

  const students: any[] = await Student.find({ status: 'active' }).select('gender religion bloodGroup dob name').lean();
  const employees: any[] = await Employee.find({ employmentStatus: { $in: ['active', 'on_leave'] } })
    .populate('userId', 'name')
    .select('gender religion bloodGroup dateOfBirth designationId userId')
    .lean();

  const studentGender = genderCounts(countBy(students, (s) => s.gender));
  const staffByGender = countBy(employees, (e) => e.gender ?? 'other');
  const staffGender = genderCounts(staffByGender);
  staffGender.other += Math.max(staffUsers - employees.length, 0);

  const birthdayStudents = students.filter((s) => typeof s.dob === 'string' && s.dob.slice(5) === `${m}-${d}`);
  const birthdayStaff = employees.filter((e) => {
    if (!e.dateOfBirth) return false;
    const local = new Date(new Date(e.dateOfBirth).getTime() + 6 * 3600_000).toISOString().slice(5, 10);
    return local === `${m}-${d}`;
  });

  const religionStudents = countBy(students, (s) => religionKey(s.religion));
  const religionStaff = countBy(employees, (e) => religionKey(e.religion));
  const religion = [...RELIGIONS, 'Others', 'none'].map((key) => ({ key, students: religionStudents[key] ?? 0, staff: religionStaff[key] ?? 0 }));

  const bloodStudents = countBy(students, (s) => s.bloodGroup ?? 'none');
  const bloodStaff = countBy(employees, (e) => e.bloodGroup ?? 'none');
  const bloodGroups = [...BLOOD_GROUPS, 'none'].map((key) => ({ key, students: bloodStudents[key] ?? 0, staff: bloodStaff[key] ?? 0 }));

  // Students per class in the current session
  const byClass: { name: string; nameBn?: string; students: number }[] = [];
  if (session) {
    const rows = await Enrolment.aggregate([
      { $match: { sessionId: (session as any)._id, status: 'active' } },
      { $group: { _id: '$classId', students: { $sum: 1 } } },
    ]);
    const classDocs: any[] = await ClassModel.find({ _id: { $in: rows.map((r: any) => r._id) } }).select('name nameBn order').lean();
    for (const c of classDocs.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))
      byClass.push({ name: c.name, nameBn: c.nameBn, students: rows.find((r: any) => String(r._id) === String(c._id))?.students ?? 0 });
  }

  // Staff per designation
  const designations: any[] = await Designation.find().select('name nameBn').lean();
  const desig = countBy(employees, (e) => String(e.designationId ?? 'none'));
  const byDesignation = Object.entries(desig).map(([id, count]) => {
    const dd = designations.find((x) => String(x._id) === id);
    return { name: dd?.name ?? 'No designation', nameBn: dd?.nameBn, count };
  });

  return {
    date: today,
    school: {
      name: (tenant as any)?.name,
      nameBn: (tenant as any)?.nameBn,
      slug: (tenant as any)?.slug,
      eiin: (tenant as any)?.eiin,
      address: (tenant as any)?.contact?.address,
    },
    session: session ? { name: (session as any).name } : null,
    totals: { classes, sections, subjects },
    collection: { today: today$, week: week$, month: month$, year: year$ },
    monthly,
    students: { total: students.length, ...studentGender },
    staff: { total: staffUsers, ...staffGender },
    birthdays: {
      students: birthdayStudents.length,
      staff: birthdayStaff.length,
      names: [...birthdayStudents.map((s) => s.name), ...birthdayStaff.map((e) => e.userId?.name).filter(Boolean)].slice(0, 5),
    },
    religion,
    bloodGroups,
    byClass,
    byDesignation,
    pendingLeaves: await TeacherLeave.countDocuments({ status: 'pending' }),
  };
};
