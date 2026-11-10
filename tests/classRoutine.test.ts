import { beforeAll, describe, expect, it } from 'vitest';
import { ClassRoutineSlot } from '../src/app/modules/classRoutine/classRoutine.model';
import { RoutinePeriod } from '../src/app/modules/routinePeriod/routinePeriod.model';
import { agent, authed, login, registerTenant } from './helpers/api';
import { setupAcademic } from './helpers/academic';
import { useTestDb } from './helpers/db';

useTestDb();

beforeAll(async () => {
  await Promise.all([RoutinePeriod.init(), ClassRoutineSlot.init()]);
});

const setup = async () => {
  const t = await registerTenant();
  const h = authed(t.token);
  const { cls, sections } = await setupAcademic(t);
  const mkTeacher = async (email: string, name: string) =>
    (await agent().post('/api/v1/users').set(h).send({ role: 'teacher', name, email, password: 'Teacher#12345' })).body
      .data.user;
  const mkSubject = async (name: string) => (await agent().post('/api/v1/subjects').set(h).send({ name })).body.data;
  const mkPeriod = async (body: object) => agent().post('/api/v1/routine-periods').set(h).send(body);
  return { t, h, cls, sections, mkTeacher, mkSubject, mkPeriod };
};

describe('class routine', () => {
  it('manages periods without overlaps and blocks deleting a period that is in use', async () => {
    const { h, sections, mkPeriod, mkSubject } = await setup();
    const p1 = (await mkPeriod({ name: '1st', startTime: '09:00', endTime: '09:45', order: 1 })).body.data;
    expect((await mkPeriod({ name: '2nd', startTime: '09:45', endTime: '10:30', order: 2 })).status).toBe(201);
    expect((await mkPeriod({ name: 'Clash', startTime: '09:30', endTime: '10:00', order: 3 })).body.code).toBe('PERIOD_OVERLAP');
    expect((await mkPeriod({ name: 'Backwards', startTime: '11:00', endTime: '10:00', order: 4 })).status).toBe(400);

    const bad = await agent().patch(`/api/v1/routine-periods/${p1._id}`).set(h).send({ endTime: '09:50' });
    expect(bad.body.code).toBe('PERIOD_OVERLAP');

    const math = await mkSubject('Math');
    await agent()
      .put('/api/v1/class-routines/slot')
      .set(h)
      .send({ sectionId: sections[0]._id, day: 0, periodId: p1._id, subjectId: math._id });
    expect((await agent().delete(`/api/v1/routine-periods/${p1._id}`).set(h)).body.code).toBe('IN_USE');
  });

  it('builds a section routine, replaces a slot and removes it', async () => {
    const { h, sections, mkPeriod, mkSubject, mkTeacher } = await setup();
    const p = (await mkPeriod({ name: '1st', startTime: '09:00', endTime: '09:45', order: 1 })).body.data;
    const brk = (await mkPeriod({ name: 'Tiffin', startTime: '09:45', endTime: '10:00', order: 2, isBreak: true })).body.data;
    const math = await mkSubject('Math');
    const eng = await mkSubject('English');
    const sir = await mkTeacher('r1@example.com', 'Routine Sir');
    const slot = (body: object) => agent().put('/api/v1/class-routines/slot').set(h).send({ sectionId: sections[0]._id, ...body });

    const first = await slot({ day: 0, periodId: p._id, subjectId: math._id, teacherId: sir.id, room: '101' });
    expect(first.status).toBe(200);
    await slot({ day: 0, periodId: p._id, subjectId: eng._id });
    expect((await slot({ day: 0, periodId: brk._id, subjectId: math._id })).body.code).toBe('BREAK_PERIOD');

    const grid = (await agent().get(`/api/v1/class-routines?sectionId=${sections[0]._id}`).set(h)).body.data;
    expect(grid.periods.map((x: any) => x.name)).toEqual(['1st', 'Tiffin']);
    expect(grid.slots).toHaveLength(1);
    expect(grid.slots[0]).toMatchObject({ day: 0, subject: { name: 'English' }, teacher: null });

    const del = await agent().delete(`/api/v1/class-routines/slot?sectionId=${sections[0]._id}&day=0&periodId=${p._id}`).set(h);
    expect(del.body.data.deleted).toBe(true);
    expect((await agent().delete(`/api/v1/class-routines/slot?sectionId=${sections[0]._id}&day=0&periodId=${p._id}`).set(h)).status).toBe(404);
  });

  it('stops one teacher being booked in two sections at the same time and shows their own timetable', async () => {
    const { t, h, sections, mkPeriod, mkSubject, mkTeacher } = await setup();
    const p = (await mkPeriod({ name: '1st', startTime: '09:00', endTime: '09:45', order: 1 })).body.data;
    const math = await mkSubject('Math');
    const sir = await mkTeacher('r2@example.com', 'Busy Sir');
    const put = (sectionId: string, day: number) =>
      agent().put('/api/v1/class-routines/slot').set(h).send({ sectionId, day, periodId: p._id, subjectId: math._id, teacherId: sir.id });

    expect((await put(sections[0]._id, 1)).status).toBe(200);
    const clash = await put(sections[1]._id, 1);
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('TEACHER_CONFLICT');
    expect((await put(sections[1]._id, 2)).status).toBe(200);

    const accountant = (
      await agent()
        .post('/api/v1/users')
        .set(h)
        .send({ role: 'accountant', name: 'Acc One', email: 'acc@example.com', password: 'Account#12345' })
    ).body.data.user;
    const notTeacher = await agent()
      .put('/api/v1/class-routines/slot')
      .set(h)
      .send({ sectionId: sections[0]._id, day: 3, periodId: p._id, subjectId: math._id, teacherId: accountant.id });
    expect(notTeacher.body.code).toBe('INVALID_TEACHER');

    const tTok = authed((await login(t.slug, 'r2@example.com', 'Teacher#12345')).body.data.accessToken);
    const mine = (await agent().get('/api/v1/class-routines/me').set(tTok)).body.data;
    expect(mine.slots.map((s: any) => s.day).sort()).toEqual([1, 2]);
    expect(mine.slots[0].class.name).toBe('Class 5');
    expect((await agent().put('/api/v1/class-routines/slot').set(tTok).send({ sectionId: sections[0]._id, day: 4, periodId: p._id, subjectId: math._id })).status).toBe(403);
    expect((await agent().get('/api/v1/class-routines/me').set(h)).status).toBe(403);
  });
});
