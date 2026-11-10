import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ID_CARD_CONFIG, IdCardConfig } from '../src/app/modules/idCard/idCard.model';
import { agent, registerTenant } from './helpers/api';
import { newStudent } from './helpers/academic';
import { setupExam } from './helpers/exams';
import { useTestDb } from './helpers/db';

useTestDb();

beforeAll(async () => {
  await IdCardConfig.init();
});

const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const c: Buffer[] = [];
  res.on('data', (d: Buffer) => c.push(d));
  res.on('end', () => cb(null, Buffer.concat(c)));
};
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;
const settings = (over: Record<string, unknown> = {}) => ({ ...DEFAULT_ID_CARD_CONFIG, ...over });

describe('student ID card settings', () => {
  it('starts from sensible defaults and offers the placeholder names', async () => {
    const t = await registerTenant();
    const h = { Authorization: `Bearer ${t.token}` };
    const res = (await agent().get('/api/v1/id-cards/config').set(h)).body.data;
    expect(res.config).toMatchObject({ design: 'modern', photoShape: 'square', qrMode: 'off', classDisplay: 'class_section' });
    expect(res.config.show).toMatchObject({ class: true, roll: true, father: true, mother: false, bloodGroup: false });
    expect(res.placeholders).toContain('student_id');
  });

  it('saves every option and returns them', async () => {
    const t = await registerTenant();
    const h = { Authorization: `Bearer ${t.token}` };
    const body = settings({
      design: 'classic',
      themeColor: '#0f766e',
      photoShape: 'circle',
      issueDate: '2026-01-05',
      validUntil: '2026-12-31',
      classDisplay: 'class_only',
      sessionLabel: 'Year',
      backTop: 'Return to the school office.',
      qrMode: 'dynamic',
      qrData: '{student_id}|{name}',
      show: { ...DEFAULT_ID_CARD_CONFIG.show, bloodGroup: true, mother: true, dob: true },
    });
    expect((await agent().put('/api/v1/id-cards/config').set(h).send(body)).status).toBe(200);
    const back = (await agent().get('/api/v1/id-cards/config').set(h)).body.data.config;
    expect(back).toMatchObject({ design: 'classic', photoShape: 'circle', validUntil: '2026-12-31', qrMode: 'dynamic', sessionLabel: 'Year' });
    expect(back.show).toMatchObject({ bloodGroup: true, mother: true, dob: true });
  });

  it('rejects bad colours, designs, dates and missing toggles', async () => {
    const t = await registerTenant();
    const h = { Authorization: `Bearer ${t.token}` };
    const put = (b: object) => agent().put('/api/v1/id-cards/config').set(h).send(b);
    expect((await put(settings({ themeColor: 'red' }))).status).toBe(400);
    expect((await put(settings({ design: 'neon' }))).status).toBe(400);
    expect((await put(settings({ issueDate: '05/01/2026' }))).status).toBe(400);
    expect((await put(settings({ fontDetails: 30 }))).status).toBe(400);
    expect((await put(settings({ watermarkUrl: 'http://evil.example/x.png' }))).status).toBe(400);
    const { show: _omit, ...noShow } = settings();
    expect((await put(noShow)).status).toBe(400);
  });
});

describe('student ID card printing', () => {
  it('prints fronts, backs or both, eight to a page, in each design', async () => {
    const t = await registerTenant();
    const x = await setupExam(t); // class 5 / section A with 3 students
    const get = (qs: string) => agent().get(`/api/v1/id-cards/students.pdf?${qs}`).set(x.h).buffer(true).parse(binary);
    const sec = `sectionId=${x.sections[0]._id}`;

    const front = await get(sec);
    expect(front.status).toBe(200);
    expect(front.headers['x-card-count']).toBe('3');
    expect((front.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect(pages(front.body as Buffer)).toBe(1);

    expect(pages((await get(`${sec}&part=back`)).body as Buffer)).toBe(1);
    expect(pages((await get(`${sec}&part=both`)).body as Buffer)).toBe(2);
    for (const design of ['modern', 'classic', 'mono']) expect((await get(`${sec}&design=${design}`)).status).toBe(200);

    const one = await get(`studentIds=${x.kids[1]._id}&locale=en`);
    expect(one.headers['x-card-count']).toBe('1');

    for (let i = 0; i < 6; i++)
      await agent().post('/api/v1/students').set(x.h).send(newStudent(x.cls._id, x.sections[0]._id, { name: `Extra ${i}`, guardians: [] }));
    const nine = await get(sec);
    expect(nine.headers['x-card-count']).toBe('9');
    expect(pages(nine.body as Buffer)).toBe(2);
    expect(pages((await get(`${sec}&part=both`)).body as Buffer)).toBe(4);
  });

  it('prints a sample card for the preview without needing any students', async () => {
    const t = await registerTenant();
    const h = { Authorization: `Bearer ${t.token}` };
    const res = await agent().get('/api/v1/id-cards/students.pdf?sample=true&part=both&design=classic').set(h).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['x-card-count']).toBe('1');
    expect(pages(res.body as Buffer)).toBe(2);
  });

  it('draws a QR code on the back when the QR option is on', async () => {
    const t = await registerTenant();
    const h = { Authorization: `Bearer ${t.token}` };
    const back = () =>
      agent().get('/api/v1/id-cards/students.pdf?sample=true&part=back').set(h).buffer(true).parse(binary).then((r) => (r.body as Buffer).length);
    const without = await back();
    await agent().put('/api/v1/id-cards/config').set(h).send(settings({ qrMode: 'static', qrData: 'https://example.com/verify/abc' }));
    expect(await back()).toBeGreaterThan(without);
  });

  it('rejects empty requests, empty sections and non-admins', async () => {
    const t = await registerTenant();
    const x = await setupExam(t);
    const raw = (qs: string, h = x.h) => agent().get(`/api/v1/id-cards/students.pdf?${qs}`).set(h);

    expect((await raw('')).status).toBe(400);
    expect((await raw('studentIds=not-an-id')).status).toBe(400);
    expect((await raw(`sectionId=${x.sections[0]._id}&part=side`)).status).toBe(400);
    const empty = (await agent().post('/api/v1/sections').set(x.h).send({ classId: x.cls._id, name: 'Z' })).body.data;
    expect((await raw(`sectionId=${empty._id}`)).body.code).toBe('NO_STUDENTS');
    expect((await raw(`sectionId=${x.sections[0]._id}`, x.banglaTok)).status).toBe(403);
    expect((await agent().get('/api/v1/id-cards/config').set(x.banglaTok)).status).toBe(403);
  });
});
