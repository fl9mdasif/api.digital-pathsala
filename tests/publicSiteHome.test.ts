import { describe, expect, it } from 'vitest';
import { agent, authed, registerTenant } from './helpers/api';
import { newStudent, setupAcademic } from './helpers/academic';
import { generate } from './helpers/fees';
import { useTestDb } from './helpers/db';

useTestDb();

const pub = (slug: string, path: string) => agent().get(`/api/v1/public/schools/${slug}${path}`);

/** Class 5 / section A with one student whose father is 01711000001, a 1000 Tk monthly tuition structure and invoices generated. */
const setup = async () => {
  const t = await registerTenant();
  const h = authed(t.token);
  const a = await setupAcademic(t, { sections: ['A'] });
  const heads = (await agent().get('/api/v1/fee-heads').set(h)).body.data;
  const tuition = heads.find((x: any) => x.code === 'TUITION');
  await agent().post('/api/v1/fee-structures').set(h).send({ sessionId: a.session._id, classId: a.cls._id, items: [{ feeHeadId: tuition._id, amount: 100000, cycle: 'monthly', dueDay: 10 }] });
  const kid = (await agent().post('/api/v1/students').set(h).send(newStudent(a.cls._id, a.sections[0]._id, { name: 'Anik' }))).body.data;
  await generate(h, a);
  await agent().patch('/api/v1/site').set(h).send({ hero: { title: 'Welcome' } });
  await agent().post('/api/v1/site/publish').set(h);
  return { t, h, a, kid };
};

describe('home page content', () => {
  it('saves and serves the new fields, and rejects bad ones', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    const patch = (b: object) => agent().patch('/api/v1/site').set(h).send(b);
    const ok = await patch({
      establishedYear: 1990,
      eiin: '123456',
      secondMessage: { name: 'Chairman', designation: 'Chairman', text: 'Welcome.' },
      quickTiles: ['results', 'admission', 'routine'],
      importantLinks: [{ label: 'Ministry of Education', url: 'https://moedu.gov.bd' }],
      display: { showStats: false },
      sectionsVisible: { routine: false },
    });
    expect(ok.status).toBe(200);
    await agent().post('/api/v1/site/publish').set(h);

    const site = (await pub(t.slug, '')).body.data;
    expect(site).toMatchObject({ establishedYear: 1990, eiin: '123456', quickTiles: ['results', 'admission', 'routine'], display: { showStats: false, showTicker: true } });
    expect(site.secondMessage.name).toBe('Chairman');
    expect(site.importantLinks).toEqual([{ label: 'Ministry of Education', url: 'https://moedu.gov.bd' }]);

    expect((await patch({ establishedYear: 3000 })).status).toBe(400);
    expect((await patch({ quickTiles: ['results', 'results'] })).status).toBe(400);
    expect((await patch({ quickTiles: ['payroll'] })).status).toBe(400);
    expect((await patch({ importantLinks: [{ label: 'x', url: 'not a url' }] })).status).toBe(400);
    expect((await patch({ importantLinks: Array.from({ length: 13 }, () => ({ label: 'a', url: 'https://a.example' })) })).status).toBe(400);
  });
});

describe('public stats', () => {
  it('returns headline counts only, and hides them when switched off', async () => {
    const { t, h } = await setup();
    const stats = (await pub(t.slug, '/stats')).body.data;
    expect(stats).toEqual({ students: 1, teachers: 0, staff: 1 });
    await agent().patch('/api/v1/site').set(h).send({ display: { showStats: false } });
    expect((await pub(t.slug, '/stats')).body.data).toEqual({ students: null, teachers: null, staff: null });
  });

  it('is a 404 while the site is unpublished', async () => {
    const t = await registerTenant();
    expect((await pub(t.slug, '/stats')).status).toBe(404);
    expect((await pub(t.slug, '/classes')).status).toBe(404);
  });
});

describe('public routine', () => {
  it('lists classes with sections and serves a section routine, unless switched off', async () => {
    const { t, h, a } = await setup();
    const classes = (await pub(t.slug, '/classes')).body.data;
    expect(classes[0].sections.map((s: any) => s.name)).toContain('A');
    const routine = await pub(t.slug, `/routine?sectionId=${a.sections[0]._id}`);
    expect(routine.status).toBe(200);
    expect(routine.body.data.section.name).toBe('A');
    expect(Array.isArray(routine.body.data.periods)).toBe(true);

    expect((await pub(t.slug, '/routine')).status).toBe(400);
    expect((await pub(t.slug, '/routine?sectionId=64b000000000000000000001')).status).toBe(404);

    await agent().patch('/api/v1/site').set(h).send({ sectionsVisible: { routine: false } });
    expect((await pub(t.slug, '/classes')).status).toBe(404);
    expect((await pub(t.slug, `/routine?sectionId=${a.sections[0]._id}`)).status).toBe(404);
  });
});

describe('public fee lookup', () => {
  const lookup = (slug: string, body: object) => agent().post(`/api/v1/public/schools/${slug}/fees/lookup`).send(body);

  it('shows dues to a parent who gives the student ID and the guardian mobile, nothing else', async () => {
    const { t, kid } = await setup();
    const res = await lookup(t.slug, { studentId: kid.studentId, phone: '01711000001' });
    expect(res.status).toBe(200);
    expect(res.body.data.student).toEqual({ name: 'Anik', studentId: kid.studentId });
    expect(res.body.data.totalDue).toBeGreaterThan(0);
    expect(res.body.data.invoices.length).toBeGreaterThan(0);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(res.body)).not.toMatch(/guardian|phone|dob|tenantId|studentId":"[a-f0-9]{24}"/);

    // +880 formatting of the same number works too
    expect((await lookup(t.slug, { studentId: kid.studentId, phone: '+8801711000001' })).status).toBe(200);
  });

  it('gives the same answer for a wrong ID, a wrong number and a bad number', async () => {
    const { t, kid } = await setup();
    const wrongId = await lookup(t.slug, { studentId: 'NOPE-1', phone: '01711000001' });
    const wrongPhone = await lookup(t.slug, { studentId: kid.studentId, phone: '01799999999' });
    const badPhone = await lookup(t.slug, { studentId: kid.studentId, phone: '12345' });
    for (const r of [wrongId, wrongPhone, badPhone]) {
      expect(r.status).toBe(404);
      expect(r.body.code).toBe('FEE_NOT_FOUND');
    }
    expect(wrongId.body.message).toBe(wrongPhone.body.message);
    expect((await lookup(t.slug, { studentId: kid.studentId })).status).toBe(400);
    expect((await lookup(t.slug, { studentId: kid.studentId, phone: '01711000001', extra: 1 })).status).toBe(400);
  });

  it('is off when the school switches it off or the site is unpublished', async () => {
    const { t, h, kid } = await setup();
    await agent().patch('/api/v1/site').set(h).send({ sectionsVisible: { feeLookup: false } });
    expect((await lookup(t.slug, { studentId: kid.studentId, phone: '01711000001' })).status).toBe(404);
    await agent().post('/api/v1/site/unpublish').set(h);
    expect((await lookup(t.slug, { studentId: kid.studentId, phone: '01711000001' })).status).toBe(404);
  });
});
