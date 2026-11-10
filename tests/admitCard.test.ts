import { beforeAll, describe, expect, it } from 'vitest';
import { AdmitCardConfig } from '../src/app/modules/admitCard/admitCard.model';
import { agent, registerTenant } from './helpers/api';
import { generate, pay } from './helpers/fees';
import { setupExam } from './helpers/exams';
import { useTestDb } from './helpers/db';

useTestDb();

beforeAll(async () => {
  await AdmitCardConfig.init();
});

const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const c: Buffer[] = [];
  res.on('data', (d: Buffer) => c.push(d));
  res.on('end', () => cb(null, Buffer.concat(c)));
};

/** Exam setup with three students who each owe 1000 Tk (past due), except the second, who has paid. */
const setup = async () => {
  const t = await registerTenant();
  const x = await setupExam(t);
  const heads = (await agent().get('/api/v1/fee-heads').set(x.h)).body.data;
  const tuition = heads.find((h: any) => h.code === 'TUITION');
  await agent()
    .post('/api/v1/fee-structures')
    .set(x.h)
    .send({ sessionId: x.session._id, classId: x.cls._id, items: [{ feeHeadId: tuition._id, amount: 100000, cycle: 'monthly', dueDay: 10 }] });
  await generate(x.h, x);
  await pay(x.h, { studentId: x.kids[1]._id, amount: 100000 });
  const q = `examId=${x.exam._id}&sectionId=${x.sections[0]._id}`;
  const schedule = (subjectId: string, date: string) =>
    agent().put('/api/v1/exam-routines/entry').set(x.h).send({ examId: x.exam._id, classId: x.cls._id, subjectId, date, startTime: '10:00', endTime: '12:00', room: 'Hall 1' });
  return { t, x, q, schedule };
};

describe('admit cards', () => {
  it('saves settings with validation', async () => {
    const t = await registerTenant();
    const h = { Authorization: `Bearer ${t.token}` };
    expect((await agent().get('/api/v1/admit-cards/config').set(h)).body.data).toEqual({ signatureTitle: 'Principal', instructions: '', blockIfDue: false, maxDueAllowed: 0 });
    const body = { signatureTitle: 'Controller', instructions: 'Bring this card and a pen.', blockIfDue: true, maxDueAllowed: 50000 };
    expect((await agent().put('/api/v1/admit-cards/config').set(h).send(body)).status).toBe(200);
    expect((await agent().get('/api/v1/admit-cards/config').set(h)).body.data).toEqual(body);
    expect((await agent().put('/api/v1/admit-cards/config').set(h).send({ ...body, maxDueAllowed: -1 })).status).toBe(400);
  });

  it('flags students with overdue fees only when the school blocks them', async () => {
    const { x, q } = await setup();
    const open = (await agent().get(`/api/v1/admit-cards/eligibility?${q}`).set(x.h)).body.data;
    expect(open.rows).toHaveLength(3);
    expect(open.rows.some((r: any) => r.blocked)).toBe(false);
    expect(open.rows.find((r: any) => r.name === 'Anik').overdue).toBe(100000);
    expect(open.rows.find((r: any) => r.name === 'Babu').overdue).toBe(0);

    await agent().put('/api/v1/admit-cards/config').set(x.h).send({ signatureTitle: 'Principal', instructions: '', blockIfDue: true, maxDueAllowed: 0 });
    const blocked = (await agent().get(`/api/v1/admit-cards/eligibility?${q}`).set(x.h)).body.data;
    expect(blocked.rows.filter((r: any) => r.blocked).map((r: any) => r.name).sort()).toEqual(['Anik', 'Chandra']);

    await agent().put('/api/v1/admit-cards/config').set(x.h).send({ signatureTitle: 'Principal', instructions: '', blockIfDue: true, maxDueAllowed: 100000 });
    const tolerated = (await agent().get(`/api/v1/admit-cards/eligibility?${q}`).set(x.h)).body.data;
    expect(tolerated.rows.some((r: any) => r.blocked)).toBe(false);
  });

  it('prints cards, skipping blocked students unless told otherwise', async () => {
    const { x, q, schedule } = await setup();
    const get = (qs: string) => agent().get(`/api/v1/admit-cards/students.pdf?${qs}`).set(x.h).buffer(true).parse(binary);

    expect((await get(q)).status).toBe(400);
    expect((await agent().get(`/api/v1/admit-cards/students.pdf?${q}`).set(x.h)).body.code).toBe('NO_ROUTINE');

    await schedule(x.bangla._id, '2026-12-01');
    await schedule(x.math._id, '2026-12-02');
    await agent().put('/api/v1/admit-cards/config').set(x.h).send({ signatureTitle: 'Principal', instructions: 'Bring a pen', blockIfDue: true, maxDueAllowed: 0 });

    const some = await get(q);
    expect(some.status).toBe(200);
    expect(some.headers['x-card-count']).toBe('1');
    expect(some.headers['x-blocked-count']).toBe('2');
    expect((some.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const all = await get(`${q}&includeBlocked=true&locale=en`);
    expect(all.headers['x-card-count']).toBe('3');
    expect(all.headers['x-blocked-count']).toBe('0');

    const none = await agent().get(`/api/v1/admit-cards/students.pdf?examId=${x.exam._id}&studentIds=${x.kids[0]._id}`).set(x.h);
    expect(none.body.code).toBe('ALL_BLOCKED');
  });

  it('rejects missing targets, other classes and non-admins', async () => {
    const { x, q } = await setup();
    expect((await agent().get(`/api/v1/admit-cards/eligibility?examId=${x.exam._id}`).set(x.h)).status).toBe(400);
    expect((await agent().get(`/api/v1/admit-cards/eligibility?examId=64b000000000000000000001&sectionId=${x.sections[0]._id}`).set(x.h)).status).toBe(404);

    const other = (await agent().post('/api/v1/classes').set(x.h).send({ name: 'Class 6', order: 6 })).body.data;
    const sec = (await agent().post('/api/v1/sections').set(x.h).send({ classId: other._id, name: 'A' })).body.data;
    await agent().post('/api/v1/students').set(x.h).send({ name: 'Other Kid', gender: 'male', dob: '2013-01-01', enrolment: { classId: other._id, sectionId: sec._id }, guardians: [] });
    const wrong = await agent().get(`/api/v1/admit-cards/eligibility?examId=${x.exam._id}&sectionId=${sec._id}`).set(x.h);
    expect(wrong.body.code).toBe('CLASS_NOT_IN_EXAM');

    expect((await agent().get(`/api/v1/admit-cards/eligibility?${q}`).set(x.banglaTok)).status).toBe(403);
  });
});
