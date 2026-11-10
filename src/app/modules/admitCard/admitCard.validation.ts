import { z } from 'zod';
import { objectIdSchema } from '../../lib/objectId';
import { MAX_CARDS } from '../idCard/idCard.validation';

export const configBody = z.strictObject({
  signatureTitle: z.string().trim().max(40),
  instructions: z.string().trim().max(300),
  blockIfDue: z.boolean(),
  maxDueAllowed: z.number().int().min(0).max(100_000_000),
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
    locale: z.enum(['bn', 'en']).default('bn'),
    /** Print cards even for students blocked by overdue fees. */
    includeBlocked: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  })
  .refine(hasTarget, needTarget);
