import type { Types } from 'mongoose';
import { AppError } from '../../errors/AppError';
import { dayOfWeek, isFuture } from '../../lib/localDate';
import { requireTenantId } from '../../lib/tenantContext';
import { writeAudit } from '../auditLog/auditLog.model';
import { Employee } from '../employee/employee.model';
import { TeacherLeave } from '../teacherLeave/teacherLeave.model';
import { Tenant } from '../tenant/tenant.model';
import { TeacherAttendance, TeacherAttendanceConfig } from './teacherAttendance.model';

interface Auth {
  userId: Types.ObjectId;
  role: string;
}
type Status = 'present' | 'absent' | 'late' | 'leave' | 'half_day';
type Rec = { employeeId: string; status: Status; checkIn?: string; checkOut?: string; note?: string };

const DEFAULT_CONFIG = { inTime: '09:00', outTime: '15:00', graceMinutes: 10 };
const MAX_REPORT_DAYS = 366;

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export const getConfig = async () => {
  const c = await TeacherAttendanceConfig.findOne().lean();
  return c ? { inTime: c.inTime, outTime: c.outTime, graceMinutes: c.graceMinutes } : { ...DEFAULT_CONFIG };
};

export const saveConfig = async (input: { inTime: string; outTime: string; graceMinutes: number }) => {
  if (minutes(input.outTime) <= minutes(input.inTime))
    throw AppError.badRequest('Out time must be after in time');
  const before = await getConfig();
  await TeacherAttendanceConfig.findOneAndUpdate({}, { $set: input }, { upsert: true, setDefaultsOnInsert: true });
  await writeAudit({
    action: 'teacherAttendance.config',
    entityType: 'TeacherAttendanceConfig',
    entityId: requireTenantId(),
    before,
    after: input,
  });
  return input;
};

/** Every active employee with the status already recorded for the date (default present). */
export const getSheet = async (date: string) => {
  const [employees, existing, leaves] = await Promise.all([
    Employee.find({ employmentStatus: { $in: ['active', 'on_leave'] } })
      .populate('userId', 'name')
      .populate('designationId', 'name nameBn')
      .sort({ employeeCode: 1 })
      .lean(),
    TeacherAttendance.find({ date }).lean(),
    TeacherLeave.find({ status: 'approved', fromDate: { $lte: date }, toDate: { $gte: date } })
      .select('employeeId')
      .lean(),
  ]);
  const byEmployee = new Map(existing.map((r: any) => [String(r.employeeId), r]));
  const onLeave = new Set(leaves.map((l: any) => String(l.employeeId)));
  return {
    date,
    taken: existing.length > 0,
    config: await getConfig(),
    records: employees.map((e: any) => {
      const r = byEmployee.get(String(e._id));
      return {
        employeeId: e._id,
        name: e.userId?.name,
        employeeCode: e.employeeCode,
        designation: e.designationId ? { name: e.designationId.name, nameBn: e.designationId.nameBn } : null,
        marked: !!r,
        status: r?.status ?? (onLeave.has(String(e._id)) ? 'leave' : 'present'),
        checkIn: r?.checkIn,
        checkOut: r?.checkOut,
        note: r?.note,
      };
    }),
  };
};

export const submitSheet = async (auth: Auth, input: { date: string; records: Rec[]; allowWeekend: boolean }) => {
  if (isFuture(input.date))
    throw AppError.badRequest('Attendance cannot be taken for a future date', undefined, 'FUTURE_DATE');

  const tenant = await Tenant.findById(requireTenantId()).select('settings.weekendDays').lean();
  const weekend = tenant?.settings.weekendDays ?? [5];
  if (weekend.includes(dayOfWeek(input.date)) && !input.allowWeekend) {
    throw AppError.badRequest(
      'This date is a weekend day. Set allowWeekend to record it anyway.',
      undefined,
      'WEEKEND_DATE',
    );
  }

  const ids = input.records.map((r) => r.employeeId);
  if (new Set(ids).size !== ids.length)
    throw AppError.badRequest('An employee appears more than once', undefined, 'DUPLICATE_EMPLOYEE');
  const valid = await Employee.countDocuments({
    _id: { $in: ids },
    employmentStatus: { $in: ['active', 'on_leave'] },
  });
  if (valid !== ids.length)
    throw AppError.badRequest('A listed employee does not exist or is no longer employed', undefined, 'NOT_EMPLOYED');

  const cfg = await getConfig();
  const lateAfter = minutes(cfg.inTime) + cfg.graceMinutes;
  const prepared = input.records.map((r) => ({
    ...r,
    status:
      r.status === 'present' && r.checkIn && minutes(r.checkIn) > lateAfter ? ('late' as const) : r.status,
  }));

  await Promise.all(
    prepared.map((r) =>
      TeacherAttendance.findOneAndUpdate(
        { employeeId: r.employeeId, date: input.date },
        {
          $set: {
            status: r.status,
            checkIn: r.checkIn ?? null,
            checkOut: r.checkOut ?? null,
            note: r.note ?? null,
            markedBy: auth.userId,
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      ),
    ),
  );
  await writeAudit({
    action: 'teacherAttendance.submit',
    entityType: 'TeacherAttendance',
    entityId: requireTenantId(),
    after: { date: input.date, count: prepared.length },
  });
  return { date: input.date, saved: prepared.length, records: prepared };
};

const percent = (c: { present: number; late: number; half_day: number; absent: number }) => {
  const denom = c.present + c.late + c.half_day + c.absent; // leave is excluded from the denominator
  return denom === 0 ? null : Math.round(((c.present + c.late + c.half_day * 0.5) / denom) * 10000) / 100;
};

const assertRange = (from: string, to: string) => {
  if (to < from) throw AppError.badRequest('to must not be before from');
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_REPORT_DAYS) throw AppError.badRequest(`Choose a range of at most ${MAX_REPORT_DAYS} days`);
};

const emptyCounts = () => ({ present: 0, absent: 0, late: 0, leave: 0, half_day: 0 });

export const report = async (from: string, to: string, employeeId?: string) => {
  assertRange(from, to);
  const filter: Record<string, unknown> = { date: { $gte: from, $lte: to } };
  if (employeeId) filter.employeeId = employeeId;
  const records = await TeacherAttendance.find(filter).sort({ date: 1 }).lean();

  const stats = new Map<string, ReturnType<typeof emptyCounts> & { byDate: Record<string, string> }>();
  for (const r of records as any[]) {
    const k = String(r.employeeId);
    const s = stats.get(k) ?? { ...emptyCounts(), byDate: {} };
    s[r.status as Status] += 1;
    s.byDate[r.date] = r.status;
    stats.set(k, s);
  }
  const employees = await Employee.find({ _id: { $in: [...stats.keys()] } })
    .populate('userId', 'name')
    .select('employeeCode userId')
    .lean();
  const info = new Map((employees as any[]).map((e) => [String(e._id), e]));
  return {
    from,
    to,
    rows: [...stats.entries()].map(([id, s]) => ({
      employeeId: id,
      name: info.get(id)?.userId?.name,
      employeeCode: info.get(id)?.employeeCode,
      present: s.present,
      absent: s.absent,
      late: s.late,
      leave: s.leave,
      halfDay: s.half_day,
      percent: percent(s),
      ...(employeeId ? { byDate: s.byDate } : {}),
    })),
  };
};

/** A teacher's own attendance, found through their employee record. */
export const myReport = async (auth: Auth, from: string, to: string) => {
  const emp = await Employee.findOne({ userId: auth.userId }).select('_id').lean();
  if (!emp) throw AppError.notFound('No employee record found for your account');
  return report(from, to, String(emp._id));
};
