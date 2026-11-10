import { z } from 'zod';
import { objectIdSchema } from '../../lib/objectId';

export const MAX_CARDS = 200;

export const configBody = z.strictObject({
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1b4b8a'),
  validityYears: z.number().int().min(1).max(10),
  signatureTitle: z.string().trim().max(40),
  showGuardianPhone: z.boolean(),
  footerNote: z.string().trim().max(80),
});

export const printQuery = z
  .strictObject({
    sectionId: objectIdSchema.optional(),
    /** Comma separated student ids, at most MAX_CARDS. */
    studentIds: z
      .string()
      .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
      .pipe(z.array(objectIdSchema).min(1).max(MAX_CARDS))
      .optional(),
    locale: z.enum(['bn', 'en']).default('bn'),
  })
  .refine((q) => !!q.sectionId || !!q.studentIds, { message: 'Choose a section or some students' });
