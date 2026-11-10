import { mediaUrl } from '../../lib/mediaUrl';
import { z } from 'zod';
import { isValidLocalDate, todayLocal } from '../../lib/localDate';
import { objectIdSchema } from '../../lib/objectId';
import { paginationQuery } from '../../lib/pagination';
import { normalizeBdPhone } from '../../lib/phone';

const date = z.string().refine(isValidLocalDate, 'Use YYYY-MM-DD');
const phone = z.string().transform((v, ctx) => {
  const n = normalizeBdPhone(v);
  if (!n) ctx.addIssue({ code: 'custom', message: 'Enter a valid Bangladesh mobile number' });
  return n ?? v;
});
const group = z.enum(['science', 'commerce', 'arts']).nullable();

export const guardianInput = z.strictObject({
  name: z.string().trim().min(2).max(100),
  phone,
  relation: z.enum(['father', 'mother', 'other']).default('other'),
  occupation: z.string().trim().max(80).optional(),
  address: z.string().trim().max(300).optional(),
});

export const enrolmentInput = z.strictObject({
  sessionId: objectIdSchema.optional(),
  classId: objectIdSchema,
  sectionId: objectIdSchema.optional(),
  roll: z.number().int().min(1).max(9999).optional(),
  group: group.optional(),
  optionalSubjectIds: z.array(objectIdSchema).max(6).optional(),
  fourthSubjectId: objectIdSchema.optional(),
});

const profile = {
  admissionNo: z.string().trim().max(40).optional(),
  name: z.string().trim().min(2).max(120),
  nameBn: z.string().trim().max(120).optional(),
  gender: z.enum(['male', 'female', 'other']),
  dob: date.refine((d) => d < todayLocal(), 'Date of birth must be in the past'),
  photoUrl: mediaUrl.optional(),
  religion: z.string().trim().max(40).optional(),
  bloodGroup: z.enum(['A+', 'A-', 'AB+', 'AB-', 'B+', 'B-', 'O+', 'O-']).optional(),
  address: z.string().trim().max(300).optional(),
  birthRegistrationNo: z.string().trim().max(30).optional(),
  admittedOn: date.optional(),
};

export const createStudentBody = z.strictObject({
  ...profile,
  enrolment: enrolmentInput,
  guardians: z.array(guardianInput).max(4).default([]),
});

export const updateStudentBody = z.strictObject(profile).partial();

export const studentStatusBody = z.strictObject({
  status: z.enum(['active', 'transferred', 'passed_out', 'dropped', 'inactive']),
});

export const enrolmentChangeBody = z.strictObject({
  sectionId: objectIdSchema.optional(),
  roll: z.number().int().min(1).max(9999).optional(),
});

export const listStudentsQuery = z.strictObject({
  ...paginationQuery,
  q: z.string().trim().max(60).optional(),
  classId: objectIdSchema.optional(),
  sectionId: objectIdSchema.optional(),
  sessionId: objectIdSchema.optional(),
  status: z.enum(['active', 'transferred', 'passed_out', 'dropped', 'inactive']).optional(),
});

export const createLoginBody = z.strictObject({
  student: z.boolean().default(true),
  guardianIds: z.array(objectIdSchema).max(4).default([]),
});
