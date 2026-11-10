import { Types } from 'mongoose';
import { AppError } from '../../errors/AppError';
import { clearPublicCaches } from '../../lib/publicCache';

import { escapeRegex, toSkip, type PageParams } from '../../lib/pagination';
import { runAsTenant, runUnscoped } from '../../lib/tenantContext';
import { writeAudit } from '../auditLog/auditLog.model';
import { Plan } from '../plan/plan.model';
import { checkSlug } from '../slug/slug.service';
import { invalidateTenantStatus, effectiveStatus } from '../tenant/tenant.cache';
import { Tenant } from '../tenant/tenant.model';
import { User } from '../user/user.model';
import { SubscriptionPayment } from './subscriptionPayment.model';

/** Hook so later phases can add their own collection counts without this file importing them. */
export const usageCounters: Record<string, () => Promise<number>> = {};

const audit = (
  tenantId: Types.ObjectId,
  actorId: Types.ObjectId,
  action: string,
  extra: { before?: unknown; after?: unknown; reason?: string },
) =>
  writeAudit({
    tenantId,
    actorId,
    actorRole: 'superAdmin',
    action,
    entityType: 'Tenant',
    entityId: tenantId,
    ...extra,
  });

const mustFind = async (id: string) => {
  const t = await Tenant.findById(id);
  if (!t) throw AppError.notFound('Tenant not found');
  return t;
};

const summary = (t: any) => ({
  id: t._id,
  name: t.name,
  slug: t.slug,
  institutionType: t.institutionType,
  status: t.status,
  effectiveStatus: effectiveStatus(t),
  trialEndsAt: t.trialEndsAt,
  planId: t.planId,
  studentCap: t.studentCap,
  contact: t.contact,
  createdAt: t.createdAt,
});

export const listTenants = async (page: PageParams, f: { status?: string; type?: string; q?: string }) => {
  const filter: Record<string, unknown> = {};
  if (f.status) filter.status = f.status;
  if (f.type) filter.institutionType = f.type;
  if (f.q) {
    const re = new RegExp(escapeRegex(f.q), 'i');
    filter.$or = [{ name: re }, { slug: re }];
  }
  const [rows, total] = await Promise.all([
    Tenant.find(filter).sort({ createdAt: -1 }).skip(toSkip(page)).limit(page.limit).lean(),
    Tenant.countDocuments(filter),
  ]);
  return { rows: rows.map(summary), total };
};

export const getTenantDetail = async (id: string) => {
  const t = await mustFind(id);
  const plan = await Plan.findById(t.planId).lean();
  const usage = await runAsTenant(t._id, async () => {
    const counts: Record<string, number> = {
      staff: await User.countDocuments({ role: { $in: ['admin', 'teacher', 'accountant'] } }),
    };
    for (const [k, fn] of Object.entries(usageCounters)) counts[k] = await fn();
    return counts;
  });
  const payments = await SubscriptionPayment.find({ tenantId: t._id })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  return { ...summary(t), nameBn: t.nameBn, eiin: t.eiin, plan, usage, subscriptionPayments: payments };
};

export const setTenantStatus = async (
  id: string,
  actorId: Types.ObjectId,
  input: { status: 'active' | 'suspended' | 'cancelled'; reason: string },
) => {
  const t = await mustFind(id);
  const before = { status: t.status };
  t.status = input.status;
  t.suspendedAt = input.status === 'suspended' ? new Date() : undefined;
  await t.save();
  clearPublicCaches();
  invalidateTenantStatus(t._id);
  await audit(
    t._id,
    actorId,
    `tenant.${input.status === 'active' ? 'reactivate' : input.status === 'suspended' ? 'suspend' : 'cancel'}`,
    {
      before,
      after: { status: t.status },
      reason: input.reason,
    },
  );
  return summary(t);
};

export const setTenantPlan = async (
  id: string,
  actorId: Types.ObjectId,
  input: { planId?: string; studentCap?: number; extendTrialDays?: number },
) => {
  const t = await mustFind(id);
  const before = { planId: t.planId, studentCap: t.studentCap, trialEndsAt: t.trialEndsAt };
  if (input.planId) {
    const plan = await Plan.findById(input.planId);
    if (!plan || !plan.isActive) throw AppError.badRequest('Plan not found or inactive');
    t.planId = plan._id;
  }
  if (input.studentCap) t.studentCap = input.studentCap; // explicit override wins
  if (input.extendTrialDays) {
    const base = Math.max(t.trialEndsAt.getTime(), Date.now());
    t.trialEndsAt = new Date(base + input.extendTrialDays * 86_400_000);
  }
  await t.save();
  clearPublicCaches();
  invalidateTenantStatus(t._id);
  await audit(t._id, actorId, 'tenant.plan_change', {
    before,
    after: { planId: t.planId, studentCap: t.studentCap, trialEndsAt: t.trialEndsAt },
  });
  return summary(t);
};

export const changeSlug = async (
  id: string,
  actorId: Types.ObjectId,
  input: { slug: string; reason: string },
) => {
  const t = await mustFind(id);
  const check = await checkSlug(input.slug);
  if (!check.available)
    throw new AppError(
      check.reason === 'SLUG_TAKEN' ? 409 : 400,
      check.reason!,
      `Slug cannot be used (${check.reason})`,
    );
  const old = t.slug;
  t.slugAliases.push({ slug: old, expiresAt: new Date(Date.now() + 365 * 86_400_000) });
  t.slug = check.normalized;
  await t.save();
  clearPublicCaches();
  clearPublicCaches();
  await audit(t._id, actorId, 'tenant.slug_change', {
    before: { slug: old },
    after: { slug: t.slug },
    reason: input.reason,
  });
  return summary(t);
};

export const recordSubscriptionPayment = async (id: string, actorId: Types.ObjectId, input: any) => {
  const t = await mustFind(id);
  const plan = await Plan.findById(input.planId);
  if (!plan) throw AppError.badRequest('Plan not found');
  if (input.periodEnd <= input.periodStart) throw AppError.badRequest('periodEnd must be after periodStart');
  const row = await SubscriptionPayment.create({ ...input, tenantId: t._id, recordedBy: actorId });
  // A recorded payment moves trial and suspended tenants to active on the paid plan.
  if (t.status !== 'cancelled') {
    t.status = 'active';
    t.suspendedAt = undefined;
    t.planId = plan._id;
    await t.save();
    clearPublicCaches();
    invalidateTenantStatus(t._id);
  }
  await audit(t._id, actorId, 'tenant.subscription_payment', {
    after: { amount: input.amount, method: input.method, reference: input.reference },
  });
  return row;
};

export const listPlans = () => Plan.find({}).sort({ monthlyPrice: 1 }).lean();

export const createPlan = async (input: any) => {
  if (await Plan.exists({ slug: input.slug }))
    throw AppError.conflict('A plan with this slug already exists', 'DUPLICATE');
  return Plan.create(input);
};

export const updatePlan = async (id: string, input: any) => {
  const plan = await Plan.findByIdAndUpdate(id, { $set: input }, { returnDocument: 'after' });
  if (!plan) throw AppError.notFound('Plan not found');
  return plan;
};

export const getStats = async () => {
  const [byStatus, signups, userTotal] = await Promise.all([
    Tenant.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Tenant.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 8 * 7 * 86_400_000) } } },
      { $group: { _id: { $dateTrunc: { date: '$createdAt', unit: 'week' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    runUnscoped(() => User.countDocuments({})),
  ]);
  const extra: Record<string, number> = {};
  for (const [k, fn] of Object.entries(usageCounters)) extra[k] = await fn();
  return {
    tenantsByStatus: Object.fromEntries(byStatus.map((r: any) => [r._id, r.count])),
    signupsPerWeek: signups.map((r: any) => ({ weekStart: r._id, count: r.count })),
    users: userTotal,
    ...extra,
  };
};
