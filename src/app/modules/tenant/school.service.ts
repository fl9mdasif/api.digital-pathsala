import { AppError } from '../../errors/AppError';
import { clearPublicCaches } from '../../lib/publicCache';

import { requireTenantId } from '../../lib/tenantContext';
import { writeAudit } from '../auditLog/auditLog.model';
import { Plan } from '../plan/plan.model';
import { User } from '../user/user.model';
import { effectiveStatus } from './tenant.cache';
import { Tenant } from './tenant.model';

const load = async () => {
  const t = await Tenant.findById(requireTenantId());
  if (!t) throw AppError.notFound('Institution not found');
  return t;
};

export const getProfile = async () => {
  const t = await load();
  return {
    id: t._id,
    name: t.name,
    nameBn: t.nameBn,
    slug: t.slug,
    institutionType: t.institutionType,
    status: effectiveStatus(t),
    contact: t.contact,
    eiin: t.eiin,
    logoUrl: t.logoUrl,
    settings: t.settings,
  };
};

export const updateProfile = async (patch: Record<string, any>) => {
  const t = await load();
  const before = { name: t.name, contact: t.contact, eiin: t.eiin };
  for (const k of ['name', 'nameBn', 'logoUrl', 'eiin'] as const)
    if (patch[k] !== undefined) (t as any)[k] = patch[k];
  if (patch.contact) t.contact = { ...((t.contact as any).toObject?.() ?? t.contact), ...patch.contact };
  await t.save();
  clearPublicCaches();
  await writeAudit({
    action: 'school.profile_update',
    entityType: 'Tenant',
    entityId: t._id,
    before,
    after: { name: t.name, contact: t.contact, eiin: t.eiin },
  });
  return getProfile();
};

export const updateSettings = async (patch: Record<string, any>) => {
  const t = await load();
  const before = { ...(t.settings as any).toObject?.() };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) (t.settings as any)[k] = v;
  await t.save();
  clearPublicCaches();
  await writeAudit({
    action: 'school.settings_update',
    entityType: 'Tenant',
    entityId: t._id,
    before: { ...before, terminology: undefined },
    after: patch,
  });
  return (await getProfile()).settings;
};

/** Student count is filled in once the student module exists (counted through the registry hook). */
export const studentCounter: { count: () => Promise<number> } = { count: async () => 0 };

export const getUsage = async () => {
  const t = await load();
  const plan = await Plan.findById(t.planId).lean();
  return {
    students: await studentCounter.count(),
    studentCap: t.studentCap,
    staff: await User.countDocuments({ role: { $in: ['admin', 'teacher', 'accountant'] }, status: 'active' }),
    plan: plan ? { code: plan.slug, name: plan.name } : null,
    status: effectiveStatus(t),
    trialEndsAt: t.trialEndsAt,
  };
};
