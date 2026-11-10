import { z } from 'zod';
import { mediaUrl } from '../../lib/mediaUrl';
import { isValidLocalDate } from '../../lib/localDate';
import { objectIdSchema } from '../../lib/objectId';
import { ID_CARD_DESIGNS, SHOW_KEYS } from './idCard.model';

export const MAX_CARDS = 200;

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
  classDisplay: z.enum(['class_section', 'class_only']),
  sessionLabel: z.string().trim().max(20),
  signatureTitle: z.string().trim().max(40),
  show: z.strictObject(Object.fromEntries(SHOW_KEYS.map((k) => [k, z.boolean()])) as Record<(typeof SHOW_KEYS)[number], z.ZodBoolean>),
  backTop: z.string().trim().max(400),
  backBottom: z.string().trim().max(200),
  qrMode: z.enum(['off', 'static', 'dynamic']),
  qrData: z.string().trim().max(300),
  watermarkUrl: optionalMedia,
  signatureUrl: optionalMedia,
});

/** Comma separated ids to a list. */
const idList = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(objectIdSchema).min(1).max(MAX_CARDS));

export const printQuery = z
  .strictObject({
    sectionId: objectIdSchema.optional(),
    group: z.enum(['science', 'commerce', 'arts']).optional(),
    studentIds: idList.optional(),
    locale: z.enum(['bn', 'en']).default('bn'),
    /** Front only, back only, or both (fronts then backs, columns mirrored so a duplex printer lines them up). */
    part: z.enum(['front', 'back', 'both']).default('front'),
    /** Overrides the saved design for this print, for trying the others. */
    design: z.enum(ID_CARD_DESIGNS).optional(),
    /** Print one sample card with made-up details, for the settings preview. */
    sample: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  })
  .refine((q) => !!q.sectionId || !!q.studentIds || q.sample, { message: 'Choose a section or some students' });
