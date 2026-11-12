import { describe, expect, it } from 'vitest';
import '../src/app/models';
import { RefreshToken } from '../src/app/modules/auth/refreshToken.model';
import { runUnscoped } from '../src/app/lib/tenantContext';
import { User } from '../src/app/modules/user/user.model';
import { agent, authed, login, registerTenant } from './helpers/api';
import { useTestDb } from './helpers/db';

useTestDb();

const cookieOf = (res: { headers: Record<string, any> }) =>
  (res.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ');

describe('login', () => {
  it('signs in with email and returns an access token plus an httpOnly refresh cookie', async () => {
    const t = await registerTenant();
    const res = await login(t.slug, t.email, t.password);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.role).toBe('admin');
    expect((res.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(/HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });

  it('signs in with phone as well', async () => {
    const t = await registerTenant({ phone: '01755555555' });
    const res = await login(t.slug, '+8801755555555', t.password);
    expect(res.status).toBe(200);
  });

  it('returns the same generic error for wrong slug, wrong password and unknown user', async () => {
    const t = await registerTenant();
    const wrongPass = await login(t.slug, t.email, 'WrongPass123!');
    const wrongSlug = await login('no-such-school', t.email, t.password);
    const unknown = await login(t.slug, 'nobody@example.com', t.password);
    for (const r of [wrongPass, wrongSlug, unknown]) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid login details',
      });
    }
  });

  it('treats an inactive user like a wrong password', async () => {
    const t = await registerTenant();
    await runUnscoped(() => User.updateOne({ email: t.email }, { $set: { status: 'inactive' } }));
    const r = await login(t.slug, t.email, t.password);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks the account for 15 minutes after 8 consecutive failures, even with the right password', async () => {
    const t = await registerTenant();
    for (let i = 0; i < 8; i++) await login(t.slug, t.email, 'bad-password-1');
    const r = await login(t.slug, t.email, t.password);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('refresh rotation', () => {
  it('rotates the refresh token and rejects the old one, revoking the family on reuse', async () => {
    const t = await registerTenant();
    const first = await login(t.slug, t.email, t.password);
    const c1 = cookieOf(first);

    const second = await agent()
      .post('/api/v1/auth/refresh')
      .set('X-Requested-With', 'fetch')
      .set('Cookie', c1);
    expect(second.status).toBe(200);
    expect(second.body.data.accessToken).toBeTruthy();
    const c2 = cookieOf(second);
    expect(c2).not.toBe(c1);

    // old token reused -> whole family revoked
    const reuse = await agent()
      .post('/api/v1/auth/refresh')
      .set('X-Requested-With', 'fetch')
      .set('Cookie', c1);
    expect(reuse.status).toBe(401);
    const afterReuse = await agent()
      .post('/api/v1/auth/refresh')
      .set('X-Requested-With', 'fetch')
      .set('Cookie', c2);
    expect(afterReuse.status).toBe(401);
  });

  it('requires the custom header (CSRF guard) and a cookie', async () => {
    const t = await registerTenant();
    const first = await login(t.slug, t.email, t.password);
    const noHeader = await agent().post('/api/v1/auth/refresh').set('Cookie', cookieOf(first));
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.code).toBe('CSRF_BLOCKED');
    const noCookie = await agent().post('/api/v1/auth/refresh').set('X-Requested-With', 'fetch');
    expect(noCookie.status).toBe(401);
  });

  it('only one of two parallel refreshes with the same token succeeds', async () => {
    const t = await registerTenant();
    const c = cookieOf(await login(t.slug, t.email, t.password));
    const [a, b] = await Promise.all([
      agent().post('/api/v1/auth/refresh').set('X-Requested-With', 'fetch').set('Cookie', c),
      agent().post('/api/v1/auth/refresh').set('X-Requested-With', 'fetch').set('Cookie', c),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
  });

  it('logout revokes the family', async () => {
    const t = await registerTenant();
    const c = cookieOf(await login(t.slug, t.email, t.password));
    await agent().post('/api/v1/auth/logout').set('Cookie', c);
    const r = await agent().post('/api/v1/auth/refresh').set('X-Requested-With', 'fetch').set('Cookie', c);
    expect(r.status).toBe(401);
  });

  it('stores refresh tokens hashed', async () => {
    const t = await registerTenant();
    const res = await login(t.slug, t.email, t.password);
    const raw = cookieOf(res).split('=')[1];
    const rows = await RefreshToken.find({}).lean();
    expect(rows.some((r) => r.tokenHash === raw)).toBe(false);
  });
});

describe('me', () => {
  it('returns the user and tenant summary including terminology and plan flags', async () => {
    const t = await registerTenant({ institutionType: 'madrasa' });
    const res = await agent().get('/api/v1/auth/me').set(authed(t.token));
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('admin');
    expect(res.body.data.tenant).toMatchObject({ slug: t.slug, institutionType: 'madrasa', status: 'trial' });
    expect(res.body.data.tenant.terminology.teacher.en).toBe('Ustad');
    expect(Array.isArray(res.body.data.tenant.plan.features)).toBe(true);
    expect(res.body.data.tenant.plan.code).toBe('free');
  });

  it('rejects missing and garbage tokens', async () => {
    expect((await agent().get('/api/v1/auth/me')).status).toBe(401);
    expect((await agent().get('/api/v1/auth/me').set(authed('garbage'))).status).toBe(401);
  });
});
