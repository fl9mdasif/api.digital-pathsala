import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { env } from '../config/env';

const json = (code: string, message: string) => ({ success: false, code, message });

const make = (windowMs: number, limit: number, message = 'Too many requests, slow down') =>
  rateLimit({
    windowMs,
    limit: env.isTest ? 10000 : limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: json('RATE_LIMITED', message),
  });

export const globalLimiter = make(60_000, 300);
export const loginLimiter = make(15 * 60_000, 10, 'Too many login attempts, try again later');
export const registerLimiter = make(60 * 60_000, 10);
export const slugCheckLimiter = make(60_000, 30);
export const inquiryLimiter = make(60 * 60_000, 5, 'Too many submissions, try again later');
export const resultLookupMinuteLimiter = make(60_000, 10, 'Too many requests, try again shortly');
export const resultLookupHourLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: env.isTest ? 10000 : 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // 60 per hour per IP per school
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}|${String(req.params.slug ?? '')}`,
  message: json('RATE_LIMITED', 'Too many requests, try again later'),
});
export const publicLimiter = make(60_000, 120);

/**
 * Failed fee lookups for one student, from anywhere. The per-IP limits above stop one visitor, but a student ID is
 * short and guessable, so many addresses together could still try phone numbers against it. Only failures count.
 */
export const makeFeeLookupStudentLimiter = (limit: number) =>
  rateLimit({
    windowMs: 15 * 60_000,
    limit,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `${String(req.params.slug ?? '')}|${String((req.body as any)?.studentId ?? '').trim().toLowerCase().slice(0, 40)}`,
    message: json('RATE_LIMITED', 'Too many attempts for this student, try again later'),
  });
export const feeLookupStudentLimiter = makeFeeLookupStudentLimiter(env.isTest ? 10000 : 8);

/** Online admission: a family applies once or twice, not dozens of times. */
export const admissionApplyLimiter = make(60 * 60_000, 5, 'Too many applications, try again later');
/** Photo upload signatures for applicants, per IP. */
export const admissionUploadLimiter = make(60 * 60_000, 10, 'Too many uploads, try again later');
/** Failed status lookups (or photo changes) for one application number, from anywhere. Only failures count. */
export const admissionLookupLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.isTest ? 10000 : 8,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${String(req.params.slug ?? '')}|${String((req.body as any)?.applicationNo ?? '').trim().toUpperCase().slice(0, 30)}`,
  message: json('RATE_LIMITED', 'Too many attempts for this application, try again later'),
});
