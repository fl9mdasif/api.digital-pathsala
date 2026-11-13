import { Types } from 'mongoose';
import { AppError } from '../../errors/AppError';
import { hashPassword } from '../../lib/password';
import { withTransaction } from '../../lib/transaction';
import { runAsTenant } from '../../lib/tenantContext';
import { todayLocal } from '../../lib/localDate';
import { AcademicSession } from '../academicSession/academicSession.model';
import { FeeHead } from '../feeHead/feeHead.model';
import { GradingScale } from '../gradingScale/gradingScale.model';
import { gradingPresetFor } from '../gradingScale/gradingScale.presets';
import { Plan } from '../plan/plan.model';
import { seedPlans } from '../plan/plan.seed';
import { checkSlug } from '../slug/slug.service';
import { PRESETS } from '../tenant/tenant.presets';
import { Tenant } from '../tenant/tenant.model';
import { User } from '../user/user.model';
import { writeAudit } from '../auditLog/auditLog.model';
import { startSession } from './session.service';

export interface RegisterInput {
  institutionName: string;
  institutionNameBn?: string;
  institutionType: 'school' | 'madrasa' | 'coaching';
  slug: string;
  phone: string;
  district?: string;
  adminName: string;
  adminEmail: string;
  password: string;
}

// A new self-service signup always starts on Free. Its trial length comes from the plan's own
// trialDays so the two can never drift apart; the student cap has no field on Plan, so it is set here.
const FREE_PLAN_STUDENT_CAP = 50;
const FALLBACK_TRIAL_DAYS = 15;

/**
 * Creates tenant, admin and defaults in one transaction. Any failure leaves nothing behind.
 */
export const registerInstitution = async (input: RegisterInput, userAgent?: string) => {
  const slugCheck = await checkSlug(input.slug);
  if (!slugCheck.available) {
    const status = slugCheck.reason === 'SLUG_TAKEN' ? 409 : 400;
    throw new AppError(
      status,
      slugCheck.reason!,
      `Slug "${slugCheck.normalized}" cannot be used (${slugCheck.reason})`,
    );
  }
  const slug = slugCheck.normalized;

  let plan = await Plan.findOne({ slug: 'free' });
  if (!plan) {
    await seedPlans();
    plan = await Plan.findOne({ slug: 'free' });
  }
  if (!plan) throw new AppError(500, 'INTERNAL_ERROR', 'Plans are not configured');
  const trialDays = plan.trialDays && plan.trialDays > 0 ? plan.trialDays : FALLBACK_TRIAL_DAYS;

  const preset = PRESETS[input.institutionType];
  const passwordHash = await hashPassword(input.password);
  const tenantId = new Types.ObjectId();
  const year = Number(todayLocal().slice(0, 4));

  try {
    const adminId = await withTransaction(async (session) => {
      await Tenant.create(
        [
          {
            _id: tenantId,
            name: input.institutionName,
            nameBn: input.institutionNameBn,
            slug,
            institutionType: input.institutionType,
            status: 'trial',
            trialEndsAt: new Date(Date.now() + trialDays * 86_400_000),
            planId: plan!._id,
            studentCap: FREE_PLAN_STUDENT_CAP,
            contact: { phone: input.phone, email: input.adminEmail, district: input.district },
            settings: { defaultFeeCycle: preset.defaultFeeCycle, terminology: preset.terminology },
          },
        ],
        { session },
      );

      return runAsTenant(tenantId, async () => {
        const [admin] = await User.create(
          [
            {
              role: 'admin',
              name: input.adminName,
              email: input.adminEmail,
              phone: input.phone,
              passwordHash,
            },
          ],
          { session },
        );
        await AcademicSession.create(
          [{ name: String(year), startDate: `${year}-01-01`, endDate: `${year}-12-31`, isCurrent: true }],
          { session },
        );
        const g = gradingPresetFor(preset.gradingPreset);
        await GradingScale.create([{ ...g, isDefault: true }], { session });
        await FeeHead.create(preset.feeHeads, { session, ordered: true });
        await writeAudit({
          actorId: admin._id,
          actorRole: 'admin',
          action: 'tenant.register',
          entityType: 'Tenant',
          entityId: tenantId,
          session,
        });
        return admin._id;
      });
    });

    const issued = await startSession({ userId: adminId, tenantId, role: 'admin' }, userAgent);
    return { tenant: { id: tenantId, slug, name: input.institutionName }, userId: adminId, session: issued };
  } catch (err: any) {
    if (err?.code === 11000 && JSON.stringify(err.keyPattern ?? {}).includes('slug')) {
      throw AppError.conflict('That slug was just taken, choose another', 'SLUG_TAKEN');
    }
    throw err;
  }
};
