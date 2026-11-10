import { z } from 'zod';
import { isValidLocalDate } from '../../lib/localDate';
import { objectIdSchema } from '../../lib/objectId';
import { paginationQuery } from '../../lib/pagination';

const date = z.string().refine(isValidLocalDate, 'Use YYYY-MM-DD');
const type = z.enum(['casual', 'sick', 'annual', 'maternity', 'unpaid']);
const allowance = z.number().int().min(0).max(365);

export const applyBody = z.strictObject({
  /** Required for an admin applying on behalf of someone; ignored for staff, who always apply for themselves. */
  employeeId: objectIdSchema.optional(),
  type,
  fromDate: date,
  toDate: date,
  reason: z.string().trim().max(500).optional(),
});

export const listQuery = z.strictObject({
  ...paginationQuery,
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  employeeId: objectIdSchema.optional(),
});

export const decisionBody = z.strictObject({
  status: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(300).optional(),
});

export const balanceQuery = z.strictObject({
  employeeId: objectIdSchema,
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const configBody = z.strictObject({
  casual: allowance,
  sick: allowance,
  annual: allowance,
  maternity: allowance,
});
