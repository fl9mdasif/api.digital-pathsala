import { mediaUrl } from '../../lib/mediaUrl';
import { z } from 'zod';
import { normalizeBdPhone } from '../../lib/phone';

const phone = z.string().transform((v, ctx) => {
  const n = normalizeBdPhone(v);
  if (!n) ctx.addIssue({ code: 'custom', message: 'Enter a valid Bangladesh mobile number' });
  return n ?? v;
});

export const updateProfileBody = z.strictObject({
  name: z.string().trim().min(2).max(120).optional(),
  nameBn: z.string().trim().max(120).optional(),
  logoUrl: mediaUrl.optional(),
  eiin: z.string().trim().max(20).optional(),
  contact: z
    .strictObject({
      phone: phone.optional(),
      email: z.string().trim().toLowerCase().email().optional(),
      address: z.string().trim().max(300).optional(),
      district: z.string().trim().max(60).optional(),
      upazila: z.string().trim().max(60).optional(),
    })
    .optional(),
});

export const updateSettingsBody = z.strictObject({
  locale: z.enum(['bn', 'en']).optional(),
  weekendDays: z.array(z.number().int().min(0).max(6)).max(3).optional(),
  defaultFeeCycle: z.enum(['monthly', 'term', 'yearly', 'one_time']).optional(),
  attendanceEditWindowHours: z.number().int().min(0).max(720).optional(),
  resultLookupMode: z.enum(['roll_dob', 'roll_only', 'student_id_dob']).optional(),
  theme: z.enum(['forest', 'navy', 'maroon', 'royal', 'plum']).optional(),
});
