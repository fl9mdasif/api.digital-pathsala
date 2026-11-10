import { z } from 'zod';
import { isValidLocalDate } from '../../lib/localDate';
import { objectIdSchema } from '../../lib/objectId';

const date = z.string().refine(isValidLocalDate, 'Use YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

export const listQuery = z.strictObject({
  examId: objectIdSchema,
  classId: objectIdSchema.optional(),
  sectionId: objectIdSchema.optional(),
});

export const entryBody = z.strictObject({
  examId: objectIdSchema,
  classId: objectIdSchema,
  sectionId: objectIdSchema.optional(),
  subjectId: objectIdSchema,
  date,
  startTime: hhmm,
  endTime: hhmm,
  room: z.string().trim().max(40).optional(),
});
