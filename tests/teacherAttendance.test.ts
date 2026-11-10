import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, dayOfWeek, todayLocal } from '../src/app/lib/localDate';
import { Employee } from '../src/app/modules/employee/employee.model';
import { TeacherAttendance, TeacherAttendanceConfig } from '../src/app/modules/teacherAttendance/teacherAttendance.model';
import { agent, authed, login, registerTenant } from './helpers/api';
import { useTestDb } from './helpers/db';

useTestDb();

beforeAll(async () => {
  await Promise.all([Employee.init(), TeacherAttendance.init(), TeacherAttendanceConfig.init()]);
});

/** A past date that is not a Friday (the default weekend). */
const workday = (back: number) => {
  let d = addDays(todayLocal(), -back);
  while (dayOfWeek(d) === 5) d = addDays(d, -1);
  return d;
};
const friday = () => {
  let d = addDays(todayLocal(), -1);
  while (dayOfWeek(d) !== 5) d = addDays(d, -1);
  return d;
};

const makeStaff = async (h: Record<string, string>, email: string, name: string) => {
  const user = (
    await agent().post('/api/v1/users').set(h).send({ role: 'teacher', name, email, password: 'Teacher#12345' })
  ).body.data.user;
  const emp = (await agent().post('/api/v1/employees').set(h).send({ userId: user.id })).body.data;
  return { user, emp };
};

describe('teacher attendance', () => {
  it('saves and returns the in/out time setup', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    const cfg = await agent().get('/api/v1/teacher-attendance/config').set(h);
    expect(cfg.body.data).toEqual({ inTime: '09:00', outTime: '15:00', graceMinutes: 10 });

    const bad = await agent()
      .put('/api/v1/teacher-attendance/config')
      .set(h)
      .send({ inTime: '10:00', outTime: '09:00', graceMinutes: 5 });
    expect(bad.status).toBe(400);

    await agent().put('/api/v1/teacher-attendance/config').set(h).send({ inTime: '08:30', outTime: '14:00', graceMinutes: 5 });
    const after = await agent().get('/api/v1/teacher-attendance/config').set(h);
    expect(after.body.data).toEqual({ inTime: '08:30', outTime: '14:00', graceMinutes: 5 });
  });

  it('takes, edits and reads a daily sheet, marking late arrivals automatically', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    const a = await makeStaff(h, 'ta1@example.com', 'Alpha Sir');
    const b = await makeStaff(h, 'ta2@example.com', 'Beta Madam');
    const date = workday(2);

    const empty = (await agent().get(`/api/v1/teacher-attendance/sheet?date=${date}`).set(h)).body.data;
    expect(empty.taken).toBe(false);
    expect(empty.records).toHaveLength(2);
    expect(empty.records.every((r: any) => r.status === 'present' && !r.marked)).toBe(true);

    const submit = await agent()
      .post('/api/v1/teacher-attendance')
      .set(h)
      .send({
        date,
        records: [
          { employeeId: a.emp._id, status: 'present', checkIn: '09:30' },
          { employeeId: b.emp._id, status: 'present', checkIn: '09:05' },
        ],
      });
    expect(submit.status).toBe(200);

    const sheet = (await agent().get(`/api/v1/teacher-attendance/sheet?date=${date}`).set(h)).body.data;
    const byName = Object.fromEntries(sheet.records.map((r: any) => [r.name, r.status]));
    expect(sheet.taken).toBe(true);
    expect(byName).toEqual({ 'Alpha Sir': 'late', 'Beta Madam': 'present' });

    await agent()
      .post('/api/v1/teacher-attendance')
      .set(h)
      .send({ date, records: [{ employeeId: b.emp._id, status: 'absent', note: 'sick' }] });
    const edited = (await agent().get(`/api/v1/teacher-attendance/sheet?date=${date}`).set(h)).body.data;
    const beta = edited.records.find((r: any) => r.name === 'Beta Madam');
    expect(beta).toMatchObject({ status: 'absent', note: 'sick', marked: true });
    expect(await (TeacherAttendance.countDocuments({ date }) as any).unscoped()).toBe(2);
  });

  it('rejects future dates, weekends, duplicates and employees who have left', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    const a = await makeStaff(h, 'tb1@example.com', 'Gamma Sir');
    const gone = await makeStaff(h, 'tb2@example.com', 'Delta Sir');
    await agent().patch(`/api/v1/employees/${gone.emp._id}`).set(h).send({ employmentStatus: 'resigned' });
    const rec = (employeeId: string) => ({ employeeId, status: 'present' });
    const post = (body: object) => agent().post('/api/v1/teacher-attendance').set(h).send(body);

    expect((await post({ date: addDays(todayLocal(), 3), records: [rec(a.emp._id)] })).status).toBe(400);

    const fri = friday();
    const weekend = await post({ date: fri, records: [rec(a.emp._id)] });
    expect(weekend.body.code).toBe('WEEKEND_DATE');
    expect((await post({ date: fri, records: [rec(a.emp._id)], allowWeekend: true })).status).toBe(200);

    const date = workday(3);
    expect((await post({ date, records: [rec(a.emp._id), rec(a.emp._id)] })).body.code).toBe('DUPLICATE_EMPLOYEE');
    expect((await post({ date, records: [rec(gone.emp._id)] })).body.code).toBe('NOT_EMPLOYED');

    const sheet = (await agent().get(`/api/v1/teacher-attendance/sheet?date=${date}`).set(h)).body.data;
    expect(sheet.records.map((r: any) => r.name)).toEqual(['Gamma Sir']);
  });

  it('reports totals per teacher and lets a teacher see only their own record', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    const a = await makeStaff(h, 'tc1@example.com', 'Sigma Sir');
    const b = await makeStaff(h, 'tc2@example.com', 'Omega Sir');
    const days = [workday(2), workday(3), workday(4)];
    const status = ['present', 'absent', 'leave'] as const;
    for (const [i, date] of days.entries()) {
      await agent()
        .post('/api/v1/teacher-attendance')
        .set(h)
        .send({
          date,
          records: [
            { employeeId: a.emp._id, status: status[i] },
            { employeeId: b.emp._id, status: 'present' },
          ],
        });
    }
    const from = days[days.length - 1];
    const to = days[0];
    const rep = (await agent().get(`/api/v1/teacher-attendance/report?from=${from}&to=${to}`).set(h)).body.data;
    const sigma = rep.rows.find((r: any) => r.name === 'Sigma Sir');
    expect(sigma).toMatchObject({ present: 1, absent: 1, leave: 1, late: 0, percent: 50 });
    expect(rep.rows.find((r: any) => r.name === 'Omega Sir').percent).toBe(100);

    const one = (
      await agent().get(`/api/v1/teacher-attendance/report?from=${from}&to=${to}&employeeId=${a.emp._id}`).set(h)
    ).body.data;
    expect(one.rows).toHaveLength(1);
    expect(Object.keys(one.rows[0].byDate)).toHaveLength(3);

    const tooLong = await agent().get(`/api/v1/teacher-attendance/report?from=2024-01-01&to=2026-01-01`).set(h);
    expect(tooLong.status).toBe(400);

    const tTok = authed((await login(t.slug, 'tc1@example.com', 'Teacher#12345')).body.data.accessToken);
    const mine = (await agent().get(`/api/v1/teacher-attendance/me?from=${from}&to=${to}`).set(tTok)).body.data;
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0].name).toBe('Sigma Sir');
    expect((await agent().get(`/api/v1/teacher-attendance/sheet?date=${to}`).set(tTok)).status).toBe(403);
    expect((await agent().get(`/api/v1/teacher-attendance/me?from=${from}&to=${to}`).set(h)).status).toBe(403);
  });
});
