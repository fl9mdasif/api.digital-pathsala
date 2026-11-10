import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_TESTIMONIAL_CONFIG, Testimonial, TestimonialConfig } from '../src/app/modules/testimonial/testimonial.model';
import { renderBody } from '../src/app/modules/testimonial/testimonial.service';
import { agent, authed, login, registerTenant } from './helpers/api';
import { setupExam } from './helpers/exams';
import { useTestDb } from './helpers/db';

useTestDb();

beforeAll(async () => {
  await Promise.all([TestimonialConfig.init(), Testimonial.init()]);
});

const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const c: Buffer[] = [];
  res.on('data', (d: Buffer) => c.push(d));
  res.on('end', () => cb(null, Buffer.concat(c)));
};
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;
const cfgBody = (over: Record<string, unknown> = {}) => ({ ...DEFAULT_TESTIMONIAL_CONFIG, ...over });
const detail = { exam: 'SSC', passingYear: '2026', gpa: '5.00', boardRoll: '111', boardReg: '222', conduct: 'good', village: 'Rampur', postOffice: 'Rampur', upazila: 'Sadar', district: 'Chuadanga' };

describe('testimonial settings', () => {
  it('starts from defaults, saves every option and rejects bad input', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    const first = (await agent().get('/api/v1/testimonials/config').set(h)).body.data;
    expect(first.config).toMatchObject({ language: 'bn', layout: 'classic', bodyTemplate: '' });
    expect(first.placeholders).toContain('passing_year');
    expect(first.defaults.en).toContain('{name}');

    const body = cfgBody({ language: 'en', layout: 'ornate', themeColor: '#0f766e', bodyTemplate: '{name} passed {exam}.', headerTitle: 'Certificate', show: { ...DEFAULT_TESTIMONIAL_CONFIG.show, photo: true } });
    expect((await agent().put('/api/v1/testimonials/config').set(h).send(body)).status).toBe(200);
    expect((await agent().get('/api/v1/testimonials/config').set(h)).body.data.config).toMatchObject({ language: 'en', layout: 'ornate', headerTitle: 'Certificate' });

    const put = (b: object) => agent().put('/api/v1/testimonials/config').set(h).send(b);
    expect((await put(cfgBody({ layout: 'neon' }))).status).toBe(400);
    expect((await put(cfgBody({ themeColor: 'red' }))).status).toBe(400);
    expect((await put(cfgBody({ signatureUrl: 'http://evil.example/x.png' }))).status).toBe(400);
  });

  it('is for admins only', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    await agent().post('/api/v1/users').set(h).send({ role: 'teacher', name: 'Teacher One', email: 'tt@example.com', password: 'Teacher#12345' });
    const teacher = authed((await login(t.slug, 'tt@example.com', 'Teacher#12345')).body.data.accessToken);
    expect((await agent().get('/api/v1/testimonials').set(teacher)).status).toBe(403);
    expect((await agent().get('/api/v1/testimonials/config').set(teacher)).status).toBe(403);
    expect((await agent().get('/api/v1/testimonials')).status).toBe(401);
  });
});

describe('issuing testimonials', () => {
  it('lists a section, issues numbered records, and keeps counting per year', async () => {
    const t = await registerTenant();
    const x = await setupExam(t);
    const sec = x.sections[0]._id;
    const cands = (await agent().get(`/api/v1/testimonials/candidates?sectionId=${sec}`).set(x.h)).body.data;
    expect(cands).toHaveLength(3);
    expect(cands[0]).toMatchObject({ issuedCount: 0 });

    const res = await agent().post('/api/v1/testimonials').set(x.h).send({ issueDate: '2026-12-31', items: [{ studentId: cands[0].studentId, ...detail }, { studentId: cands[1].studentId, ...detail }] });
    expect(res.status).toBe(201);
    expect(res.body.data.map((r: any) => r.serial)).toEqual(['TST-2026-0001', 'TST-2026-0002']);

    const next = await agent().post('/api/v1/testimonials').set(x.h).send({ issueDate: '2027-01-05', items: [{ studentId: cands[2].studentId, ...detail }] });
    expect(next.body.data[0].serial).toBe('TST-2027-0001');
    const again = await agent().post('/api/v1/testimonials').set(x.h).send({ issueDate: '2026-12-31', items: [{ studentId: cands[0].studentId, ...detail }] });
    expect(again.body.data[0].serial).toBe('TST-2026-0003');

    const after = (await agent().get(`/api/v1/testimonials/candidates?sectionId=${sec}`).set(x.h)).body.data;
    expect(after.find((c: any) => c.studentId === cands[0].studentId).issuedCount).toBe(2);
  });

  it('rejects empty, duplicate, unknown and badly dated requests', async () => {
    const t = await registerTenant();
    const x = await setupExam(t);
    const kid = x.kids[0]._id;
    const post = (b: object) => agent().post('/api/v1/testimonials').set(x.h).send(b);
    expect((await post({ issueDate: '2026-12-31', items: [] })).status).toBe(400);
    expect((await post({ issueDate: '31/12/2026', items: [{ studentId: kid, ...detail }] })).status).toBe(400);
    expect((await post({ issueDate: '2026-12-31', items: [{ studentId: kid, ...detail }, { studentId: kid, ...detail }] })).body.code).toBe('DUPLICATE_STUDENT');
    expect((await post({ issueDate: '2026-12-31', items: [{ studentId: '64b000000000000000000001', ...detail }] })).status).toBe(404);
    expect((await post({ issueDate: '2026-12-31', items: [{ studentId: kid, ...detail }, { studentId: '64b000000000000000000001', ...detail }] })).body.code).toBe('STUDENT_NOT_FOUND');
    expect((await post({ issueDate: '2026-12-31', items: [{ studentId: kid, ...detail, gpa: 'x'.repeat(20) }] })).status).toBe(400);
  });
});

describe('history, edits and printing', () => {
  const setup = async () => {
    const t = await registerTenant();
    const x = await setupExam(t);
    const issued = (
      await agent()
        .post('/api/v1/testimonials')
        .set(x.h)
        .send({ issueDate: '2026-12-31', items: [{ studentId: x.kids[0]._id, ...detail }, { studentId: x.kids[1]._id, ...detail, exam: 'HSC' }] })
    ).body.data;
    return { x, issued };
  };

  it('filters by name, serial, exam, year and status, and pages', async () => {
    const { x, issued } = await setup();
    const get = (qs: string) => agent().get(`/api/v1/testimonials?${qs}`).set(x.h);
    expect((await get('')).body.data).toHaveLength(2);
    expect((await get('exam=HSC')).body.data).toHaveLength(1);
    expect((await get('year=2025')).body.data).toHaveLength(0);
    expect((await get(`search=${issued[0].serial}`)).body.data).toHaveLength(1);
    expect((await get('search=anik')).body.data).toHaveLength(1);
    expect((await get('limit=1')).body.meta).toMatchObject({ page: 1, limit: 1, total: 2 });
    expect((await get('status=cancelled')).body.data).toHaveLength(0);
  });

  it('edits details, cancels, and refuses to print a cancelled one', async () => {
    const { x, issued } = await setup();
    const id = issued[0]._id;
    const patched = await agent().patch(`/api/v1/testimonials/${id}`).set(x.h).send({ gpa: '4.50', conduct: 'excellent' });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ gpa: '4.50', conduct: 'excellent', serial: issued[0].serial });
    expect((await agent().patch(`/api/v1/testimonials/${id}`).set(x.h).send({})).status).toBe(400);
    expect((await agent().patch(`/api/v1/testimonials/${id}`).set(x.h).send({ serial: 'TST-1' })).status).toBe(400);
    expect((await agent().patch('/api/v1/testimonials/64b000000000000000000001').set(x.h).send({ gpa: '1' })).status).toBe(404);

    await agent().patch(`/api/v1/testimonials/${id}`).set(x.h).send({ status: 'cancelled' });
    const res = await agent().get(`/api/v1/testimonials/print.pdf?ids=${id}`).set(x.h);
    expect(res.body.code).toBe('CANCELLED');
  });

  it('prints one page per testimonial in every layout, and a sample for the preview', async () => {
    const { x, issued } = await setup();
    const ids = issued.map((r: any) => r._id).join(',');
    const get = (qs: string) => agent().get(`/api/v1/testimonials/print.pdf?${qs}`).set(x.h).buffer(true).parse(binary);
    for (const layout of ['classic', 'modern', 'ornate', 'minimal']) {
      const r = await get(`ids=${ids}&layout=${layout}&locale=en`);
      expect(r.status).toBe(200);
      expect((r.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      expect(pages(r.body as Buffer)).toBe(2);
    }
    const sample = await get('sample=true&layout=ornate');
    expect(sample.status).toBe(200);
    expect(pages(sample.body as Buffer)).toBe(1);
    expect((await get('')).status).toBe(400);
    expect((await get('ids=64b000000000000000000001')).status).toBe(404);
  });
});

describe('body wording', () => {
  const r = { name: 'Anik', nameBn: 'অনিক', gender: 'male', exam: 'SSC', passingYear: '2026', gpa: '5.00', className: 'Ten', roll: 3 };
  it('fills placeholders, using the right pronouns and the Bangla name', () => {
    const cfg = { ...DEFAULT_TESTIMONIAL_CONFIG, bodyTemplate: '{name}: {he_she} passed {exam} in {passing_year}, GPA {gpa}. {son_daughter}' };
    expect(renderBody(r, cfg, 'en')).toBe('Anik: He passed SSC in 2026, GPA 5.00. son');
    expect(renderBody({ ...r, gender: 'female' }, cfg, 'en')).toContain('She passed');
    expect(renderBody(r, cfg, 'bn')).toContain('অনিক: সে passed');
  });

  it('falls back to the standard wording and leaves unknown details blank', () => {
    expect(renderBody(r, DEFAULT_TESTIMONIAL_CONFIG, 'bn')).toContain('অনিক');
    expect(renderBody(r, DEFAULT_TESTIMONIAL_CONFIG, 'en')).not.toContain('undefined');
    expect(renderBody(r, { ...DEFAULT_TESTIMONIAL_CONFIG, bodyTemplate: '[{village}]' }, 'en')).toBe('[]');
  });
});
