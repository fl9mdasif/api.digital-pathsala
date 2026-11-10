import { z } from 'zod';
import { mediaUrl } from '../../lib/mediaUrl';
import { isValidLocalDate } from '../../lib/localDate';
import { objectIdSchema } from '../../lib/objectId';
import { ID_CARD_DESIGNS } from '../idCard/idCard.model';
import { MAX_CARDS } from '../idCard/idCard.validation';
import { TEACHER_SHOW_KEYS } from './teacherIdCard.model';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1b4b8a');
const optionalDate = z.union([z.literal(''), z.string().refine(isValidLocalDate, 'Use YYYY-MM-DD')]);
const optionalMedia = z.union([z.literal(''), mediaUrl]);

export const configBody = z.strictObject({
  design: z.enum(ID_CARD_DESIGNS),
  themeColor: color,
  textColor: color,
  nameColor: color,
  fontSchool: z.number().min(6).max(16),
  fontAddress: z.number().min(5).max(12),
  fontDetails: z.number().min(6).max(12),
  photoShape: z.enum(['square', 'rounded', 'circle']),
  issueDate: optionalDate,
  validUntil: optionalDate,
  validityYears: z.number().int().min(1).max(10),
  signatureTitle: z.string().trim().max(40),
  show: z.strictObject(Object.fromEntries(TEACHER_SHOW_KEYS.map((k) => [k, z.boolean()])) as Record<(typeof TEACHER_SHOW_KEYS)[number], z.ZodBoolean>),
  backTop: z.string().trim().max(400),
  backBottom: z.string().trim().max(200),
  qrMode: z.enum(['off', 'static', 'dynamic']),
  qrData: z.string().trim().max(300),
  watermarkUrl: optionalMedia,
  signatureUrl: optionalMedia,
});

const idList = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(objectIdSchema).min(1).max(MAX_CARDS));

/** No ids means every active employee (optionally of one department). */
export const printQuery = z.strictObject({
  employeeIds: idList.optional(),
  departmentId: objectIdSchema.optional(),
  locale: z.enum(['bn', 'en']).default('bn'),
  part: z.enum(['front', 'back', 'both']).default('front'),
  design: z.enum(ID_CARD_DESIGNS).optional(),
  sample: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});
