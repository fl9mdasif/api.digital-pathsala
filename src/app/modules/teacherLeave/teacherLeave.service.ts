import { Types } from 'mongoose';
import { AppError } from '../../errors/AppError';
import { addDays, dayOfWeek, todayLocal } from '../../lib/localDate';
import { buildMeta, toSkip, type PageParams } from '../../lib/pagination';
import { requireTenantId } from '../../lib/tenantContext';
import { writeAudit } from '../auditLog/auditLog.model';
import { Employee } from '../employee/employee.model';
import { TeacherAttendance } from '../teacherAttendance/teacherAttendance.model';
import { Tenant } from '../tenant/tenant.model';
import { DEFAULT_ALLOWANCES, TeacherLeave, TeacherLeaveConfig, type LeaveType } from './teacherLeave.model';

interface Auth {
  userId: Types.ObjectId;
  role: string;
}
type Allowances = typeof DEFAULT_ALLOWANCES;

const MAX_LEAVE_DAYS = 366;
const POPULATE = { path: 'employeeId', select: 'employeeCode userId', populate: { path: 'userId', select: 'name' } };

const weekendDays = async () => {
  const tenant = await Tenant.findById(requireTenantId()).select('settings.weekendDays').lean();
  return tenant?.settings.weekendDays ?? [5];
};

/** Calendar dates from `from` to `to` that are not weekend days. */
const workingDates = (from: string, to: string, weekend: number[]) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!weekend.includes(dayOfWeek(d))) out.push(d);
  return out;
};

export const getAllowances = async (): Promise<Allowances> => {
  const c = await TeacherLeaveConfig.findOne().lean();
  return { ...DEFAULT_ALLOWANCES, ...(c?.allowances ?? {}) };
};

export const saveAllowances = async (input: Allowances) => {
  const before = await getAllowances();
  await TeacherLeaveConfig.findOneAndUpdate(
    {},
    { $set: { allowances: input } },
    { upsert: true, setDefaultsOnInsert: true },
  );
  await writeAudit({
    action: 'teacherLeave.config',
    entityType: 'TeacherLeaveConfig',
    entityId: requireTenantId(),
    before,
    after: input,
  });
  return input;
};

/** Allowance, days used and days left per leave type for a calendar year. */
export const balance = async (employeeId: string, year = Number(todayLocal().slice(0, 4))) => {
  const [allowances, used] = await Promise.all([
    getAllowances(),
    TeacherLeave.aggregate([
      {
        $match: {
          employeeId: new Types.ObjectId(employeeId),
          status: 'approved',
          fromDate: { $gte: `${year}-01-01`, $lte: `${year}-12-31` },
        },
      },
      { $group: { _id: '$type', days: { $sum: '$days' } } },
    ]),
  ]);
  const usedBy = new Map<string, number>(used.map((u: any) => [u._id, u.days]));
  const row = (type: LeaveType) => {
    const u = usedBy.get(type) ?? 0;
    const allowed = type === 'unpaid' ? null : allowances[type as keyof Allowances];
    return { type, allowed, used: u, remaining: allowed === null ? null : Math.max(allowed - u, 0) };
  };
  return { employeeId, year, balances: (['casual', 'sick', 'annual', 'maternity', 'unpaid'] as const).map(row) };
};

const loadEmployee = async (id: string) => {
  const emp = await Employee.findOne({ _id: id, employmentStatus: { $in: ['active', 'on_leave'] } }).lean();
  if (!emp) throw AppError.notFound('Employee not found');
  return emp;
};

export const ownEmployee = async (auth: Auth) => {
  const emp = await Employee.findOne({ userId: auth.userId }).lean();
  if (!emp) throw AppError.notFound('No employee record found for your account');
  return emp;
};

export const apply = async (
  auth: Auth,
  input: { employeeId?: string; type: LeaveType; fromDate: string; toDate: string; reason?: string },
) => {
  let employeeId: string;
  if (auth.role === 'admin') {
    if (!input.employeeId) throw AppError.badRequest('employeeId is required', undefined, 'EMPLOYEE_REQUIRED');
    employeeId = String((await loadEmployee(input.employeeId))._id);
  } else {
    employeeId = String((await ownEmployee(auth))._id);
  }

  if (input.toDate < input.fromDate) throw AppError.badRequest('toDate must not be before fromDate');
  if (
    (Date.parse(`${input.toDate}T00:00:00Z`) - Date.parse(`${input.fromDate}T00:00:00Z`)) / 86_400_000 + 1 >
    MAX_LEAVE_DAYS
  )
    throw AppError.badRequest(`A leave request can span at most ${MAX_LEAVE_DAYS} days`);

  const days = workingDates(input.fromDate, input.toDate, await weekendDays()).length;
  if (days < 1)
    throw AppError.badRequest('The chosen dates are all weekend days', undefined, 'NO_WORKING_DAYS');

  const overlap = await TeacherLeave.exists({
    employeeId,
    status: { $in: ['pending', 'approved'] },
    fromDate: { $lte: input.toDate },
    toDate: { $gte: input.fromDate },
  });
  if (overlap) throw AppError.conflict('This overlaps another pending or approved leave', 'LEAVE_OVERLAP');

  const leave = await TeacherLeave.create({
    employeeId,
    type: input.type,
    fromDate: input.fromDate,
    toDate: input.toDate,
    days,
    reason: input.reason,
    appliedBy: auth.userId,
  });
  await writeAudit({ action: 'teacherLeave.apply', entityType: 'TeacherLeave', entityId: leave._id, after: input });
  return leave;
};

export const list = async (p: PageParams & { status?: string; employeeId?: string }) => {
  const filter: Record<string, unknown> = {};
  if (p.status) filter.status = p.status;
  if (p.employeeId) filter.employeeId = p.employeeId;
  const [rows, total] = await Promise.all([
    TeacherLeave.find(filter).sort({ createdAt: -1 }).skip(toSkip(p)).limit(p.limit).populate(POPULATE).lean(),
    TeacherLeave.countDocuments(filter),
  ]);
  return { rows, meta: buildMeta(p, total) };
};

export const mine = async (auth: Auth) => {
  const emp = await ownEmployee(auth);
  const [leaves, bal] = await Promise.all([
    TeacherLeave.find({ employeeId: emp._id }).sort({ fromDate: -1 }).limit(100).lean(),
    balance(String(emp._id)),
  ]);
  return { leaves, ...bal };
};

export const decide = async (auth: Auth, id: string, input: { status: 'approved' | 'rejected'; note?: string }) => {
  const leave = await TeacherLeave.findById(id);
  if (!leave) throw AppError.notFound('Leave request not found');
  if (leave.status !== 'pending')
    throw AppError.conflict('Only a pending request can be decided', 'NOT_PENDING');

  if (input.status === 'approved' && leave.type !== 'unpaid') {
    const year = Number(leave.fromDate.slice(0, 4));
    const row = (await balance(String(leave.employeeId), year)).balances.find((b) => b.type === leave.type)!;
    if ((row.remaining ?? 0) < leave.days)
      throw AppError.badRequest(
        `Not enough ${leave.type} leave left: ${row.remaining} day(s) remaining, ${leave.days} requested`,
        undefined,
        'INSUFFICIENT_BALANCE',
      );
  }

  leave.status = input.status;
  leave.decidedBy = auth.userId;
  leave.decidedAt = new Date();
  leave.decisionNote = input.note;
  await leave.save();

  if (input.status === 'approved') {
    // Days already passed show as leave on the attendance record; later days are filled in when the sheet is taken.
    const today = todayLocal();
    const dates = workingDates(leave.fromDate, leave.toDate, await weekendDays()).filter((d) => d <= today);
    await Promise.all(
      dates.map((date) =>
        TeacherAttendance.findOneAndUpdate(
          { employeeId: leave.employeeId, date },
          { $set: { status: 'leave', note: 'Approved leave', markedBy: auth.userId } },
          { upsert: true, setDefaultsOnInsert: true },
        ),
      ),
    );
  }
  await writeAudit({
    action: `teacherLeave.${input.status}`,
    entityType: 'TeacherLeave',
    entityId: leave._id,
    after: input,
  });
  return leave;
};

export const cancel = async (auth: Auth, id: string) => {
  const leave = await TeacherLeave.findById(id);
  if (!leave) throw AppError.notFound('Leave request not found');
  if (auth.role !== 'admin') {
    const emp = await ownEmployee(auth);
    if (!emp._id.equals(leave.employeeId)) throw AppError.notFound('Leave request not found');
  }
  if (leave.status !== 'pending')
    throw AppError.conflict('Only a pending request can be cancelled', 'NOT_PENDING');
  leave.status = 'cancelled';
  await leave.save();
  await writeAudit({ action: 'teacherLeave.cancel', entityType: 'TeacherLeave', entityId: leave._id });
  return leave;
};
