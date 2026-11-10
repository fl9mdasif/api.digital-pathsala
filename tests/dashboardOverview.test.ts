import { describe, expect, it } from 'vitest';
import { todayLocal } from '../src/app/lib/localDate';
import { agent, authed, login, registerTenant } from './helpers/api';
import { newStudent, setupAcademic } from './helpers/academic';
import { generate, pay } from './helpers/fees';
import { useTestDb } from './helpers/db';

useTestDb();

describe('dashboard overview', () => {
  it('summarises people, birthdays, religion, blood groups, classes and collections', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    const { cls, sections, session } = await setupAcademic(t, { sections: ['A'] });
    const today = todayLocal();
    const mk = (name: string, extra: Record<string, unknown>) =>
      agent()
        .post('/api/v1/students')
        .set(h)
        .send(newStudent(cls._id, sections[0]._id, { name, guardians: [], ...extra }));
    const a = (await mk('Anik', { gender: 'male', religion: 'Muslim', bloodGroup: 'O+', dob: `2012-${today.slice(5)}` })).body.data;
    await mk('Mita', { gender: 'female', religion: 'Hindu', bloodGroup: 'A+' });
    await mk('Nobody', { gender: 'other' });

    const staff = (await agent().post('/api/v1/users').set(h).send({ role: 'teacher', name: 'Sir', email: 'sir@example.com', password: 'Teacher#12345' })).body.data.user;
    const des = (await agent().post('/api/v1/designations').set(h).send({ name: 'Headmaster' })).body.data;
    await agent()
      .post('/api/v1/employees')
      .set(h)
      .send({ userId: staff.id, designationId: des._id, gender: 'male', religion: 'Islam', bloodGroup: 'B+', dateOfBirth: `1980-${today.slice(5)}` });

    const heads = (await agent().get('/api/v1/fee-heads').set(h)).body.data;
    const tuition = heads.find((x: any) => x.code === 'TUITION');
    await agent().post('/api/v1/fee-structures').set(h).send({ sessionId: session._id, classId: cls._id, items: [{ feeHeadId: tuition._id, amount: 100000, cycle: 'monthly', dueDay: 10 }] });
    await generate(h, { session, cls });
    await pay(h, { studentId: a._id, amount: 100000 });

    const d = (await agent().get('/api/v1/dashboard/overview').set(h)).body.data;
    expect(d.date).toBe(today);
    expect(d.school.name).toBeTruthy();
    expect(d.totals).toMatchObject({ classes: 1, sections: 1 });
    expect(d.students).toEqual({ total: 3, male: 1, female: 1, other: 1 });
    // The school admin plus the teacher; the admin has no HR record, so counts under "other"
    expect(d.staff).toEqual({ total: 2, male: 1, female: 0, other: 1 });
    expect(d.birthdays).toMatchObject({ students: 1, staff: 1 });
    expect(d.birthdays.names.sort()).toEqual(['Anik', 'Sir']);

    const rel = Object.fromEntries(d.religion.map((r: any) => [r.key, r]));
    expect(rel.Islam).toMatchObject({ students: 1, staff: 1 });
    expect(rel.Hindu).toMatchObject({ students: 1, staff: 0 });
    expect(rel.none.students).toBe(1);
    const blood = Object.fromEntries(d.bloodGroups.map((b: any) => [b.key, b]));
    expect(blood['O+'].students).toBe(1);
    expect(blood['B+'].staff).toBe(1);
    expect(blood.none.students).toBe(1);

    expect(d.byClass).toEqual([{ name: 'Class 5', students: 3 }]);
    expect(d.byDesignation).toEqual([{ name: 'Headmaster', count: 1 }]);
    expect(d.collection).toEqual({ today: 100000, week: 100000, month: 100000, year: 100000 });
    expect(d.monthly).toHaveLength(12);
    expect(d.monthly[Number(today.slice(5, 7)) - 1]).toBe(100000);
  });

  it('is for admins only', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    await agent().post('/api/v1/users').set(h).send({ role: 'teacher', name: 'Sir', email: 'sir2@example.com', password: 'Teacher#12345' });
    const tTok = authed((await login(t.slug, 'sir2@example.com', 'Teacher#12345')).body.data.accessToken);
    expect((await agent().get('/api/v1/dashboard/overview').set(tTok)).status).toBe(403);
  });
});
