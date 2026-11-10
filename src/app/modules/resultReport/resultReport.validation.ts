import { z } from 'zod';
import { objectIdSchema } from '../../lib/objectId';

export const failListQuery = z.strictObject({
  classId: objectIdSchema.optional(),
  sectionId: objectIdSchema.optional(),
});

export const tabulationQuery = z.strictObject({
  classId: objectIdSchema,
  sectionId: objectIdSchema.optional(),
  locale: z.enum(['bn', 'en']).default('en'),
});
