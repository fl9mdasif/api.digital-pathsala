import { z } from 'zod';
import { isValidLocalDate } from '../../lib/localDate';
import { objectIdSchema } from '../../lib/objectId';

const date = z.string().refine(isValidLocalDate, 'Use YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
const status = z.enum(['present', 'absent', 'late', 'leave', 'half_day']);

export const sheetQuery = z.strictObject({ date });

export const submitBody = z.strictObject({
  date,
  records: z
    .array(
      z.strictObject({
        employeeId: objectIdSchema,
        status,
        checkIn: hhmm.optional(),
        checkOut: hhmm.optional(),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(500),
  /** Needed to record attendance on a weekend day. */
  allowWeekend: z.boolean().default(false),
});

export const reportQuery = z.strictObject({ from: date, to: date, employeeId: objectIdSchema.optional() });
export const meQuery = z.strictObject({ from: date, to: date });

export const configBody = z.strictObject({
  inTime: hhmm,
  outTime: hhmm,
  graceMinutes: z.number().int().min(0).max(120),
});
