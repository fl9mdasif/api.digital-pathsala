import { describe, expect, it } from 'vitest';
import { agent, authed, login, registerTenant } from './helpers/api';
import { newStudent } from './helpers/academic';
import { setupExam } from './helpers/exams';
import { useTestDb } from './helpers/db';

useTestDb();

/** Class 5 / section A (taught by the Bangla and Math teachers), plus Class 6 / section A that nobody teaches, and an unrelated teacher. */
const setup = async () => {
  const t = await registerTenant();
  const x = await setupExam(t);
  const other = (await agent().post('/api/v1/classes').set(x.h).send({ name: 'Class 6', order: 6 })).body.data;
  const otherSec = (await agent().post('/api/v1/sections').set(x.h).send({ classId: other._id, name: 'A' })).body.data;
  const stranger = (await agent().post('/api/v1/students').set(x.h).send(newStudent(other._id, otherSec._id, { name: 'Stranger', guardians: [] }))).body.data;
  await agent().post('/api/v1/users').set(x.h).send({ role: 'teacher', name: 'Idle Teacher', email: 'idle@example.com', password: 'Teacher#12345' });
  const idle = authed((await login(t.slug, 'idle@example.com', 'Teacher#12345')).body.data.accessToken);
  return { x, mine: `sectionId=${x.sections[0]._id}`, theirs: `sectionId=${otherSec._id}`, stranger, idle };
};

describe('teachers print for their own classes only', () => {
  it('student ID cards', async () => {
    const { x, mine, theirs, stranger, idle } = await setup();
    const get = (qs: string, tok: Record<string, string>) => agent().get(`/api/v1/id-cards/students.pdf?${qs}`).set(tok);
    expect((await get(mine, x.banglaTok)).status).toBe(200);
    expect((await get(`studentIds=${x.kids[0]._id}`, x.mathTok)).status).toBe(200);
    expect((await get(theirs, x.banglaTok)).status).toBe(403);
    expect((await get(`studentIds=${stranger._id}`, x.banglaTok)).status).toBe(403);
    expect((await get(`studentIds=${x.kids[0]._id},${stranger._id}`, x.banglaTok)).status).toBe(403);
    expect((await get(mine, idle)).status).toBe(403);
    expect((await get('sample=true', x.banglaTok)).status).toBe(403);
    expect((await get('', x.banglaTok)).status).toBe(403);
    expect((await get('sectionId=nope', x.banglaTok)).status).toBe(400);
    expect((await get(theirs, x.h)).status).toBe(200); // admins still print anything
  });

  it('exam seat plans', async () => {
    const { x, mine, theirs, idle } = await setup();
    const exam = `examId=${x.exam._id}`;
    expect((await agent().get(`/api/v1/seat-plans/assign?${exam}&${mine}`).set(x.banglaTok)).status).toBe(200);
    expect((await agent().get(`/api/v1/seat-plans/students.pdf?${exam}&${mine}`).set(x.banglaTok)).status).toBe(200);
    expect((await agent().get(`/api/v1/seat-plans/assign?${exam}&${theirs}`).set(x.banglaTok)).status).toBe(403);
    expect((await agent().get(`/api/v1/seat-plans/assign?${exam}&${mine}`).set(idle)).status).toBe(403);
  });

  it('admit cards: eligibility and print for their class, but never settings, rules or a fee override', async () => {
    const { x, mine, theirs, idle } = await setup();
    const exam = `examId=${x.exam._id}`;
    await agent().put(`/api/v1/exam-routines/entry`).set(x.h).send({ examId: x.exam._id, classId: x.cls._id, subjectId: x.bangla._id, date: '2026-12-01', startTime: '10:00', endTime: '12:00' });
    expect((await agent().get(`/api/v1/admit-cards/eligibility?${exam}&${mine}`).set(x.banglaTok)).status).toBe(200);
    expect((await agent().get(`/api/v1/admit-cards/students.pdf?${exam}&${mine}`).set(x.banglaTok)).status).toBe(200);
    expect((await agent().get(`/api/v1/admit-cards/students.pdf?${exam}&${mine}&includeBlocked=true`).set(x.banglaTok)).status).toBe(403);
    expect((await agent().get(`/api/v1/admit-cards/eligibility?${exam}&${theirs}`).set(x.banglaTok)).status).toBe(403);
    expect((await agent().get(`/api/v1/admit-cards/eligibility?${exam}&${mine}`).set(idle)).status).toBe(403);

    expect((await agent().get('/api/v1/admit-cards/config').set(x.banglaTok)).status).toBe(403);
    expect((await agent().get('/api/v1/admit-cards/lock-rules').set(x.banglaTok)).status).toBe(403);
    expect((await agent().put(`/api/v1/admit-cards/lock-rules/${x.exam._id}`).set(x.banglaTok).send({ active: false, maxDueAllowed: 0, feeHeadIds: [], adminCanPrint: true })).status).toBe(403);
  });

  it('keeps settings and other accessories admin only', async () => {
    const { x } = await setup();
    expect((await agent().get('/api/v1/id-cards/config').set(x.banglaTok)).status).toBe(403);
    expect((await agent().get('/api/v1/teacher-id-cards/config').set(x.banglaTok)).status).toBe(403);
    expect((await agent().get('/api/v1/testimonials').set(x.banglaTok)).status).toBe(403);
  });
});
