import { z } from 'zod';
import { isValidLocalDate } from '../../lib/localDate';
import { mediaUrl } from '../../lib/mediaUrl';
import { objectIdSchema } from '../../lib/objectId';
import { paginationQuery } from '../../lib/pagination';
import { TESTIMONIAL_LAYOUTS, TESTIMONIAL_SHOW_KEYS } from './testimonial.model';

export const MAX_ISSUE = 100;

export const configBody = z.strictObject({
  language: z.enum(['bn', 'en']),
  headerTitle: z.string().trim().max(80),
  subTitle: z.string().trim().max(120),
  bodyTemplate: z.string().trim().max(2000),
  layout: z.enum(TESTIMONIAL_LAYOUTS),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1b4b8a'),
  show: z.strictObject(Object.fromEntries(TESTIMONIAL_SHOW_KEYS.map((k) => [k, z.boolean()])) as Record<(typeof TESTIMONIAL_SHOW_KEYS)[number], z.ZodBoolean>),
  sigLeftLabel: z.string().trim().max(40),
  sigRightLabel: z.string().trim().max(40),
  signatureUrl: z.union([z.literal(''), mediaUrl]),
});

const text = (max: number) => z.string().trim().max(max).default('');
const detail = {
  exam: text(80),
  passingYear: text(10),
  gpa: text(10),
  boardRoll: text(30),
  boardReg: text(30),
  conduct: text(60),
  village: text(80),
  postOffice: text(80),
  upazila: text(80),
  district: text(80),
};
const date = z.string().refine(isValidLocalDate, 'Use YYYY-MM-DD');

export const issueBody = z.strictObject({
  issueDate: date,
  items: z.array(z.strictObject({ studentId: objectIdSchema, ...detail })).min(1).max(MAX_ISSUE),
});

const opt = (max: number) => z.string().trim().max(max).optional();
export const updateBody = z
  .strictObject({
    exam: opt(80),
    passingYear: opt(10),
    gpa: opt(10),
    boardRoll: opt(30),
    boardReg: opt(30),
    conduct: opt(60),
    village: opt(80),
    postOffice: opt(80),
    upazila: opt(80),
    district: opt(80),
    issueDate: date.optional(),
    status: z.enum(['issued', 'cancelled']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });

export const idParams = z.strictObject({ id: objectIdSchema });

export const candidatesQuery = z.strictObject({ sectionId: objectIdSchema });

export const listQuery = z.strictObject({
  ...paginationQuery,
  search: z.string().trim().max(60).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  exam: z.string().trim().max(80).optional(),
  status: z.enum(['issued', 'cancelled']).optional(),
});

const idList = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(objectIdSchema).min(1).max(MAX_ISSUE));

/** Print some issued testimonials, or one sample with made-up details for the settings preview. */
export const printQuery = z
  .strictObject({
    ids: idList.optional(),
    sample: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    /** Overrides the saved layout, for the design gallery. */
    layout: z.enum(TESTIMONIAL_LAYOUTS).optional(),
    locale: z.enum(['bn', 'en']).optional(),
  })
  .refine((q) => q.sample || !!q.ids, { message: 'Choose testimonials to print' });
