import { describe, expect, it } from 'vitest';
import { agent, authed, login, registerTenant } from './helpers/api';
import { useTestDb } from './helpers/db';
import { platformToken } from './helpers/platform';

useTestDb();

describe('platform console', () => {
  it('rejects tenant tokens and anonymous callers', async () => {
    const t = await registerTenant();
    expect((await agent().get('/api/v1/platform/tenants')).status).toBe(401);
    expect((await agent().get('/api/v1/platform/tenants').set(authed(t.token))).status).toBe(403);
  });

  it('platform tokens cannot call tenant routes', async () => {
    const p = await platformToken();
    expect((await agent().get('/api/v1/users').set(authed(p))).status).toBe(403);
    expect((await agent().get('/api/v1/school/profile').set(authed(p))).status).toBe(403);
  });

  it('lists tenants, shows detail and stats', async () => {
    const p = await platformToken();
    const t = await registerTenant({ slug: 'listed-school' });
    const list = await agent().get('/api/v1/platform/tenants').set(authed(p)).query({ q: 'listed' });
    expect(list.body.data.map((x: any) => x.slug)).toContain('listed-school');
    const detail = await agent().get(`/api/v1/platform/tenants/${t.tenantId}`).set(authed(p));
    expect(detail.body.data.usage.staff).toBe(1);
    const stats = await agent().get('/api/v1/platform/stats').set(authed(p));
    expect(stats.body.data.tenantsByStatus.trial).toBeGreaterThan(0);
  });

  it('suspend blocks non-admin staff and puts admin in read-only mode, reactivate restores', async () => {
    const p = await platformToken();
    const t = await registerTenant();
    await agent()
      .post('/api/v1/users')
      .set(authed(t.token))
      .send({ role: 'teacher', name: 'Teach Er', email: 'tt@example.com', password: 'Teacher#12345' });
    const teacherTok = (await login(t.slug, 'tt@example.com', 'Teacher#12345')).body.data.accessToken;

    const noReason = await agent()
      .patch(`/api/v1/platform/tenants/${t.tenantId}/status`)
      .set(authed(p))
      .send({ status: 'suspended' });
    expect(noReason.status).toBe(400);
    await agent()
      .patch(`/api/v1/platform/tenants/${t.tenantId}/status`)
      .set(authed(p))
      .send({ status: 'suspended', reason: 'unpaid subscription' });

    expect((await agent().get('/api/v1/auth/me').set(authed(teacherTok))).status).toBe(403);
    // admin: reads fine, writes blocked
    expect((await agent().get('/api/v1/users').set(authed(t.token))).status).toBe(200);
    const write = await agent()
      .post('/api/v1/users')
      .set(authed(t.token))
      .send({ role: 'teacher', name: 'New Teach', email: 'nn@example.com' });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('TENANT_SUSPENDED');

    await agent()
      .patch(`/api/v1/platform/tenants/${t.tenantId}/status`)
      .set(authed(p))
      .send({ status: 'active', reason: 'payment received' });
    expect(
      (
        await agent()
          .post('/api/v1/users')
          .set(authed(t.token))
          .send({ role: 'teacher', name: 'New Teach', email: 'nn@example.com' })
      ).status,
    ).toBe(201);
  });

  it('assigns a plan, overrides the cap, extends the trial and changes the slug with an alias kept', async () => {
    const p = await platformToken();
    const t = await registerTenant({ slug: 'old-name-school' });
    const plans = await agent().get('/api/v1/platform/plans').set(authed(p));
    const large = plans.body.data.find((x: any) => x.slug === 'pro');

    const plan = await agent()
      .patch(`/api/v1/platform/tenants/${t.tenantId}/plan`)
      .set(authed(p))
      .send({ planId: large._id, extendTrialDays: 10 });
    expect(plan.status).toBe(200);
    expect(plan.body.data.studentCap).toBe(150); // plans no longer carry a cap; only the explicit override changes it
    const cap = await agent()
      .patch(`/api/v1/platform/tenants/${t.tenantId}/plan`)
      .set(authed(p))
      .send({ studentCap: 2000 });
    expect(cap.body.data.studentCap).toBe(2000);

    const slug = await agent()
      .patch(`/api/v1/platform/tenants/${t.tenantId}/slug`)
      .set(authed(p))
      .send({ slug: 'new-name-school', reason: 'rebrand' });
    expect(slug.body.data.slug).toBe('new-name-school');
    // old slug still signs in through the alias
    expect((await login('old-name-school', t.email, t.password)).status).toBe(200);
    expect((await login('new-name-school', t.email, t.password)).status).toBe(200);
    const taken = await agent()
      .patch(`/api/v1/platform/tenants/${t.tenantId}/slug`)
      .set(authed(p))
      .send({ slug: 'admin', reason: 'bad idea' });
    expect(taken.status).toBe(400);
  });

  it('records a subscription payment and activates the tenant', async () => {
    const p = await platformToken();
    const t = await registerTenant();
    const plans = await agent().get('/api/v1/platform/plans').set(authed(p));
    const starter = plans.body.data.find((x: any) => x.slug === 'basic');
    const res = await agent()
      .post(`/api/v1/platform/tenants/${t.tenantId}/subscription-payments`)
      .set(authed(p))
      .send({
        planId: starter._id,
        amount: 150000,
        method: 'bkash_manual',
        reference: 'TRX123ABC',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
      });
    expect(res.status).toBe(201);
    const detail = await agent().get(`/api/v1/platform/tenants/${t.tenantId}`).set(authed(p));
    expect(detail.body.data.status).toBe('active');
    expect(detail.body.data.studentCap).toBe(150);
  });

  it('manages plans', async () => {
    const p = await platformToken();
    const c = await agent()
      .post('/api/v1/platform/plans')
      .set(authed(p))
      .send({
        slug: 'mini',
        name: 'Mini',
        monthlyPrice: 800,
        yearlyPrice: 8000,
        features: ['100 students'],
      });
    expect(c.status).toBe(201);
    expect(
      (
        await agent()
          .post('/api/v1/platform/plans')
          .set(authed(p))
          .send({
            slug: 'mini',
            name: 'Mini',
            monthlyPrice: 1,
            yearlyPrice: 1,
            features: ['x'],
          })
      ).status,
    ).toBe(409);
    const u = await agent()
      .patch(`/api/v1/platform/plans/${c.body.data._id}`)
      .set(authed(p))
      .send({ monthlyPrice: 900 });
    expect(u.body.data.monthlyPrice).toBe(900);
  });
});
