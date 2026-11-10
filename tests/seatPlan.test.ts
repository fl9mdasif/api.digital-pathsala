import { describe, expect, it } from 'vitest';
import { assignSeats } from '../src/app/modules/seatPlan/seatPlan.service';
import { agent, authed, login, registerTenant } from './helpers/api';
import { setupExam } from './helpers/exams';
import { useTestDb } from './helpers/db';

useTestDb();

const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const c: Buffer[] = [];
  res.on('data', (d: Buffer) => c.push(d));
  res.on('end', () => cb(null, Buffer.concat(c)));
};
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;
const card = (roll: number, cls = 'Five', sec = 'A') => ({ studentObjectId: `s${roll}`, classId: 'c', name: `N${roll}`, studentId: `ID${roll}`, className: cls, sectionName: sec, roll }) as any;

describe('seat numbering', () => {
  const cards = [card(3), card(1), card(2), card(5), card(4)];

  it('numbers students in roll order from the start seat', () => {
    const rows = assignSeats(cards, { room: '', startSeat: 1 });
    expect(rows.map((r) => [r.roll, r.seat, r.room])).toEqual([[1, 1, ''], [2, 2, ''], [3, 3, ''], [4, 4, ''], [5, 5, '']]);
    expect(assignSeats(cards, { room: 'Hall', startSeat: 101 })[0]).toMatchObject({ seat: 101, room: 'Hall' });
  });

  it('splits students across numbered rooms, each starting its seats again', () => {
    const rows = assignSeats(cards, { room: 'Hall', seatsPerRoom: 2, startSeat: 1 });
    expect(rows.map((r) => `${r.room}#${r.seat}`)).toEqual(['Hall 1#1', 'Hall 1#2', 'Hall 2#1', 'Hall 2#2', 'Hall 3#1']);
    expect(assignSeats(cards, { room: '', seatsPerRoom: 3, startSeat: 1 })[3].room).toBe('Room 2');
  });

  it('keeps classes and sections together before roll order', () => {
    const rows = assignSeats([card(1, 'Six', 'A'), card(2, 'Five', 'B'), card(1, 'Five', 'A')], { room: '', startSeat: 1 });
    expect(rows.map((r) => `${r.className}${r.sectionName}${r.roll}`)).toEqual(['FiveA1', 'FiveB2', 'SixA1']);
  });
});

describe('seat plan endpoints', () => {
  const setup = async () => {
    const t = await registerTenant();
    const x = await setupExam(t); // class 5 / section A, 3 students, a draft exam
    return { t, x, q: `examId=${x.exam._id}&sectionId=${x.sections[0]._id}` };
  };

  it('returns the seat list for a section, with rooms when asked', async () => {
    const { x, q } = await setup();
    const one = (await agent().get(`/api/v1/seat-plans/assign?${q}`).set(x.h)).body.data;
    expect(one.rows).toHaveLength(3);
    expect(one.rows.map((r: any) => r.seat)).toEqual([1, 2, 3]);
    expect(one.exam.name).toBeTruthy();

    const rooms = (await agent().get(`/api/v1/seat-plans/assign?${q}&room=Hall&seatsPerRoom=2&startSeat=11`).set(x.h)).body.data.rows;
    expect(rooms.map((r: any) => `${r.room}#${r.seat}`)).toEqual(['Hall 1#11', 'Hall 1#12', 'Hall 2#11']);

    const chosen = (await agent().get(`/api/v1/seat-plans/assign?examId=${x.exam._id}&studentIds=${x.kids[0]._id},${x.kids[2]._id}`).set(x.h)).body.data.rows;
    expect(chosen).toHaveLength(2);
  });

  it('prints twelve cards to a page in every design', async () => {
    const { x, q } = await setup();
    const get = (qs: string) => agent().get(`/api/v1/seat-plans/students.pdf?${qs}`).set(x.h).buffer(true).parse(binary);
    for (const design of ['band', 'framed', 'mono']) {
      const r = await get(`${q}&design=${design}&color=%230f766e&locale=en&room=Hall&seatsPerRoom=2`);
      expect(r.status).toBe(200);
      expect(r.headers['x-card-count']).toBe('3');
      expect((r.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      expect(pages(r.body as Buffer)).toBe(1);
    }
    expect((await get(`${q}&photo=true`)).status).toBe(200);
  });

  it('starts a second page after twelve students', async () => {
    const { x, q } = await setup();
    for (let i = 0; i < 10; i++)
      await agent()
        .post('/api/v1/students')
        .set(x.h)
        .send({ name: `Extra ${i}`, gender: 'male', dob: '2013-01-01', enrolment: { classId: x.cls._id, sectionId: x.sections[0]._id }, guardians: [] });
    const r = await agent().get(`/api/v1/seat-plans/students.pdf?${q}`).set(x.h).buffer(true).parse(binary);
    expect(r.headers['x-card-count']).toBe('13');
    expect(pages(r.body as Buffer)).toBe(2);
  });

  it('rejects missing targets, bad input, unknown exams and non-admins', async () => {
    const { t, x, q } = await setup();
    const get = (qs: string) => agent().get(`/api/v1/seat-plans/assign?${qs}`).set(x.h);
    expect((await get(`examId=${x.exam._id}`)).status).toBe(400);
    expect((await get(`${q}&seatsPerRoom=0`)).status).toBe(400);
    expect((await get(`${q}&startSeat=-1`)).status).toBe(400);
    expect((await agent().get(`/api/v1/seat-plans/students.pdf?${q}&design=neon`).set(x.h)).status).toBe(400);
    expect((await agent().get(`/api/v1/seat-plans/students.pdf?${q}&color=red`).set(x.h)).status).toBe(400);
    expect((await get(`examId=64b000000000000000000001&sectionId=${x.sections[0]._id}`)).status).toBe(404);

    const other = (await agent().post('/api/v1/classes').set(x.h).send({ name: 'Class 6', order: 6 })).body.data;
    const sec = (await agent().post('/api/v1/sections').set(x.h).send({ classId: other._id, name: 'A' })).body.data;
    await agent().post('/api/v1/students').set(x.h).send({ name: 'Other Kid', gender: 'male', dob: '2013-01-01', enrolment: { classId: other._id, sectionId: sec._id }, guardians: [] });
    expect((await get(`examId=${x.exam._id}&sectionId=${sec._id}`)).body.code).toBe('CLASS_NOT_IN_EXAM');

    await agent().post('/api/v1/users').set(x.h).send({ role: 'teacher', name: 'Idle Teacher', email: 'idle@example.com', password: 'Teacher#12345' });
    const teacher = authed((await login(t.slug, 'idle@example.com', 'Teacher#12345')).body.data.accessToken);
    expect((await agent().get(`/api/v1/seat-plans/assign?${q}`).set(teacher)).status).toBe(403);
    expect((await agent().get(`/api/v1/seat-plans/assign?${q}`)).status).toBe(401);
  });
});
