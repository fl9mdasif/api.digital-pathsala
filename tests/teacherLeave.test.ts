import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, dayOfWeek, todayLocal } from '../src/app/lib/localDate';
import { Employee } from '../src/app/modules/employee/employee.model';
import { TeacherAttendance } from '../src/app/modules/teacherAttendance/teacherAttendance.model';
import { TeacherLeave, TeacherLeaveConfig } from '../src/app/modules/teacherLeave/teacherLeave.model';
import { agent, authed, login, registerTenant } from './helpers/api';
import { useTestDb } from './helpers/db';

useTestDb();

beforeAll(async () => {
  await Promise.all([Employee.init(), TeacherAttendance.init(), TeacherLeave.init(), TeacherLeaveConfig.init()]);
});

const working = (from: string, to: string) => {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (dayOfWeek(d) !== 5) n += 1;
  return n;
};
/** Start of a 3-day window in the past that begins on a Sunday (Friday is the default weekend). */
const pastSunday = () => {
  let d = addDays(todayLocal(), -14);
  while (dayOfWeek(d) !== 0) d = addDays(d, -1);
  return d;
};

const setup = async () => {
  const t = await registerTenant();
  const h = authed(t.token);
  const mk = async (email: string, name: string) => {
    const user = (
      await agent().post('/api/v1/users').set(h).send({ role: 'teacher', name, email, password: 'Teacher#12345' })
    ).body.data.user;
    const emp = (await agent().post('/api/v1/employees').set(h).send({ userId: user.id })).body.data;
    const tok = authed((await login(t.slug, email, 'Teacher#12345')).body.data.accessToken);
    return { emp, tok };
  };
  return { t, h, a: await mk('l1@example.com', 'Leave Sir'), b: await mk('l2@example.com', 'Other Sir') };
};

describe('teacher leave', () => {
  it('lets staff apply for themselves, counts only working days and blocks overlaps', async () => {
    const { a, h } = await setup();
    const from = pastSunday();
    const to = addDays(from, 6); // Sunday to Saturday, includes one Friday
    const res = await agent().post('/api/v1/teacher-leaves').set(a.tok).send({ type: 'casual', fromDate: from, toDate: to });
    expect(res.status).toBe(201);
    expect(res.body.data.days).toBe(working(from, to));
    expect(res.body.data.status).toBe('pending');

    const overlap = await agent().post('/api/v1/teacher-leaves').set(a.tok).send({ type: 'sick', fromDate: to, toDate: addDays(to, 2) });
    expect(overlap.body.code).toBe('LEAVE_OVERLAP');

    const friday = (() => {
      let d = addDays(todayLocal(), 7);
      while (dayOfWeek(d) !== 5) d = addDays(d, 1);
      return d;
    })();
    const weekendOnly = await agent().post('/api/v1/teacher-leaves').set(a.tok).send({ type: 'sick', fromDate: friday, toDate: friday });
    expect(weekendOnly.body.code).toBe('NO_WORKING_DAYS');

    const noEmp = await agent().post('/api/v1/teacher-leaves').set(h).send({ type: 'casual', fromDate: from, toDate: to });
    expect(noEmp.body.code).toBe('EMPLOYEE_REQUIRED');
  });

  it('approves with balance tracking and records leave on the attendance sheet', async () => {
    const { a, h } = await setup();
    const from = pastSunday();
    const to = addDays(from, 2);
    const leave = (await agent().post('/api/v1/teacher-leaves').set(a.tok).send({ type: 'casual', fromDate: from, toDate: to })).body.data;

    expect((await agent().patch(`/api/v1/teacher-leaves/${leave._id}/decision`).set(a.tok).send({ status: 'approved' })).status).toBe(403);

    const pending = await agent().get('/api/v1/teacher-leaves?status=pending').set(h);
    expect(pending.body.data).toHaveLength(1);
    expect(pending.body.data[0].employeeId.userId.name).toBe('Leave Sir');

    const approved = await agent().patch(`/api/v1/teacher-leaves/${leave._id}/decision`).set(h).send({ status: 'approved', note: 'ok' });
    expect(approved.body.data.status).toBe('approved');
    expect((await agent().patch(`/api/v1/teacher-leaves/${leave._id}/decision`).set(h).send({ status: 'rejected' })).body.code).toBe('NOT_PENDING');

    const me = (await agent().get('/api/v1/teacher-leaves/me').set(a.tok)).body.data;
    const casual = me.balances.find((b: any) => b.type === 'casual');
    expect(casual).toMatchObject({ allowed: 10, used: 3, remaining: 7 });
    expect(me.leaves).toHaveLength(1);

    const sheet = (await agent().get(`/api/v1/teacher-attendance/sheet?date=${from}`).set(h)).body.data;
    expect(sheet.records.find((r: any) => r.name === 'Leave Sir')).toMatchObject({ status: 'leave', marked: true });
    expect(sheet.records.find((r: any) => r.name === 'Other Sir')).toMatchObject({ status: 'present', marked: false });
  });

  it('refuses approval beyond the yearly allowance but always allows unpaid leave', async () => {
    const { a, h } = await setup();
    await agent().put('/api/v1/teacher-leaves/config').set(h).send({ casual: 1, sick: 14, annual: 15, maternity: 120 });
    const from = pastSunday();
    const to = addDays(from, 2);
    const casual = (await agent().post('/api/v1/teacher-leaves').set(a.tok).send({ type: 'casual', fromDate: from, toDate: to })).body.data;
    const refused = await agent().patch(`/api/v1/teacher-leaves/${casual._id}/decision`).set(h).send({ status: 'approved' });
    expect(refused.body.code).toBe('INSUFFICIENT_BALANCE');
    await agent().patch(`/api/v1/teacher-leaves/${casual._id}/decision`).set(h).send({ status: 'rejected', note: 'no balance' });

    const unpaid = (await agent().post('/api/v1/teacher-leaves').set(a.tok).send({ type: 'unpaid', fromDate: from, toDate: to })).body.data;
    const ok = await agent().patch(`/api/v1/teacher-leaves/${unpaid._id}/decision`).set(h).send({ status: 'approved' });
    expect(ok.body.data.status).toBe('approved');
    const bal = (await agent().get(`/api/v1/teacher-leaves/balance?employeeId=${a.emp._id}`).set(h)).body.data;
    expect(bal.balances.find((b: any) => b.type === 'unpaid')).toMatchObject({ allowed: null, used: 3, remaining: null });
  });

  it('shows future approved leave as the default on the sheet and limits cancelling to the owner', async () => {
    const { a, b, h } = await setup();
    const from = addDays(todayLocal(), 10);
    const to = addDays(from, 1);
    const leave = (await agent().post('/api/v1/teacher-leaves').set(a.tok).send({ type: 'annual', fromDate: from, toDate: to })).body.data;

    expect((await agent().patch(`/api/v1/teacher-leaves/${leave._id}/cancel`).set(b.tok)).status).toBe(404);

    await agent().patch(`/api/v1/teacher-leaves/${leave._id}/decision`).set(h).send({ status: 'approved' });
    const sheet = (await agent().get(`/api/v1/teacher-attendance/sheet?date=${from}`).set(h)).body.data;
    expect(sheet.records.find((r: any) => r.name === 'Leave Sir')).toMatchObject({ status: 'leave', marked: false });
    expect((await agent().patch(`/api/v1/teacher-leaves/${leave._id}/cancel`).set(a.tok)).body.code).toBe('NOT_PENDING');

    const again = (await agent().post('/api/v1/teacher-leaves').set(b.tok).send({ type: 'sick', fromDate: from, toDate: to })).body.data;
    const cancelled = await agent().patch(`/api/v1/teacher-leaves/${again._id}/cancel`).set(b.tok);
    expect(cancelled.body.data.status).toBe('cancelled');
  });
});
