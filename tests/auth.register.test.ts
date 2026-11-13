import { describe, expect, it, vi } from 'vitest';
import '../src/app/models';
import { AcademicSession } from '../src/app/modules/academicSession/academicSession.model';
import { FeeHead } from '../src/app/modules/feeHead/feeHead.model';
import { GradingScale } from '../src/app/modules/gradingScale/gradingScale.model';
import { Tenant } from '../src/app/modules/tenant/tenant.model';
import { User } from '../src/app/modules/user/user.model';
import { runAsTenant, runUnscoped } from '../src/app/lib/tenantContext';
import { agent, registerTenant } from './helpers/api';
import { useTestDb } from './helpers/db';

useTestDb();

describe('register-institution', () => {
  it('creates tenant, admin, session, grading scale and fee heads with a session cookie', async () => {
    const t = await registerTenant({ slug: 'brightModel', institutionType: 'school' });
    expect(t.slug).toBe('bright-model');
    expect(t.token).toBeTruthy();
    expect(t.cookie.join(';')).toMatch(/refreshToken=.*HttpOnly/i);

    const tenant = await Tenant.findOne({ slug: 'bright-model' });
    expect(tenant?.status).toBe('trial');
    expect(tenant?.studentCap).toBe(50); // Free plan's cap; a new self-service signup always starts on Free
    const daysLeft = Math.round((tenant!.trialEndsAt.getTime() - Date.now()) / 86_400_000);
    expect(daysLeft).toBeGreaterThanOrEqual(14);
    expect(daysLeft).toBeLessThanOrEqual(15);
    expect(tenant?.settings.terminology.class.en).toBe('Class');

    await runAsTenant(tenant!._id, async () => {
      expect(await User.countDocuments({ role: 'admin' })).toBe(1);
      expect(await AcademicSession.countDocuments({ isCurrent: true })).toBe(1);
      expect(await GradingScale.countDocuments({ isDefault: true })).toBe(1);
      expect(await FeeHead.countDocuments({})).toBe(4);
    });
  });

  it('seeds coaching terminology and fee heads', async () => {
    await registerTenant({ slug: 'topscore-coaching', institutionType: 'coaching' });
    const tenant = await Tenant.findOne({ slug: 'topscore-coaching' });
    expect(tenant?.settings.terminology.class.en).toBe('Batch');
    await runAsTenant(tenant!._id, async () => {
      const codes = (await FeeHead.find({}).lean()).map((f) => f.code).sort();
      expect(codes).toEqual(['ADMISSION', 'COURSE', 'MATERIAL']);
    });
  });

  it('rejects reserved, invalid and duplicate slugs with clear codes', async () => {
    const body = (slug: string, email: string) => ({
      institutionName: 'X School',
      institutionType: 'school',
      slug,
      phone: '01712345678',
      adminName: 'A B',
      adminEmail: email,
      password: 'Passw0rd!long',
    });
    const reserved = await agent()
      .post('/api/v1/auth/register-institution')
      .send(body('admin', 'r1@example.com'));
    expect(reserved.status).toBe(400);
    expect(reserved.body.code).toBe('SLUG_RESERVED');
    const invalid = await agent()
      .post('/api/v1/auth/register-institution')
      .send(body('a!', 'r2@example.com'));
    expect(invalid.body.code).toBe('SLUG_INVALID');

    await registerTenant({ slug: 'unique-school' });
    const dup = await agent()
      .post('/api/v1/auth/register-institution')
      .send(body('uniqueSchool', 'r3@example.com'));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('SLUG_TAKEN');
  });

  it('rejects unknown fields and weak passwords', async () => {
    const res = await agent().post('/api/v1/auth/register-institution').send({
      institutionName: 'X',
      institutionType: 'school',
      slug: 'xx-school',
      phone: '123',
      adminName: 'A',
      adminEmail: 'nope',
      password: 'short',
      tenantId: 'abc',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('leaves nothing behind when seeding fails midway', async () => {
    const spy = vi.spyOn(FeeHead, 'create').mockRejectedValueOnce(new Error('boom'));
    const res = await agent().post('/api/v1/auth/register-institution').send({
      institutionName: 'Atomic School',
      institutionType: 'school',
      slug: 'atomic-school',
      phone: '01712345679',
      adminName: 'Ab Cd',
      adminEmail: 'atomic@example.com',
      password: 'Passw0rd!long',
    });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await Tenant.countDocuments({ slug: 'atomic-school' })).toBe(0);
    expect(await runUnscoped(() => User.countDocuments({ email: 'atomic@example.com' }))).toBe(0);
  });

  it('reports slug availability with the normalized value', async () => {
    const res = await agent().get('/api/v1/auth/slug-available').query({ slug: 'Fresh School' });
    expect(res.body.data).toEqual({ normalized: 'fresh-school', available: true });
    const taken = await agent().get('/api/v1/auth/slug-available').query({ slug: 'unique school' });
    expect(taken.body.data).toMatchObject({ available: false, reason: 'SLUG_TAKEN' });
  });
});
