import { beforeAll, describe, expect, it } from 'vitest';
import { IdCardConfig } from '../src/app/modules/idCard/idCard.model';
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

describe('ID cards', () => {
  it('saves card settings with validation', async () => {
    const t = await registerTenant();
    const h = { Authorization: `Bearer ${t.token}` };
    const def = await agent().get('/api/v1/id-cards/config').set(h);
    expect(def.body.data).toMatchObject({ themeColor: '#1b4b8a', validityYears: 1, showGuardianPhone: true });

    const body = { themeColor: '#0a7d4b', validityYears: 2, signatureTitle: 'Headmaster', showGuardianPhone: false, footerNote: 'If found, return to school' };
    expect((await agent().put('/api/v1/id-cards/config').set(h).send(body)).status).toBe(200);
    expect((await agent().get('/api/v1/id-cards/config').set(h)).body.data).toEqual(body);
    expect((await agent().put('/api/v1/id-cards/config').set(h).send({ ...body, themeColor: 'red' })).status).toBe(400);
    expect((await agent().put('/api/v1/id-cards/config').set(h).send({ ...body, validityYears: 0 })).status).toBe(400);
  });

  it('prints cards for a section or for chosen students, eight to a page', async () => {
    const t = await registerTenant();
    const x = await setupExam(t); // class 5 / section A with 3 students
    const get = (qs: string) => agent().get(`/api/v1/id-cards/students.pdf?${qs}`).set(x.h).buffer(true).parse(binary);

    const sec = await get(`sectionId=${x.sections[0]._id}`);
    expect(sec.status).toBe(200);
    expect(sec.headers['content-type']).toContain('application/pdf');
    expect(sec.headers['x-card-count']).toBe('3');
    expect((sec.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect(pages(sec.body as Buffer)).toBe(1);

    const one = await get(`studentIds=${x.kids[1]._id}&locale=en`);
    expect(one.headers['x-card-count']).toBe('1');

    for (let i = 0; i < 6; i++)
      await agent()
        .post('/api/v1/students')
        .set(x.h)
        .send(newStudent(x.cls._id, x.sections[0]._id, { name: `Extra ${i}`, guardians: [] }));
    const nine = await get(`sectionId=${x.sections[0]._id}`);
    expect(nine.headers['x-card-count']).toBe('9');
    expect(pages(nine.body as Buffer)).toBe(2);
  });

  it('rejects empty requests, empty sections and non-admins', async () => {
    const t = await registerTenant();
    const x = await setupExam(t);
    const raw = (qs: string, h = x.h) => agent().get(`/api/v1/id-cards/students.pdf?${qs}`).set(h);

    expect((await raw('')).status).toBe(400);
    expect((await raw('studentIds=not-an-id')).status).toBe(400);
    const empty = (await agent().post('/api/v1/sections').set(x.h).send({ classId: x.cls._id, name: 'Z' })).body.data;
    expect((await raw(`sectionId=${empty._id}`)).body.code).toBe('NO_STUDENTS');
    expect((await raw(`sectionId=${x.sections[0]._id}`, x.banglaTok)).status).toBe(403);
    expect((await agent().get('/api/v1/id-cards/config').set(x.banglaTok)).status).toBe(403);
  });
});
