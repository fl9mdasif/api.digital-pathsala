import { beforeAll, describe, expect, it } from 'vitest';
import { Tenant } from '../src/app/modules/tenant/tenant.model';
import { Admission } from '../src/app/modules/admission/admission.model';
import { agent, authed, login, registerTenant } from './helpers/api';
import { setupAcademic } from './helpers/academic';
import { useTestDb } from './helpers/db';

useTestDb();

beforeAll(async () => {
  await Admission.init();
});

const openSite = async (h: Record<string, string>, isOpen = true) => {
  await agent().patch('/api/v1/site').set(h).send({ hero: { title: 'Welcome' }, admissionInfo: { isOpen, text: 'Apply now' } });
  await agent().post('/api/v1/site/publish').set(h);
};

const form = (classId: string, over: Record<string, unknown> = {}) => ({
  classId,
  name: 'Rahim Uddin',
  gender: 'male',
  dob: '2015-03-10',
  previousSchool: 'Rampur Primary',
  guardians: [{ name: 'Karim Uddin', phone: '01711222333', relation: 'father' }],
  ...over,
});

const base = (slug: string) => `/api/v1/public/schools/${slug}/admissions`;

const setup = async (slug: string) => {
  const t = await registerTenant({ slug });
  const h = authed(t.token);
  const a = await setupAcademic(t);
  return { t, h, a };
};

describe('public admission form', () => {
  it('needs a published site with admission open, and ignores bots', async () => {
    const { h, a } = await setup('adm-open');
    expect((await agent().post(base('adm-open')).send(form(a.cls._id))).status).toBe(404);
    await openSite(h, false);
    expect((await agent().post(base('adm-open')).send(form(a.cls._id))).body.code).toBe('ADMISSION_CLOSED');
    await openSite(h, true);
    const classes = (await agent().get(`${base('adm-open')}/classes`)).body.data;
    expect(classes).toEqual([{ _id: a.cls._id, name: 'Class 5' }]);

    const res = await agent().post(base('adm-open')).send(form(a.cls._id));
    expect(res.status).toBe(201);
    expect(res.body.data.applicationNo).toMatch(/^ADM-\d{4}-0001$/);
    const second = await agent().post(base('adm-open')).send(form(a.cls._id, { name: 'Second Child' }));
    expect(second.body.data.applicationNo).toMatch(/-0002$/);

    const bot = await agent().post(base('adm-open')).send(form(a.cls._id, { website: 'http://spam' }));
    expect(bot.status).toBe(201);
    expect((await agent().get('/api/v1/admissions').set(h)).body.data).toHaveLength(2);
  });

  it('rejects bad input', async () => {
    const { h, a } = await setup('adm-bad');
    await openSite(h);
    const post = (b: object) => agent().post(base('adm-bad')).send(b);
    expect((await post(form(a.cls._id, { guardians: [] }))).status).toBe(400);
    expect((await post(form(a.cls._id, { guardians: [{ name: 'X Y', phone: '123', relation: 'father' }] }))).status).toBe(400);
    expect((await post(form(a.cls._id, { dob: '2999-01-01' }))).status).toBe(400);
    expect((await post(form('64b000000000000000000000'))).body.code).toBe('CLASS_NOT_FOUND');
  });

  it('shows status only to someone with the number and a guardian phone, and queues photo changes', async () => {
    const { h, a } = await setup('adm-status');
    await openSite(h);
    const no = (await agent().post(base('adm-status')).send(form(a.cls._id))).body.data.applicationNo;

    const wrong = await agent().post(`${base('adm-status')}/status`).send({ applicationNo: no, phone: '01999999999' });
    expect(wrong.status).toBe(404);
    const missing = await agent().post(`${base('adm-status')}/status`).send({ applicationNo: 'ADM-2000-9999', phone: '01711222333' });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe(wrong.body.code);

    const ok = await agent().post(`${base('adm-status')}/status`).send({ applicationNo: no.toLowerCase(), phone: '+8801711222333' });
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.body.data).toMatchObject({ applicationNo: no, status: 'applied', className: 'Class 5', photo: { hasPhoto: false, pendingApproval: false } });
    expect(ok.body.data.guardians).toBeUndefined();

    const photo = await agent().post(`${base('adm-status')}/photo`).send({ applicationNo: no, phone: '01711222333', photoUrl: 'https://example.com/new.jpg' });
    expect(photo.status).toBe(200);
    expect(photo.body.data.photo).toEqual({ hasPhoto: false, pendingApproval: true });

    const sign = await agent().post(`${base('adm-status')}/upload-sign`).send({});
    expect(sign.status).toBe(200);
    expect(sign.body.data.fields.key).toContain('/admissions/');
  });
});

describe('admin pipeline', () => {
  it('admits, approves a photo, confirms into a real student, and locks the application', async () => {
    const { h, a } = await setup('adm-flow');
    await openSite(h);
    const no = (await agent().post(base('adm-flow')).send(form(a.cls._id, { photoUrl: 'https://example.com/first.jpg' }))).body.data.applicationNo;
    await agent().post(`${base('adm-flow')}/photo`).send({ applicationNo: no, phone: '01711222333', photoUrl: 'https://example.com/second.jpg' });

    const list = await agent().get('/api/v1/admissions?status=applied').set(h);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.counts).toMatchObject({ applied: 1 });
    const id = list.body.data[0]._id;

    // confirming before admitting is refused
    expect((await agent().post(`/api/v1/admissions/${id}/confirm`).set(h).send({})).body.code).toBe('NOT_ADMITTED');

    expect((await agent().patch(`/api/v1/admissions/${id}/status`).set(h).send({ status: 'rejected', note: 'Seats full' })).body.data.status).toBe('rejected');
    const seen = await agent().post(`${base('adm-flow')}/status`).send({ applicationNo: no, phone: '01711222333' });
    expect(seen.body.data).toMatchObject({ status: 'rejected', note: 'Seats full' });
    const admitted = await agent().patch(`/api/v1/admissions/${id}/status`).set(h).send({ status: 'admitted', note: 'Come on Sunday' });
    expect(admitted.body.data.status).toBe('admitted');

    const approved = await agent().post(`/api/v1/admissions/${id}/photo/approve`).set(h);
    expect(approved.body.data.photoUrl).toBe('https://example.com/second.jpg');
    expect(approved.body.data.pendingPhotoUrl).toBeUndefined();
    expect((await agent().post(`/api/v1/admissions/${id}/photo/approve`).set(h)).body.code).toBe('NO_PENDING_PHOTO');

    const confirmed = await agent().post(`/api/v1/admissions/${id}/confirm`).set(h).send({ sectionId: a.sections[0]._id, roll: 7 });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.data.studentId).toMatch(/^\d{2}-\d{4}$/);

    const students = (await agent().get('/api/v1/students').set(h)).body.data;
    expect(students).toHaveLength(1);
    expect(students[0]).toMatchObject({ name: 'Rahim Uddin', admissionNo: no, photoUrl: 'https://example.com/second.jpg' });

    const detail = (await agent().get(`/api/v1/admissions/${id}`).set(h)).body.data;
    expect(detail.status).toBe('confirmed');
    expect(detail.history.map((x: any) => x.status)).toEqual(['applied', 'rejected', 'admitted', 'confirmed']);

    expect((await agent().post(`/api/v1/admissions/${id}/confirm`).set(h).send({})).status).toBe(409);
    expect((await agent().patch(`/api/v1/admissions/${id}/status`).set(h).send({ status: 'rejected' })).body.code).toBe('APPLICATION_LOCKED');
    expect((await agent().patch(`/api/v1/admissions/${id}`).set(h).send({ name: 'Changed Name' })).body.code).toBe('APPLICATION_LOCKED');
    const late = await agent().post(`${base('adm-flow')}/photo`).send({ applicationNo: no, phone: '01711222333', photoUrl: 'https://example.com/third.jpg' });
    expect(late.body.code).toBe('APPLICATION_LOCKED');
  });

  it('lets an admin edit and replace the photo, and respects the plan cap', async () => {
    const { t, h, a } = await setup('adm-edit');
    await openSite(h);
    await agent().post(base('adm-edit')).send(form(a.cls._id));
    const id = (await agent().get('/api/v1/admissions').set(h)).body.data[0]._id;
    const edited = await agent().patch(`/api/v1/admissions/${id}`).set(h).send({ name: 'Rahim Edited', photoUrl: 'https://example.com/office.jpg' });
    expect(edited.body.data).toMatchObject({ name: 'Rahim Edited', photoUrl: 'https://example.com/office.jpg' });
    expect((await agent().patch(`/api/v1/admissions/${id}`).set(h).send({ photoUrl: null })).body.data.photoUrl).toBeUndefined();
    expect((await agent().get('/api/v1/admissions?q=edited').set(h)).body.data).toHaveLength(1);

    await agent().patch(`/api/v1/admissions/${id}/status`).set(h).send({ status: 'admitted' });
    await Tenant.updateOne({ _id: t.tenantId }, { studentCap: 0 });
    expect((await agent().post(`/api/v1/admissions/${id}/confirm`).set(h).send({})).body.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('is for admins only and keeps schools apart', async () => {
    const one = await setup('adm-one');
    const two = await setup('adm-two');
    await openSite(one.h);
    await agent().post(base('adm-one')).send(form(one.a.cls._id));
    const id = (await agent().get('/api/v1/admissions').set(one.h)).body.data[0]._id;

    expect((await agent().get('/api/v1/admissions').set(two.h)).body.data).toHaveLength(0);
    expect((await agent().get(`/api/v1/admissions/${id}`).set(two.h)).status).toBe(404);
    expect((await agent().get('/api/v1/admissions')).status).toBe(401);

    await agent().post('/api/v1/users').set(one.h).send({ role: 'teacher', name: 'Teacher One', email: 'adm-t@example.com', password: 'Teacher#12345' });
    const teacher = authed((await login(one.t.slug, 'adm-t@example.com', 'Teacher#12345')).body.data.accessToken);
    expect((await agent().get('/api/v1/admissions').set(teacher)).status).toBe(403);
  });
});
