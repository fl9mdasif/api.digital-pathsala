import { beforeAll, describe, expect, it } from 'vitest';
import { ExamRoutineEntry } from '../src/app/modules/examRoutine/examRoutine.model';
import { agent, registerTenant } from './helpers/api';
import { setupExam } from './helpers/exams';
import { useTestDb } from './helpers/db';

useTestDb();

beforeAll(async () => {
  await ExamRoutineEntry.init();
});

const setup = async () => {
  const t = await registerTenant();
  const x = await setupExam(t);
  const put = (body: object, h = x.h) =>
    agent()
      .put('/api/v1/exam-routines/entry')
      .set(h)
      .send({ examId: x.exam._id, classId: x.cls._id, ...body });
  return { t, x, put };
};

describe('exam routine', () => {
  it('schedules papers for a class and lists them in date order', async () => {
    const { x, put } = await setup();
    expect((await put({ subjectId: x.math._id, date: '2026-12-02', startTime: '10:00', endTime: '12:00', room: 'Hall 1' })).status).toBe(200);
    expect((await put({ subjectId: x.bangla._id, date: '2026-12-01', startTime: '10:00', endTime: '12:00' })).status).toBe(200);
    await put({ subjectId: x.math._id, date: '2026-12-03', startTime: '10:00', endTime: '12:00', room: 'Hall 1' }); // moves the same paper

    const res = (await agent().get(`/api/v1/exam-routines?examId=${x.exam._id}&classId=${x.cls._id}`).set(x.h)).body.data;
    expect(res.entries.map((e: any) => [e.subject.name, e.date])).toEqual([
      ['Bangla', '2026-12-01'],
      ['Math', '2026-12-03'],
    ]);
    expect(res.entries[1]).toMatchObject({ className: 'Class 5', sectionId: null, room: 'Hall 1' });
  });

  it('rejects clashes, bad times and papers outside the exam, class or syllabus', async () => {
    const { x, put } = await setup();
    const base = { date: '2026-12-01', startTime: '10:00', endTime: '12:00' };
    expect((await put({ subjectId: x.bangla._id, ...base, room: 'R1' })).status).toBe(200);

    expect((await put({ subjectId: x.math._id, ...base })).body.code).toBe('TIME_CLASH');
    expect((await put({ subjectId: x.math._id, date: '2026-12-01', startTime: '12:00', endTime: '14:00' })).status).toBe(200);
    expect((await put({ subjectId: x.math._id, ...base, endTime: '09:00' })).status).toBe(400);

    const other = (await agent().post('/api/v1/classes').set(x.h).send({ name: 'Class 6', order: 6 })).body.data;
    const ot = await agent().put('/api/v1/exam-routines/entry').set(x.h).send({ examId: x.exam._id, classId: other._id, subjectId: x.math._id, ...base, room: 'R1' });
    expect(ot.body.code).toBe('CLASS_NOT_IN_EXAM');

    const noSubject = (await agent().post('/api/v1/subjects').set(x.h).send({ name: 'Art' })).body.data;
    expect((await put({ subjectId: noSubject._id, date: '2026-12-05', startTime: '10:00', endTime: '11:00' })).body.code).toBe('SUBJECT_NOT_IN_CLASS');

    const dated = (
      await agent().post('/api/v1/exams').set(x.h).send({ name: 'Dated', sessionId: x.session._id, classIds: [x.cls._id], startDate: '2026-12-10', endDate: '2026-12-20' })
    ).body.data;
    const outside = await agent().put('/api/v1/exam-routines/entry').set(x.h).send({ examId: dated._id, classId: x.cls._id, subjectId: x.math._id, date: '2026-12-25', startTime: '10:00', endTime: '11:00' });
    expect(outside.body.code).toBe('OUTSIDE_EXAM_DATES');
  });

  it('lets a section paper replace the class-wide one and checks the room across classes', async () => {
    const { x, put } = await setup();
    const secB = (await agent().post('/api/v1/sections').set(x.h).send({ classId: x.cls._id, name: 'B' })).body.data;
    const base = { subjectId: x.math._id, startTime: '10:00', endTime: '12:00' };

    await put({ ...base, date: '2026-12-02' });
    await put({ ...base, date: '2026-12-04', sectionId: secB._id });

    const forB = (await agent().get(`/api/v1/exam-routines?examId=${x.exam._id}&classId=${x.cls._id}&sectionId=${secB._id}`).set(x.h)).body.data;
    expect(forB.entries).toHaveLength(1);
    expect(forB.entries[0]).toMatchObject({ date: '2026-12-04', sectionName: 'B' });
    const forA = (await agent().get(`/api/v1/exam-routines?examId=${x.exam._id}&classId=${x.cls._id}&sectionId=${x.sections[0]._id}`).set(x.h)).body.data;
    expect(forA.entries.map((e: any) => e.date)).toEqual(['2026-12-02']);

    const wrongSection = await put({ ...base, date: '2026-12-06', sectionId: '64b000000000000000000001' });
    expect(wrongSection.body.code).toBe('SECTION_NOT_IN_CLASS');

    const hall = { date: '2026-12-08', startTime: '09:00', endTime: '10:00', room: 'Hall 9' };
    expect((await put({ subjectId: x.bangla._id, ...hall })).status).toBe(200);
    expect((await put({ subjectId: x.math._id, ...hall, startTime: '09:30', endTime: '10:30', sectionId: secB._id })).body.code).toBe('TIME_CLASH');
  });

  it('removes entries and limits changes to admins', async () => {
    const { x, put } = await setup();
    const e = (await put({ subjectId: x.math._id, date: '2026-12-02', startTime: '10:00', endTime: '12:00' })).body.data;
    expect((await agent().put('/api/v1/exam-routines/entry').set(x.banglaTok).send({ examId: x.exam._id, classId: x.cls._id, subjectId: x.math._id, date: '2026-12-03', startTime: '10:00', endTime: '12:00' })).status).toBe(403);
    expect((await agent().get(`/api/v1/exam-routines?examId=${x.exam._id}`).set(x.banglaTok)).status).toBe(200);

    expect((await agent().delete(`/api/v1/exam-routines/entry/${e._id}`).set(x.h)).body.data.deleted).toBe(true);
    expect((await agent().delete(`/api/v1/exam-routines/entry/${e._id}`).set(x.h)).status).toBe(404);
  });
});
