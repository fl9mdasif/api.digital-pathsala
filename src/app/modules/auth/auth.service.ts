import { Types } from 'mongoose';
import { AppError } from '../../errors/AppError';
import { hashPassword, verifyPassword } from '../../lib/password';
import { normalizeBdPhone } from '../../lib/phone';
import { runAsTenant } from '../../lib/tenantContext';
import { normalizeSlug } from '../slug/slug.helper';
import { PlatformAdmin } from '../platform/platformAdmin.model';
import { Plan } from '../plan/plan.model';
import { effectiveStatus } from '../tenant/tenant.cache';
import { Tenant } from '../tenant/tenant.model';
import { User } from '../user/user.model';
import type { IUser } from '../user/user.interface';

type IUserDoc = IUser & { _id: Types.ObjectId };
import { revokeAllForUser, rotateSession, startSession } from './session.service';

const MAX_FAILS = 8;
const LOCK_MS = 15 * 60_000;
const GENERIC = () => AppError.unauthorized('Invalid login details', 'INVALID_CREDENTIALS');

// Verified against when the account does not exist, so response time does not reveal which accounts exist.
let dummyHash: string | undefined;
const burnTime = async (password: string) => {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(dummyHash, password);
};

export const findTenantBySlug = async (rawSlug: string) => {
  const slug = normalizeSlug(rawSlug);
  const now = new Date();
  const t =
    (await Tenant.findOne({ slug })) ??
    (await Tenant.findOne({ slugAliases: { $elemMatch: { slug, expiresAt: { $gt: now } } } }));
  return t;
};

const identifierQuery = (identifier: string): Record<string, unknown> => {
  if (identifier.includes('@')) return { email: identifier.toLowerCase() };
  const phone = normalizeBdPhone(identifier);
  if (phone) return { phone, role: { $ne: 'student' } };
  return { studentLoginId: identifier };
};

export const loginUser = async (
  input: { tenantSlug: string; identifier: string; password: string },
  userAgent?: string,
) => {
  const tenant = await findTenantBySlug(input.tenantSlug);
  if (!tenant) {
    await burnTime(input.password);
    throw GENERIC();
  }

  return runAsTenant(tenant._id, async () => {
    const user = (await User.findOne(identifierQuery(input.identifier)).select(
      '+passwordHash',
    )) as IUserDoc | null;
    if (!user || user.status !== 'active') {
      await burnTime(input.password);
      throw GENERIC();
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await burnTime(input.password);
      throw GENERIC();
    }

    const okPassword = await verifyPassword(user.passwordHash, input.password);
    if (!okPassword) {
      const fails = (user.failedLoginCount ?? 0) + 1;
      await User.updateOne(
        { _id: user._id },
        fails >= MAX_FAILS
          ? { $set: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } }
          : { $set: { failedLoginCount: fails } },
      );
      throw GENERIC();
    }

    const status = effectiveStatus(tenant);
    if (status === 'cancelled')
      throw AppError.forbidden('This institution account is closed', 'TENANT_SUSPENDED');
    if (status === 'suspended' && user.role !== 'admin') {
      throw AppError.forbidden(
        'This institution is suspended. Please contact the school office.',
        'TENANT_SUSPENDED',
      );
    }

    await User.updateOne(
      { _id: user._id },
      { $set: { failedLoginCount: 0, lastLoginAt: new Date() }, $unset: { lockedUntil: 1 } },
    );
    const session = await startSession(
      { userId: user._id, tenantId: tenant._id, role: user.role },
      userAgent,
    );
    return {
      session,
      user: { id: user._id, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword },
    };
  });
};

export const loginPlatformAdmin = async (input: { email: string; password: string }, userAgent?: string) => {
  const admin = await PlatformAdmin.findOne({ email: input.email }).select('+passwordHash');
  if (
    !admin ||
    admin.status !== 'active' ||
    (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now())
  ) {
    await burnTime(input.password);
    throw GENERIC();
  }
  if (!(await verifyPassword(admin.passwordHash, input.password))) {
    const fails = (admin.failedLoginCount ?? 0) + 1;
    await PlatformAdmin.updateOne(
      { _id: admin._id },
      fails >= MAX_FAILS
        ? { $set: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } }
        : { $set: { failedLoginCount: fails } },
    );
    throw GENERIC();
  }
  await PlatformAdmin.updateOne(
    { _id: admin._id },
    { $set: { failedLoginCount: 0, lastLoginAt: new Date() }, $unset: { lockedUntil: 1 } },
  );
  const session = await startSession({ userId: admin._id, role: 'superAdmin' }, userAgent);
  return { session, user: { id: admin._id, name: admin.name, role: 'superAdmin' as const } };
};

export const refreshSession = async (token: string, userAgent?: string) => {
  const rotated = await rotateSession(token, userAgent);
  const { userId, tenantId, userType } = rotated.subject;

  if (userType === 'platformAdmin') {
    const admin = await PlatformAdmin.findById(userId);
    if (!admin || admin.status !== 'active')
      throw AppError.unauthorized('Session expired, please sign in again', 'SESSION_INVALID');
    return rotated.build('superAdmin');
  }

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw AppError.unauthorized('Session expired, please sign in again', 'SESSION_INVALID');
  return runAsTenant(tenant._id, async () => {
    const user = await User.findById(userId);
    if (!user || user.status !== 'active')
      throw AppError.unauthorized('Session expired, please sign in again', 'SESSION_INVALID');
    const status = effectiveStatus(tenant);
    if (status === 'cancelled' || (status === 'suspended' && user.role !== 'admin')) {
      throw AppError.forbidden(
        'This institution is suspended. Please contact the school office.',
        'TENANT_SUSPENDED',
      );
    }
    return rotated.build(user.role);
  });
};

export const getMe = async (auth: {
  userId: Types.ObjectId;
  tenantId?: Types.ObjectId;
  role: string;
  isPlatform: boolean;
}) => {
  if (auth.isPlatform) {
    const admin = await PlatformAdmin.findById(auth.userId);
    if (!admin) throw AppError.unauthorized();
    return { user: { id: admin._id, name: admin.name, email: admin.email, role: 'superAdmin' } };
  }
  const tenant = await Tenant.findById(auth.tenantId);
  if (!tenant) throw AppError.unauthorized();
  const plan = await Plan.findById(tenant.planId).lean();
  return runAsTenant(tenant._id, async () => {
    const user = await User.findById(auth.userId);
    if (!user) throw AppError.unauthorized();
    return {
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        email: user.email,
        phone: user.phone,
        mustChangePassword: user.mustChangePassword,
      },
      tenant: {
        id: tenant._id,
        name: tenant.name,
        slug: tenant.slug,
        institutionType: tenant.institutionType,
        status: effectiveStatus(tenant),
        trialEndsAt: tenant.trialEndsAt,
        terminology: tenant.settings.terminology,
        settings: {
          locale: tenant.settings.locale,
          weekendDays: tenant.settings.weekendDays,
          defaultFeeCycle: tenant.settings.defaultFeeCycle,
        },
        plan: plan
          ? { code: plan.slug, name: plan.name, features: plan.features, studentCap: tenant.studentCap }
          : null,
      },
    };
  });
};

export const changePassword = async (
  auth: { userId: Types.ObjectId; tenantId?: Types.ObjectId; role: string; isPlatform: boolean },
  input: { oldPassword: string; newPassword: string },
  userAgent?: string,
) => {
  if (input.oldPassword === input.newPassword)
    throw AppError.badRequest('New password must differ from the old one');
  const apply = async (model: typeof User | typeof PlatformAdmin) => {
    const doc: any = await (model as any).findById(auth.userId).select('+passwordHash');
    if (!doc || !(await verifyPassword(doc.passwordHash, input.oldPassword))) {
      throw AppError.badRequest('Old password is incorrect', undefined, 'INVALID_CREDENTIALS');
    }
    const passwordHash = await hashPassword(input.newPassword);
    await (model as any).updateOne({ _id: doc._id }, { $set: { passwordHash, mustChangePassword: false } });
  };
  if (auth.isPlatform) await apply(PlatformAdmin);
  else await apply(User);
  await revokeAllForUser(auth.userId);
  return startSession({ userId: auth.userId, tenantId: auth.tenantId, role: auth.role as any }, userAgent);
};
