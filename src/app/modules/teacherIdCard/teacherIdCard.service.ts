import { AppError } from '../../errors/AppError';
import { fillTemplate } from '../../lib/fillTemplate';
import { requireTenantId } from '../../lib/tenantContext';
import { writeAudit } from '../auditLog/auditLog.model';
import { Department } from '../department/department.model';
import { Designation } from '../designation/designation.model';
import { Employee } from '../employee/employee.model';
import { renderSheet, type SheetCard } from '../idCard/idCard.service';
import { MAX_CARDS } from '../idCard/idCard.validation';
import { User } from '../user/user.model';
import { TeacherCardConfig, normalizeTeacherCardConfig, type TeacherCardConfigData } from './teacherIdCard.model';

type Locale = 'bn' | 'en';

export const TEACHER_PLACEHOLDERS = ['employee_code', 'name', 'designation', 'department', 'mobile', 'blood_group', 'dob', 'join_date'] as const;

const L = {
  en: { title: 'Staff ID Card', id: 'ID', designation: 'Designation', department: 'Department', mobile: 'Mobile', blood: 'Blood', dob: 'DOB', joined: 'Joined' },
  bn: { title: 'কর্মী পরিচয়পত্র', id: 'আইডি', designation: 'পদবি', department: 'বিভাগ', mobile: 'মোবাইল', blood: 'রক্ত', dob: 'জন্ম', joined: 'যোগদান' },
} as const;

export const getConfig = async (): Promise<TeacherCardConfigData> => normalizeTeacherCardConfig(await TeacherCardConfig.findOne().lean());

export const saveConfig = async (input: TeacherCardConfigData) => {
  const before = await getConfig();
  await TeacherCardConfig.findOneAndUpdate({}, { $set: input }, { upsert: true, setDefaultsOnInsert: true });
  await writeAudit({ action: 'teacherIdCard.config', entityType: 'TeacherCardConfig', entityId: requireTenantId(), before, after: input });
  return getConfig();
};

interface StaffCard {
  name: string;
  code: string;
  designation?: string;
  department?: string;
  mobile?: string;
  bloodGroup?: string;
  dob?: string;
  joinDate?: string;
  photoUrl?: string;
}

const SAMPLE: StaffCard = {
  name: 'Sample Teacher',
  code: 'EMP-0001',
  designation: 'Assistant Teacher',
  department: 'Science',
  mobile: '01700000000',
  bloodGroup: 'B+',
  dob: '1990-03-21',
  joinDate: '2020-01-15',
};

const day = (d?: Date | string) => (d ? new Date(d).toISOString().slice(0, 10) : undefined);

export const collect = async (q: { employeeIds?: string[]; departmentId?: string }, locale: Locale): Promise<StaffCard[]> => {
  const filter: Record<string, unknown> = { employmentStatus: { $in: ['active', 'on_leave'] } };
  if (q.employeeIds) filter._id = { $in: q.employeeIds };
  if (q.departmentId) filter.departmentId = q.departmentId;
  const employees: any[] = await Employee.find(filter).sort({ employeeCode: 1 }).limit(MAX_CARDS).lean();
  if (employees.length === 0) throw AppError.notFound('No staff found for the ID cards', 'NO_STAFF');

  const [users, designations, departments] = await Promise.all([
    User.find({ _id: { $in: employees.map((e) => e.userId) } }).select('name nameBn phone').lean(),
    Designation.find({ _id: { $in: employees.map((e) => e.designationId).filter(Boolean) } }).select('name nameBn').lean(),
    Department.find({ _id: { $in: employees.map((e) => e.departmentId).filter(Boolean) } }).select('name nameBn').lean(),
  ]);
  const byUser = new Map(users.map((u: any) => [String(u._id), u]));
  const byDes = new Map(designations.map((x: any) => [String(x._id), x]));
  const byDep = new Map(departments.map((x: any) => [String(x._id), x]));
  const pick = (x: any) => (x ? (locale === 'bn' && x.nameBn) || x.name : undefined);

  return employees.map((e) => {
    const u: any = byUser.get(String(e.userId));
    return {
      name: (locale === 'bn' && u?.nameBn) || u?.name || '-',
      code: e.employeeCode,
      designation: pick(byDes.get(String(e.designationId))),
      department: pick(byDep.get(String(e.departmentId))),
      mobile: u?.phone,
      bloodGroup: e.bloodGroup,
      dob: day(e.dateOfBirth),
      joinDate: day(e.joinDate),
      photoUrl: e.photoUrl,
    };
  });
};

export const cardLines = (c: StaffCard, cfg: TeacherCardConfigData, locale: Locale): string[] => {
  const t = L[locale];
  const s = cfg.show;
  const out = [`${t.id}: ${c.code}`];
  if (s.designation && c.designation) out.push(`${t.designation}: ${c.designation}`);
  if (s.department && c.department) out.push(`${t.department}: ${c.department}`);
  const dobBlood = [s.dob && c.dob ? `${t.dob}: ${c.dob}` : '', s.bloodGroup && c.bloodGroup ? `${t.blood}: ${c.bloodGroup}` : ''].filter(Boolean).join('   ');
  if (dobBlood) out.push(dobBlood);
  if (s.joinDate && c.joinDate) out.push(`${t.joined}: ${c.joinDate}`);
  if (s.mobile && c.mobile) out.push(`${t.mobile}: ${c.mobile}`);
  return out;
};

export const cardQr = (c: StaffCard, cfg: TeacherCardConfigData) => {
  if (cfg.qrMode === 'off') return '';
  const fallback = cfg.qrMode === 'dynamic' ? '{employee_code}' : '';
  return fillTemplate(cfg.qrData || fallback, {
    employee_code: c.code,
    name: c.name,
    designation: c.designation,
    department: c.department,
    mobile: c.mobile,
    blood_group: c.bloodGroup,
    dob: c.dob,
    join_date: c.joinDate,
  });
};

export interface RenderOptions {
  employeeIds?: string[];
  departmentId?: string;
  part: 'front' | 'back' | 'both';
  design?: 'modern' | 'classic' | 'mono';
  sample?: boolean;
}

export const renderCards = async (q: RenderOptions, locale: Locale) => {
  const [cards, cfg] = await Promise.all([q.sample ? Promise.resolve([SAMPLE]) : collect(q, locale), getConfig()]);
  const sheet: SheetCard[] = cards.map((c) => ({ name: c.name, lines: cardLines(c, cfg, locale), qr: cardQr(c, cfg), photoUrl: c.photoUrl }));
  const pdf = await renderSheet(sheet, cfg, { part: q.part, design: q.design, locale, title: L[locale].title });
  await writeAudit({ action: 'teacherIdCard.print', entityType: 'TeacherIdCard', entityId: requireTenantId(), after: { count: cards.length, part: q.part, sample: !!q.sample } });
  return { pdf, count: cards.length };
};
