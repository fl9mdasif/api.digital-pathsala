import { beforeAll, describe, expect, it } from 'vitest';
import { Certificate, CertificateConfig, CERTIFICATE_LAYOUTS, DEFAULT_CERTIFICATE_CONFIG } from '../src/app/modules/certificate/certificate.model';
import { renderBody } from '../src/app/modules/certificate/certificate.service';
import { agent, authed, login, registerTenant } from './helpers/api';
import { banglaMarks, mathMarks, setupExam } from './helpers/exams';
import { useTestDb } from './helpers/db';

useTestDb();

beforeAll(async () => {
  await Promise.all([CertificateConfig.init(), Certificate.init()]);
});

const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const c: Buffer[] = [];
  res.on('data', (d: Buffer) => c.push(d));
  res.on('end', () => cb(null, Buffer.concat(c)));
};
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;
const cfgBody = (over: Record<string, unknown> = {}) => ({ ...DEFAULT_CERTIFICATE_CONFIG, ...over });

/** Three students in Class 5 sit a published exam; Anik and Babu are promoted, Chandra repeats. */
const completedYear = async () => {
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
  expect((await agent().post(`/api/v1/exams/${ex.exam._id}/publish`).set(ex.h).send({})).status).toBe(200);

  const cls6 = (await agent().post('/api/v1/classes').set(ex.h).send({ name: 'Class 6', order: 6 })).body.data;
  const next = (await agent().post('/api/v1/sessions').set(ex.h).send({ name: '2027', startDate: '2027-01-01', endDate: '2027-12-31' })).body.data;
  const promoted = await agent().post('/api/v1/students/promote').set(ex.h).send({
    fromSessionId: ex.session._id,
    toSessionId: next._id,
    fromClassId: ex.cls._id,
    toClassId: cls6._id,
    repeatStudentIds: [ex.kids[2]._id],
    rollMode: 'name',
  });
  expect(promoted.status).toBe(200);
  return { t, ex };
};

const candidatesOf = async (x: Awaited<ReturnType<typeof completedYear>>, examId?: string) =>
  (
    await agent()
      .get('/api/v1/certificates/candidates')
      .query({ sessionId: x.ex.session._id, classId: x.ex.cls._id, ...(examId ? { examId } : {}) })
      .set(x.ex.h)
  ).body.data;

describe('certificate settings', () => {
  it('starts from defaults, saves options and rejects bad input', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    const first = (await agent().get('/api/v1/certificates/config').set(h)).body.data;
    expect(first.config).toMatchObject({ language: 'bn', layout: 'royal', bodyTemplate: '' });
    expect(first.placeholders).toContain('gpa');
    const put = (b: object) => agent().put('/api/v1/certificates/config').set(h).send(b);
    expect((await put(cfgBody({ layout: 'modern', themeColor: '#7c2d12', title: 'Certificate' }))).status).toBe(200);
    expect((await agent().get('/api/v1/certificates/config').set(h)).body.data.config).toMatchObject({ layout: 'modern', title: 'Certificate' });
    expect((await put(cfgBody({ layout: 'neon' }))).status).toBe(400);
    expect((await put(cfgBody({ themeColor: 'green' }))).status).toBe(400);
    expect((await put(cfgBody({ signatureUrl: 'http://evil.example/x.png' }))).status).toBe(400);
  });

  it('is for admins only', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    await agent().post('/api/v1/users').set(h).send({ role: 'teacher', name: 'Teacher One', email: 'ct@example.com', password: 'Teacher#12345' });
    const teacher = authed((await login(t.slug, 'ct@example.com', 'Teacher#12345')).body.data.accessToken);
    expect((await agent().get('/api/v1/certificates').set(teacher)).status).toBe(403);
    expect((await agent().get('/api/v1/certificates')).status).toBe(401);
  });
});

describe('issuing yearly certificates', () => {
  it('lists only completed years, fills GPA from a published exam, and issues numbered certificates once per year', async () => {
    const x = await completedYear();
    const plain = await candidatesOf(x);
    expect(plain.map((c: any) => c.name).sort()).toEqual(['Anik', 'Babu']); // Chandra repeated the year
    expect(plain[0].gpa).toBe('');

    const withGpa = await candidatesOf(x, x.ex.exam._id);
    const anik = withGpa.find((c: any) => c.name === 'Anik');
    expect(anik.gpa).toMatch(/^\d\.\d{2}$/);
    expect(anik.letter).toBeTruthy();

    const issued = await agent()
      .post('/api/v1/certificates')
      .set(x.ex.h)
      .send({ issueDate: '2026-12-30', examId: x.ex.exam._id, items: withGpa.map((c: any) => ({ enrolmentId: c.enrolmentId })) });
    expect(issued.status).toBe(201);
    expect(issued.body.data.map((c: any) => c.serial)).toEqual(['CRT-2026-0001', 'CRT-2026-0002']);
    expect(issued.body.data[0]).toMatchObject({ className: 'Class 5', examName: 'Half Yearly', sessionName: x.ex.session.name });

    expect((await candidatesOf(x)).every((c: any) => c.issuedSerial)).toBe(true);
    const again = await agent().post('/api/v1/certificates').set(x.ex.h).send({ issueDate: '2026-12-30', items: [{ enrolmentId: anik.enrolmentId }] });
    expect(again.body.code).toBe('ALREADY_ISSUED');
    const dup = await agent().post('/api/v1/certificates').set(x.ex.h).send({ issueDate: '2026-12-30', items: [{ enrolmentId: anik.enrolmentId }, { enrolmentId: anik.enrolmentId }] });
    expect(dup.body.code).toBe('DUPLICATE_STUDENT');

    // cancelling frees the year, and the numbering restarts each year
    await agent().patch(`/api/v1/certificates/${issued.body.data[0]._id}`).set(x.ex.h).send({ status: 'cancelled' });
    const reissued = await agent().post('/api/v1/certificates').set(x.ex.h).send({ issueDate: '2027-01-05', items: [{ enrolmentId: anik.enrolmentId, gpa: '4.80', letter: 'A' }] });
    expect(reissued.body.data[0]).toMatchObject({ serial: 'CRT-2027-0001', gpa: '4.80', letter: 'A' });
    const restore = await agent().patch(`/api/v1/certificates/${issued.body.data[0]._id}`).set(x.ex.h).send({ status: 'issued' });
    expect(restore.body.code).toBe('ALREADY_ISSUED');

    const list = await agent().get('/api/v1/certificates?year=2026').set(x.ex.h);
    expect(list.body.meta.total).toBe(2);
    expect((await agent().get('/api/v1/certificates?search=CRT-2027').set(x.ex.h)).body.data).toHaveLength(1);
  });

  it('refuses a year that was not completed', async () => {
    const x = await completedYear();
    const all = (await agent().get(`/api/v1/students/${x.ex.kids[2]._id}`).set(x.ex.h)).body.data.enrolments;
    const repeated = all.find((e: any) => e.status === 'repeated');
    const res = await agent().post('/api/v1/certificates').set(x.ex.h).send({ issueDate: '2026-12-30', items: [{ enrolmentId: repeated._id }] });
    expect(res.body.code).toBe('YEAR_NOT_COMPLETED');
  });
});

describe('certificate PDF', () => {
  it('prints every layout, the sample, and refuses cancelled certificates', async () => {
    const x = await completedYear();
    const cands = await candidatesOf(x, x.ex.exam._id);
    const issued = (await agent().post('/api/v1/certificates').set(x.ex.h).send({ issueDate: '2026-12-30', items: cands.map((c: any) => ({ enrolmentId: c.enrolmentId })) })).body.data;
    const ids = issued.map((c: any) => c._id).join(',');

    for (const layout of CERTIFICATE_LAYOUTS) {
      const res = await agent().get(`/api/v1/certificates/print.pdf?ids=${ids}&layout=${layout}`).set(x.ex.h).buffer(true).parse(binary);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
      expect(pages(res.body)).toBe(2);
    }
    const en = await agent().get('/api/v1/certificates/print.pdf?sample=true&locale=en').set(x.ex.h).buffer(true).parse(binary);
    expect(pages(en.body)).toBe(1);

    await agent().patch(`/api/v1/certificates/${issued[0]._id}`).set(x.ex.h).send({ status: 'cancelled' });
    const blocked = await agent().get(`/api/v1/certificates/print.pdf?ids=${issued[0]._id}`).set(x.ex.h);
    expect(blocked.body.code).toBe('CANCELLED');
  });

  it('writes the body with an optional GPA line', () => {
    const r = { name: 'Rahim', nameBn: 'রহিম', fatherName: 'Karim', motherName: 'Rina', className: 'Class 5', classNameBn: 'পঞ্চম', sectionName: 'A', roll: 3, sessionName: '2026', gpa: '5.00', letter: 'A+', gender: 'male' };
    const bn = renderBody(r, DEFAULT_CERTIFICATE_CONFIG, 'bn');
    expect(bn).toContain('রহিম');
    expect(bn).toContain('পঞ্চম');
    expect(bn).toContain('জিপিএ ৫.০০');
    const off = renderBody(r, { ...DEFAULT_CERTIFICATE_CONFIG, show: { ...DEFAULT_CERTIFICATE_CONFIG.show, gpa: false } }, 'en');
    expect(off).not.toContain('GPA');
    expect(off).toContain('him');
    expect(renderBody({ ...r, gpa: '' }, DEFAULT_CERTIFICATE_CONFIG, 'en')).not.toContain('GPA');
  });
});
