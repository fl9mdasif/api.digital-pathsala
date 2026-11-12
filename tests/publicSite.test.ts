import { describe, expect, it } from 'vitest';
import { Inquiry } from '../src/app/modules/inquiry/inquiry.model';
import { runAsTenant } from '../src/app/lib/tenantContext';
import { Types } from 'mongoose';
import { agent, authed, registerTenant } from './helpers/api';
import { useTestDb } from './helpers/db';

useTestDb();

describe('public site', () => {
  it('an unpublished site is a 404 for every public route, then goes live on publish', async () => {
    const t = await registerTenant({ slug: 'bright-model' });
    const h = authed(t.token);
    expect((await agent().get('/api/v1/public/schools/bright-model')).status).toBe(404);
    expect((await agent().get('/api/v1/public/schools/bright-model/notices')).status).toBe(404);

    await agent()
      .patch('/api/v1/site')
      .set(h)
      .send({
        hero: { title: 'Welcome to Bright Model' },
        about: 'We teach.',
        admissionInfo: { isOpen: true, text: 'Apply now' },
      });
    expect((await agent().post('/api/v1/site/publish').set(h)).status).toBe(200);

    const res = await agent().get('/api/v1/public/schools/brightModel'); // normalized slug works
    expect(res.status).toBe(200);
    expect(res.body.data.hero.title).toBe('Welcome to Bright Model');
    expect(res.body.data.school.name).toBe('Bright Model School');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/tenantId|createdBy|passwordHash|isPublished/);

    await agent().post('/api/v1/site/unpublish').set(h);
    expect((await agent().get('/api/v1/public/schools/bright-model')).status).toBe(404);
  });

  it('shows only public, published, unexpired notices', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    await agent().post('/api/v1/site/publish').set(h);
    const post = (b: object) =>
      agent()
        .post('/api/v1/notices')
        .set(h)
        .send({ body: 'text', audience: { type: 'all' }, ...b });
    await post({ title: 'Public one', isPublic: true });
    await post({ title: 'Internal one', isPublic: false });
    await post({ title: 'Public draft', isPublic: true, status: 'draft' });
    await post({ title: 'Public expired', isPublic: true, publishAt: '2020-01-01', expiresAt: '2020-02-01' });
    await post({ title: 'Public future', isPublic: true, publishAt: '2099-01-01' });
    const res = await agent().get(`/api/v1/public/schools/${t.slug}/notices`);
    expect(res.body.data.map((n: any) => n.title)).toEqual(['Public one']);
  });

  it('lists only staff flagged for the public site', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    await agent().post('/api/v1/site/publish').set(h);
    await agent()
      .post('/api/v1/staff-profiles')
      .set(h)
      .send({ name: 'Visible Sir', designation: 'Teacher', showOnPublicSite: true });
    await agent()
      .post('/api/v1/staff-profiles')
      .set(h)
      .send({ name: 'Hidden Sir', designation: 'Clerk', showOnPublicSite: false });
    const res = await agent().get(`/api/v1/public/schools/${t.slug}/staff`);
    expect(res.body.data.map((s: any) => s.name)).toEqual(['Visible Sir']);
  });

  it('inquiries: stored for the school, honeypot ignored, rate limited per hour', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    await agent().post('/api/v1/site/publish').set(h);
    const url = `/api/v1/public/schools/${t.slug}/inquiries`;
    const ok = await agent().post(url).send({
      name: 'Parent One',
      phone: '01711223344',
      message: 'Seats in class 3?',
      classInterest: 'Class 3',
    });
    expect(ok.status).toBe(201);
    const bot = await agent()
      .post(url)
      .send({ name: 'Bot Spam', phone: '01711223345', website: 'http://spam.example' });
    expect(bot.status).toBe(201); // looks successful, stores nothing
    expect(await runAsTenant(new Types.ObjectId(t.tenantId), () => Inquiry.countDocuments({}))).toBe(1);

    const list = await agent().get('/api/v1/inquiries').set(h);
    expect(list.body.data).toHaveLength(1);
    const upd = await agent()
      .patch(`/api/v1/inquiries/${list.body.data[0]._id}`)
      .set(h)
      .send({ status: 'contacted' });
    expect(upd.body.data.status).toBe('contacted');
    expect((await agent().post(url).send({ name: 'X', phone: '123' })).status).toBe(400);
  });

  it('platform endpoints expose plans and find-school without private data', async () => {
    const t = await registerTenant({ slug: 'findable-school' });
    await agent().post('/api/v1/site/publish').set(authed(t.token));
    const plans = await agent().get('/api/v1/public/platform/plans');
    expect(plans.body.data.map((p: any) => p.slug)).toEqual(
      expect.arrayContaining(['free', 'basic', 'pro']),
    );
    const found = await agent().get('/api/v1/public/platform/find-school').query({ q: 'findable' });
    expect(found.body.data[0]).toEqual({
      name: 'Bright Model School',
      slug: 'findable-school',
      district: undefined,
    });
    expect(JSON.stringify(found.body)).not.toMatch(/phone|email|tenantId/);
  });
});
