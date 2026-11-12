import { z } from 'zod';
import { isValidLocalDate, todayLocal } from '../../lib/localDate';
import { mediaUrl } from '../../lib/mediaUrl';
import { objectIdSchema } from '../../lib/objectId';
import { paginationQuery } from '../../lib/pagination';
import { normalizeBdPhone } from '../../lib/phone';
import { ADMISSION_STATUSES } from './admission.model';

const phone = z.string().transform((v, ctx) => {
  const n = normalizeBdPhone(v);
  if (!n) ctx.addIssue({ code: 'custom', message: 'Enter a valid Bangladesh mobile number' });
  return n ?? v;
});
const date = z.string().refine(isValidLocalDate, 'Use YYYY-MM-DD');
const applicationNo = z.string().trim().toUpperCase().min(5).max(20);

const guardian = z.strictObject({
  name: z.string().trim().min(2).max(100),
  phone,
  relation: z.enum(['father', 'mother', 'other']).default('other'),
  occupation: z.string().trim().max(80).optional(),
});

const profile = {
  classId: objectIdSchema,
  group: z.enum(['science', 'commerce', 'arts']).nullable().optional(),
  name: z.string().trim().min(2).max(120),
  nameBn: z.string().trim().max(120).optional(),
  gender: z.enum(['male', 'female', 'other']),
  dob: date.refine((d) => d < todayLocal(), 'Date of birth must be in the past'),
  religion: z.string().trim().max(40).optional(),
  bloodGroup: z.enum(['A+', 'A-', 'AB+', 'AB-', 'B+', 'B-', 'O+', 'O-']).optional(),
  address: z.string().trim().max(300).optional(),
  birthRegistrationNo: z.string().trim().max(30).optional(),
  previousSchool: z.string().trim().max(150).optional(),
  guardians: z.array(guardian).min(1).max(3),
  photoUrl: mediaUrl.optional(),
};

/** The public application form. `website` is a honeypot that real visitors never see. */
export const applyBody = z.strictObject({ ...profile, website: z.string().max(200).optional() });

export const lookupBody = z.strictObject({ applicationNo, phone: z.string().trim().min(5).max(20) });

export const photoChangeBody = z.strictObject({ applicationNo, phone: z.string().trim().min(5).max(20), photoUrl: mediaUrl });

export const listQuery = z.strictObject({
  ...paginationQuery,
  status: z.enum(ADMISSION_STATUSES).optional(),
  classId: objectIdSchema.optional(),
  q: z.string().trim().max(60).optional(),
});

export const decisionBody = z.strictObject({
  status: z.enum(['admitted', 'rejected']),
  note: z.string().trim().max(300).optional(),
});

export const updateBody = z.strictObject(profile).partial().extend({ photoUrl: mediaUrl.nullable().optional() });

export const confirmBody = z.strictObject({
  sectionId: objectIdSchema.optional(),
  roll: z.number().int().min(1).max(9999).optional(),
});
