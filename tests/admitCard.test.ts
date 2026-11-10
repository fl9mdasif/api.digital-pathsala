import { beforeAll, describe, expect, it } from 'vitest';
import { AdmitCardConfig, AdmitLockRule, DEFAULT_ADMIT_CARD_CONFIG } from '../src/app/modules/admitCard/admitCard.model';
import { agent, authed, login, registerTenant } from './helpers/api';
import { generate, pay } from './helpers/fees';
import { setupExam } from './helpers/exams';
import { useTestDb } from './helpers/db';

useTestDb();

beforeAll(async () => {
  await Promise.all([AdmitCardConfig.init(), AdmitLockRule.init()]);
});

const cfgBody = (over: Record<string, unknown> = {}) => ({ ...DEFAULT_ADMIT_CARD_CONFIG, ...over });

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
    expect((await agent().get('/api/v1/admit-cards/config').set(h)).body.data).toMatchObject({ signatureTitle: 'Principal', instructions: '', blockIfDue: false, maxDueAllowed: 0, design: 'modern', perPage: 1 });
    const body = cfgBody({ signatureTitle: 'Controller', instructions: 'Bring this card and a pen.', blockIfDue: true, maxDueAllowed: 50000, design: 'classic', perPage: 3, show: { ...DEFAULT_ADMIT_CARD_CONFIG.show, qr: true, sigAccounts: true } });
    expect((await agent().put('/api/v1/admit-cards/config').set(h).send(body)).status).toBe(200);
    expect((await agent().get('/api/v1/admit-cards/config').set(h)).body.data).toEqual(body);
    expect((await agent().put('/api/v1/admit-cards/config').set(h).send({ ...body, maxDueAllowed: -1 })).status).toBe(400);
    expect((await agent().put('/api/v1/admit-cards/config').set(h).send({ ...body, design: 'neon' })).status).toBe(400);
    expect((await agent().put('/api/v1/admit-cards/config').set(h).send({ ...body, perPage: 4 })).status).toBe(400);
    expect((await agent().put('/api/v1/admit-cards/config').set(h).send({ ...body, themeColor: 'red' })).status).toBe(400);
  });

  it('flags students with overdue fees only when the school blocks them', async () => {
    const { x, q } = await setup();
    const open = (await agent().get(`/api/v1/admit-cards/eligibility?${q}`).set(x.h)).body.data;
    expect(open.rows).toHaveLength(3);
    expect(open.rows.some((r: any) => r.blocked)).toBe(false);
    expect(open.rows.find((r: any) => r.name === 'Anik').overdue).toBe(100000);
    expect(open.rows.find((r: any) => r.name === 'Babu').overdue).toBe(0);

    await agent().put('/api/v1/admit-cards/config').set(x.h).send(cfgBody({ blockIfDue: true, maxDueAllowed: 0 }));
    const blocked = (await agent().get(`/api/v1/admit-cards/eligibility?${q}`).set(x.h)).body.data;
    expect(blocked.rows.filter((r: any) => r.blocked).map((r: any) => r.name).sort()).toEqual(['Anik', 'Chandra']);

    await agent().put('/api/v1/admit-cards/config').set(x.h).send(cfgBody({ blockIfDue: true, maxDueAllowed: 100000 }));
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
    await agent().put('/api/v1/admit-cards/config').set(x.h).send(cfgBody({ instructions: 'Bring a pen', blockIfDue: true, maxDueAllowed: 0 }));

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
    const { x } = await setup();
    expect((await agent().get(`/api/v1/admit-cards/eligibility?examId=${x.exam._id}`).set(x.h)).status).toBe(400);
    expect((await agent().get(`/api/v1/admit-cards/eligibility?examId=64b000000000000000000001&sectionId=${x.sections[0]._id}`).set(x.h)).status).toBe(404);

    const other = (await agent().post('/api/v1/classes').set(x.h).send({ name: 'Class 6', order: 6 })).body.data;
    const sec = (await agent().post('/api/v1/sections').set(x.h).send({ classId: other._id, name: 'A' })).body.data;
    await agent().post('/api/v1/students').set(x.h).send({ name: 'Other Kid', gender: 'male', dob: '2013-01-01', enrolment: { classId: other._id, sectionId: sec._id }, guardians: [] });
    const wrong = await agent().get(`/api/v1/admit-cards/eligibility?examId=${x.exam._id}&sectionId=${sec._id}`).set(x.h);
    expect(wrong.body.code).toBe('CLASS_NOT_IN_EXAM');

    expect((await agent().get('/api/v1/admit-cards/config').set(x.banglaTok)).status).toBe(403);
  });

  it('prints every design and page layout, and the sample for the settings preview', async () => {
    const { x, q, schedule } = await setup();
    await schedule(x.bangla._id, '2026-12-01');
    await schedule(x.math._id, '2026-12-02');
    const get = (qs: string) => agent().get(`/api/v1/admit-cards/students.pdf?${qs}`).set(x.h).buffer(true).parse(binary);
    const pages = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;

    for (const design of ['modern', 'classic', 'idstyle', 'mono']) {
      const r = await get(`${q}&design=${design}&perPage=3&locale=en`);
      expect(r.status).toBe(200);
      expect((r.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    }
    expect(pages((await get(`${q}&perPage=1`)).body as Buffer)).toBe(3);
    expect(pages((await get(`${q}&perPage=3`)).body as Buffer)).toBe(1);

    const sample = await get('sample=true&design=classic');
    expect(sample.status).toBe(200);
    expect(sample.headers['x-card-count']).toBe('1');
  });

  it('lets each exam have its own lockdown rule, replacing the school default', async () => {
    const { x, q } = await setup();
    const h = x.h;
    const rows = (await agent().get('/api/v1/admit-cards/lock-rules').set(h)).body.data;
    expect(rows.find((r: any) => r.examId === x.exam._id).rule).toBeNull();

    // the school default is open, but this exam locks anyone owing more than 500 Tk
    const rule = { active: true, maxDueAllowed: 50000, feeHeadIds: [] as string[], adminCanPrint: true };
    expect((await agent().put(`/api/v1/admit-cards/lock-rules/${x.exam._id}`).set(h).send(rule)).status).toBe(200);
    const locked = (await agent().get(`/api/v1/admit-cards/eligibility?${q}`).set(h)).body.data;
    expect(locked).toMatchObject({ blockIfDue: true, source: 'rule', adminCanPrint: true });
    expect(locked.rows.filter((r: any) => r.blocked)).toHaveLength(2);

    // an inactive rule switches the lockdown off even if the school default is on
    await agent().put('/api/v1/admit-cards/config').set(h).send(cfgBody({ blockIfDue: true }));
    await agent().put(`/api/v1/admit-cards/lock-rules/${x.exam._id}`).set(h).send({ ...rule, active: false });
    expect((await agent().get(`/api/v1/admit-cards/eligibility?${q}`).set(h)).body.data.rows.some((r: any) => r.blocked)).toBe(false);

    // a rule limited to a fee head that has no invoices blocks nobody
    const heads = (await agent().get('/api/v1/fee-heads').set(h)).body.data;
    const other = heads.find((f: any) => f.code !== 'TUITION');
    await agent().put(`/api/v1/admit-cards/lock-rules/${x.exam._id}`).set(h).send({ ...rule, maxDueAllowed: 0, feeHeadIds: [other._id] });
    expect((await agent().get(`/api/v1/admit-cards/eligibility?${q}`).set(h)).body.data.rows.some((r: any) => r.blocked)).toBe(false);

    expect((await agent().delete(`/api/v1/admit-cards/lock-rules/${x.exam._id}`).set(h)).status).toBe(200);
    expect((await agent().delete(`/api/v1/admit-cards/lock-rules/${x.exam._id}`).set(h)).status).toBe(404);
    expect((await agent().put('/api/v1/admit-cards/lock-rules/64b000000000000000000001').set(h).send(rule)).status).toBe(404);
    expect((await agent().put(`/api/v1/admit-cards/lock-rules/${x.exam._id}`).set(h).send({ ...rule, maxDueAllowed: -5 })).status).toBe(400);
  });

  it('refuses the admin override when the exam rule forbids it', async () => {
    const { x, q, schedule } = await setup();
    await schedule(x.bangla._id, '2026-12-01');
    await agent().put(`/api/v1/admit-cards/lock-rules/${x.exam._id}`).set(x.h).send({ active: true, maxDueAllowed: 0, feeHeadIds: [], adminCanPrint: false });
    const res = await agent().get(`/api/v1/admit-cards/students.pdf?${q}&includeBlocked=true`).set(x.h);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('LOCKDOWN_NO_OVERRIDE');
  });

  it('gives a student their own admit card, and holds it while fees are overdue', async () => {
    const { t, x, schedule } = await setup();
    await schedule(x.bangla._id, '2026-12-01');
    await agent().put(`/api/v1/admit-cards/lock-rules/${x.exam._id}`).set(x.h).send({ active: true, maxDueAllowed: 0, feeHeadIds: [], adminCanPrint: true });
    await agent().patch(`/api/v1/exams/${x.exam._id}/status`).set(x.h).send({ status: "marks_open" });

    const mk = async (kid: any) => {
      const made = (await agent().post(`/api/v1/students/${kid._id}/create-login`).set(x.h).send({})).body.data;
      const token = (await login(t.slug, made.student.loginId, made.student.temporaryPassword)).body.data.accessToken;
      return authed(token);
    };
    const anik = await mk(x.kids[0]); // owes
    const babu = await mk(x.kids[1]); // paid

    const mineAnik = (await agent().get('/api/v1/me/admit-cards').set(anik)).body.data;
    expect(mineAnik).toHaveLength(1);
    expect(mineAnik[0]).toMatchObject({ examId: x.exam._id, ready: true, blocked: true, overdue: 100000 });
    const mineBabu = (await agent().get('/api/v1/me/admit-cards').set(babu)).body.data;
    expect(mineBabu[0]).toMatchObject({ blocked: false, overdue: 0 });

    const url = (kid: any) => `/api/v1/me/admit-cards/${x.exam._id}/${kid._id}.pdf`;
    const held = await agent().get(url(x.kids[0])).set(anik);
    expect(held.status).toBe(403);
    expect(held.body.code).toBe('ADMIT_BLOCKED');

    const ok = await agent().get(url(x.kids[1])).set(babu).buffer(true).parse(binary);
    expect(ok.status).toBe(200);
    expect((ok.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    // never someone else's card, and never from a staff login
    expect((await agent().get(url(x.kids[0])).set(babu)).status).toBe(403);
    expect((await agent().get('/api/v1/me/admit-cards').set(x.h)).status).toBe(403);
  });
});
