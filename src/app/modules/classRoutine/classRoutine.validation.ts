import { z } from 'zod';
import { objectIdSchema } from '../../lib/objectId';

const day = z.number().int().min(0).max(6);

export const sectionQuery = z.strictObject({ sectionId: objectIdSchema });

export const slotBody = z.strictObject({
  sectionId: objectIdSchema,
  day,
  periodId: objectIdSchema,
  subjectId: objectIdSchema,
  teacherId: objectIdSchema.optional(),
  room: z.string().trim().max(40).optional(),
});

export const slotKey = z.strictObject({ sectionId: objectIdSchema, day: z.coerce.number().int().min(0).max(6), periodId: objectIdSchema });
