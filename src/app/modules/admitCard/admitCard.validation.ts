import { z } from 'zod';
import { mediaUrl } from '../../lib/mediaUrl';
import { objectIdSchema } from '../../lib/objectId';
import { MAX_CARDS } from '../idCard/idCard.validation';
import { ADMIT_DESIGNS, ADMIT_SHOW_KEYS } from './admitCard.model';

export const configBody = z.strictObject({
  signatureTitle: z.string().trim().max(40),
  instructions: z.string().trim().max(300),
  blockIfDue: z.boolean(),
  maxDueAllowed: z.number().int().min(0).max(100_000_000),
  design: z.enum(ADMIT_DESIGNS),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1b4b8a'),
  perPage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  show: z.strictObject(Object.fromEntries(ADMIT_SHOW_KEYS.map((k) => [k, z.boolean()])) as Record<(typeof ADMIT_SHOW_KEYS)[number], z.ZodBoolean>),
  sigClassTeacherLabel: z.string().trim().max(40),
  sigAccountsLabel: z.string().trim().max(40),
  signatureUrl: z.union([z.literal(''), mediaUrl]),
  qrData: z.string().trim().max(300),
});

const target = {
  examId: objectIdSchema,
  sectionId: objectIdSchema.optional(),
  /** Comma separated student ids, at most MAX_CARDS. */
  studentIds: z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(objectIdSchema).min(1).max(MAX_CARDS))
    .optional(),
};
const hasTarget = (q: { sectionId?: string; studentIds?: string[] }) => !!q.sectionId || !!q.studentIds;
const needTarget = { message: 'Choose a section or some students' };

export const eligibilityQuery = z.strictObject(target).refine(hasTarget, needTarget);

export const printQuery = z
  .strictObject({
    ...target,
    examId: objectIdSchema.optional(),
    locale: z.enum(['bn', 'en']).default('bn'),
    /** Print cards even for students blocked by overdue fees (only if the exam's rule lets an admin). */
    includeBlocked: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    /** Overrides the saved design and cards per page, for trying the others. */
    design: z.enum(ADMIT_DESIGNS).optional(),
    perPage: z.enum(['1', '2', '3']).transform(Number).optional(),
    /** Print one card with made-up details and a made-up routine, for the settings preview. */
    sample: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  })
  .refine((q) => q.sample || (!!q.examId && hasTarget(q)), { message: 'Choose an exam and a section or some students' });

export const lockRuleParams = z.strictObject({ examId: objectIdSchema });
export const lockRuleBody = z.strictObject({
  active: z.boolean(),
  maxDueAllowed: z.number().int().min(0).max(100_000_000),
  feeHeadIds: z.array(objectIdSchema).max(50),
  adminCanPrint: z.boolean(),
});

export const meParams = z.strictObject({ examId: objectIdSchema, studentId: objectIdSchema });
export const meQuery = z.strictObject({ locale: z.enum(['bn', 'en']).default('bn') });
