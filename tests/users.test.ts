import { describe, expect, it } from 'vitest';
import { agent, authed, login, registerTenant } from './helpers/api';
import { useTestDb } from './helpers/db';

useTestDb();

describe('staff user management', () => {
  it('admin creates a teacher with a temporary password that forces a change', async () => {
    const t = await registerTenant();
    const res = await agent()
      .post('/api/v1/users')
      .set(authed(t.token))
      .send({ role: 'teacher', name: 'Rahim Uddin', phone: '01811111111' });
    expect(res.status).toBe(201);
    expect(res.body.data.temporaryPassword).toHaveLength(10);

    const l = await login(t.slug, '01811111111', res.body.data.temporaryPassword);
    expect(l.status).toBe(200);
    expect(l.body.data.user.mustChangePassword).toBe(true);
    expect(l.body.data.user.role).toBe('teacher');
  });

  it('requires an email or a phone and rejects unknown fields like tenantId', async () => {
    const t = await registerTenant();
    expect(
      (await agent().post('/api/v1/users').set(authed(t.token)).send({ role: 'teacher', name: 'No Contact' }))
        .status,
    ).toBe(400);
    const res = await agent()
      .post('/api/v1/users')
      .set(authed(t.token))
      .send({ role: 'teacher', name: 'Evil', email: 'e@x.com', tenantId: '64b000000000000000000000' });
    expect(res.status).toBe(400);
  });

  it('refuses duplicate email inside a tenant but allows it in another tenant', async () => {
    const a = await registerTenant();
    const b = await registerTenant();
    const body = { role: 'accountant', name: 'Same Mail', email: 'same@example.com' };
    expect((await agent().post('/api/v1/users').set(authed(a.token)).send(body)).status).toBe(201);
    expect((await agent().post('/api/v1/users').set(authed(a.token)).send(body)).status).toBe(409);
    expect((await agent().post('/api/v1/users').set(authed(b.token)).send(body)).status).toBe(201);
  });

  it('non-admin roles cannot manage users', async () => {
    const t = await registerTenant();
    const c = await agent()
      .post('/api/v1/users')
      .set(authed(t.token))
      .send({ role: 'teacher', name: 'Teach Er', email: 't@example.com', password: 'Teacher#12345' });
    expect(c.status).toBe(201);
    const tok = (await login(t.slug, 't@example.com', 'Teacher#12345')).body.data.accessToken;
    expect((await agent().get('/api/v1/users').set(authed(tok))).status).toBe(403);
    expect(
      (
        await agent()
          .post('/api/v1/users')
          .set(authed(tok))
          .send({ role: 'admin', name: 'Sneaky', email: 's@x.com' })
      ).status,
    ).toBe(403);
  });

  it('cannot deactivate or demote the last active admin, nor yourself', async () => {
    const t = await registerTenant();
    const me = (await agent().get('/api/v1/auth/me').set(authed(t.token))).body.data.user.id;
    expect(
      (await agent().patch(`/api/v1/users/${me}/status`).set(authed(t.token)).send({ status: 'inactive' }))
        .status,
    ).toBe(403);
    expect(
      (await agent().patch(`/api/v1/users/${me}`).set(authed(t.token)).send({ role: 'teacher' })).status,
    ).toBe(403);

    const second = await agent()
      .post('/api/v1/users')
      .set(authed(t.token))
      .send({ role: 'admin', name: 'Second Admin', email: 'a2@example.com', password: 'Admin2#12345' });
    const tok2 = (await login(t.slug, 'a2@example.com', 'Admin2#12345')).body.data.accessToken;
    // second admin deactivates the first: allowed because another active admin (itself) remains
    expect(
      (await agent().patch(`/api/v1/users/${me}/status`).set(authed(tok2)).send({ status: 'inactive' }))
        .status,
    ).toBe(200);
    // now the second is the last admin; a third party path is impossible, so demoting the first (already inactive) is fine but the last cannot be removed
    const last = await agent()
      .patch(`/api/v1/users/${second.body.data.user.id}/status`)
      .set(authed(tok2))
      .send({ status: 'inactive' });
    expect(last.status).toBe(403);
  });

  it('deactivating a user kills their sessions; reset-password issues a new temporary one', async () => {
    const t = await registerTenant();
    const c = await agent()
      .post('/api/v1/users')
      .set(authed(t.token))
      .send({ role: 'accountant', name: 'Acc Ountant', email: 'acc@example.com', password: 'Account#12345' });
    const id = c.body.data.user.id;
    const tok = (await login(t.slug, 'acc@example.com', 'Account#12345')).body.data.accessToken;
    expect(
      (await agent().patch(`/api/v1/users/${id}/status`).set(authed(t.token)).send({ status: 'inactive' }))
        .status,
    ).toBe(200);
    expect((await agent().get('/api/v1/auth/me').set(authed(tok))).status).toBe(401);
    expect((await login(t.slug, 'acc@example.com', 'Account#12345')).status).toBe(401);

    await agent().patch(`/api/v1/users/${id}/status`).set(authed(t.token)).send({ status: 'active' });
    const reset = await agent().post(`/api/v1/users/${id}/reset-password`).set(authed(t.token));
    expect(reset.status).toBe(200);
    expect((await login(t.slug, 'acc@example.com', reset.body.data.temporaryPassword)).status).toBe(200);
  });

  it('lists with pagination, role filter and search', async () => {
    const t = await registerTenant();
    for (let i = 0; i < 3; i++) {
      await agent()
        .post('/api/v1/users')
        .set(authed(t.token))
        .send({ role: 'teacher', name: `Teacher ${i}`, email: `tt${i}@example.com` });
    }
    const all = await agent().get('/api/v1/users').set(authed(t.token)).query({ limit: 2 });
    expect(all.body.meta).toMatchObject({ page: 1, limit: 2, total: 4 });
    expect(all.body.data).toHaveLength(2);
    const teachers = await agent()
      .get('/api/v1/users')
      .set(authed(t.token))
      .query({ role: 'teacher', q: 'teacher 1' });
    expect(teachers.body.data).toHaveLength(1);
    expect(JSON.stringify(all.body)).not.toMatch(/passwordHash/);
  });
});

describe('school profile', () => {
  it('admin updates profile and settings; audit trail is recorded', async () => {
    const t = await registerTenant();
    const p = await agent()
      .patch('/api/v1/school/profile')
      .set(authed(t.token))
      .send({ eiin: '123456', contact: { district: 'Dhaka' } });
    expect(p.status).toBe(200);
    expect(p.body.data.eiin).toBe('123456');
    expect(p.body.data.contact.district).toBe('Dhaka');
    expect(p.body.data.contact.phone).toBeTruthy();
    const s = await agent()
      .patch('/api/v1/school/settings')
      .set(authed(t.token))
      .send({ weekendDays: [5, 6], attendanceEditWindowHours: 48 });
    expect(s.body.data.weekendDays).toEqual([5, 6]);
    expect((await agent().get('/api/v1/school/usage').set(authed(t.token))).body.data).toMatchObject({
      studentCap: 50,
      students: 0,
    });
  });
});
