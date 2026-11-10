import { describe, expect, it } from 'vitest';
import { agent, authed, login, registerTenant } from './helpers/api';
import { banglaMarks, mathMarks, setupExam } from './helpers/exams';
import { useTestDb } from './helpers/db';

useTestDb();

const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const c: Buffer[] = [];
  res.on('data', (d: Buffer) => c.push(d));
  res.on('end', () => cb(null, Buffer.concat(c)));
};

/** Anik 175, Babu 135, Chandra fails Math (same data as the results lifecycle tests). */
const calculated = async () => {
  const t = await registerTenant();
  const ex = await setupExam(t);
  const put = (tok: Record<string, string>, subjectId: string, marks: unknown[]) =>
    agent().put(`/api/v1/exams/${ex.exam._id}/marks`).set(tok).send({ classId: ex.cls._id, sectionId: ex.sections[0]._id, subjectId, marks });
  await agent().patch(`/api/v1/exams/${ex.exam._id}/status`).set(ex.h).send({ status: 'marks_open' });
  await put(ex.banglaTok, ex.bangla._id, banglaMarks(ex.kids, [[60, 25], [50, 15], [28, 12]]));
  await put(ex.mathTok, ex.math._id, mathMarks(ex.kids, [90, 70, 30]));
  for (const [tok, id] of [[ex.banglaTok, ex.bangla._id], [ex.mathTok, ex.math._id]] as const)
    await agent().post(`/api/v1/exams/${ex.exam._id}/marks/submit`).set(tok).send({ classId: ex.cls._id, sectionId: ex.sections[0]._id, subjectId: id });
  await agent().patch(`/api/v1/exams/${ex.exam._id}/status`).set(ex.h).send({ status: 'marks_closed' });
  await agent().post(`/api/v1/exams/${ex.exam._id}/calculate`).set(ex.h);
  return ex;
};

describe('result reports', () => {
  it('lists failed students with the papers they failed', async () => {
    const ex = await calculated();
    const res = (await agent().get(`/api/v1/exams/${ex.exam._id}/fail-list?classId=${ex.cls._id}`).set(ex.h)).body.data;
    expect(res.summary).toEqual({ students: 3, failed: 1, failRate: 33.33 });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ name: 'Chandra', className: 'Class 5', sectionName: 'A', totalMarks: 70, gpa: 0 });
    expect(res.rows[0].failedSubjects.map((s: any) => s.name)).toEqual(['Math']);
  });

  it('builds a tabulation sheet with a column per subject, in merit order', async () => {
    const ex = await calculated();
    const tab = (await agent().get(`/api/v1/exams/${ex.exam._id}/tabulation?classId=${ex.cls._id}&sectionId=${ex.sections[0]._id}`).set(ex.h)).body.data;
    expect(tab.subjects.map((s: any) => s.name).sort()).toEqual(['Bangla', 'Math']);
    expect(tab.rows.map((r: any) => [r.position, r.name])).toEqual([[1, 'Anik'], [2, 'Babu'], [3, 'Chandra']]);
    const anik = tab.rows[0];
    expect(anik).toMatchObject({ totalMarks: 175, gpa: 5, letter: 'A+', passed: true });
    expect(anik.marks[ex.math._id]).toMatchObject({ total: 90, passed: true });
    expect(tab.rows[2].marks[ex.math._id]).toMatchObject({ total: 30, passed: false });
    expect(tab.section).toEqual({ name: 'A' });
  });

  it('prints the tabulation sheet as a landscape PDF', async () => {
    const ex = await calculated();
    const pdf = await agent().get(`/api/v1/exams/${ex.exam._id}/tabulation.pdf?classId=${ex.cls._id}&locale=bn`).set(ex.h).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const buf = pdf.body as Buffer;
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.toString('latin1')).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/);
  });

  it('needs calculated results and the right role', async () => {
    const t = await registerTenant();
    const ex = await setupExam(t);
    expect((await agent().get(`/api/v1/exams/${ex.exam._id}/tabulation?classId=${ex.cls._id}`).set(ex.h)).body.code).toBe('NO_RESULTS');
    expect((await agent().get(`/api/v1/exams/${ex.exam._id}/fail-list`).set(ex.h)).body.data.rows).toEqual([]);

    await agent().post('/api/v1/users').set(ex.h).send({ role: 'accountant', name: 'Acc', email: 'acc2@example.com', password: 'Account#12345' });
    const accTok = authed((await login(t.slug, 'acc2@example.com', 'Account#12345')).body.data.accessToken);
    expect((await agent().get(`/api/v1/exams/${ex.exam._id}/fail-list`).set(accTok)).status).toBe(403);
    expect((await agent().get(`/api/v1/exams/${ex.exam._id}/fail-list`).set(ex.banglaTok)).status).toBe(200);
  });
});
