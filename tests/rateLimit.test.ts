import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { makeFeeLookupStudentLimiter } from '../src/app/middlewares/rateLimit';

/** A tiny app that answers 404 for a wrong pair and 200 for the right one, behind the limiter. */
const app = () => {
  const a = express();
  a.use(express.json());
  a.post('/schools/:slug/lookup', makeFeeLookupStudentLimiter(3), (req, res) => {
    res.status(req.body.phone === 'right' ? 200 : 404).json({ ok: req.body.phone === 'right' });
  });
  return a;
};

describe('fee lookup limiter per student', () => {
  it('blocks a student after repeated failures, from any address', async () => {
    const a = app();
    const post = (slug: string, studentId: string, phone: string, ip = '10.0.0.1') =>
      request(a).post(`/schools/${slug}/lookup`).set('X-Forwarded-For', ip).send({ studentId, phone });
    for (let i = 0; i < 3; i++) expect((await post('s1', '26-0001', 'wrong')).status).toBe(404);
    // a fourth failure is refused, even from a different address
    expect((await post('s1', '26-0001', 'wrong', '10.0.0.2')).status).toBe(429);
    // and so is the right answer, until the window passes
    expect((await post('s1', '26-0001', 'right', '10.0.0.3')).status).toBe(429);
  });

  it('does not mix up students, schools or letter case, and does not count successes', async () => {
    const a = app();
    const post = (slug: string, studentId: string, phone: string) => request(a).post(`/schools/${slug}/lookup`).send({ studentId, phone });
    for (let i = 0; i < 3; i++) await post('s1', 'ABC-1', 'wrong');
    expect((await post('s1', 'abc-1', 'wrong')).status).toBe(429); // same student, any case
    expect((await post('s1', 'ABC-2', 'wrong')).status).toBe(404); // another student
    expect((await post('s2', 'ABC-1', 'wrong')).status).toBe(404); // another school
    for (let i = 0; i < 6; i++) expect((await post('s3', 'XYZ-9', 'right')).status).toBe(200);
  });
});
