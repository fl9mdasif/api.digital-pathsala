import { z } from 'zod';
import { isValidLocalDate } from '../../lib/localDate';
import { mediaUrl } from '../../lib/mediaUrl';
import { objectIdSchema } from '../../lib/objectId';
import { paginationQuery } from '../../lib/pagination';
import { CERTIFICATE_LAYOUTS, CERTIFICATE_SHOW_KEYS } from './certificate.model';

export const MAX_ISSUE = 100;

export const configBody = z.strictObject({
  language: z.enum(['bn', 'en']),
  title: z.string().trim().max(80),
  subTitle: z.string().trim().max(120),
  bodyTemplate: z.string().trim().max(2000),
  layout: z.enum(CERTIFICATE_LAYOUTS),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #14532d'),
  show: z.strictObject(Object.fromEntries(CERTIFICATE_SHOW_KEYS.map((k) => [k, z.boolean()])) as Record<(typeof CERTIFICATE_SHOW_KEYS)[number], z.ZodBoolean>),
  sigLeftLabel: z.string().trim().max(40),
  sigRightLabel: z.string().trim().max(40),
  signatureUrl: z.union([z.literal(''), mediaUrl]),
});

const date = z.string().refine(isValidLocalDate, 'Use YYYY-MM-DD');

export const candidatesQuery = z.strictObject({
  sessionId: objectIdSchema,
  classId: objectIdSchema,
  sectionId: objectIdSchema.optional(),
  /** A published exam of that session whose GPA prints on the certificate. */
  examId: objectIdSchema.optional(),
});

export const issueBody = z.strictObject({
  issueDate: date,
  examId: objectIdSchema.optional(),
  items: z
    .array(z.strictObject({ enrolmentId: objectIdSchema, gpa: z.string().trim().max(10).optional(), letter: z.string().trim().max(10).optional() }))
    .min(1)
    .max(MAX_ISSUE),
});

export const updateBody = z
  .strictObject({
    gpa: z.string().trim().max(10).optional(),
    letter: z.string().trim().max(10).optional(),
    issueDate: date.optional(),
    status: z.enum(['issued', 'cancelled']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });

export const idParams = z.strictObject({ id: objectIdSchema });

export const listQuery = z.strictObject({
  ...paginationQuery,
  search: z.string().trim().max(60).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  status: z.enum(['issued', 'cancelled']).optional(),
});

const idList = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(objectIdSchema).min(1).max(MAX_ISSUE));

export const printQuery = z
  .strictObject({
    ids: idList.optional(),
    sample: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    layout: z.enum(CERTIFICATE_LAYOUTS).optional(),
    locale: z.enum(['bn', 'en']).optional(),
  })
  .refine((q) => q.sample || !!q.ids, { message: 'Choose certificates to print' });
