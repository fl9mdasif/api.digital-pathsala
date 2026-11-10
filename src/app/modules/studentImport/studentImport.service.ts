import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../errors/AppError';
import { parseCsv, toCsv } from '../../lib/csv';
import { isValidLocalDate, todayLocal } from '../../lib/localDate';
import { normalizeBdPhone } from '../../lib/phone';
import { requireTenantId } from '../../lib/tenantContext';
import { withTransaction } from '../../lib/transaction';
import { writeAudit } from '../auditLog/auditLog.model';
import { ClassModel } from '../class/class.model';
import { Enrolment } from '../enrolment/enrolment.model';
import { currentSession } from '../enrolment/enrolment.service';
import { Section } from '../section/section.model';
import { createStudentRecord } from '../student/student.service';
import { Student } from '../student/student.model';
import { Tenant } from '../tenant/tenant.model';
import { ImportJob } from './importJob.model';

export const MAX_ROWS = 2000;
export const COLUMNS = [
  'name',
  'nameBn',
  'gender',
  'dob',
  'admissionNo',
  'className',
  'group',
  'sectionName',
  'roll',
  'guardianName',
  'guardianPhone',
  'guardianRelation',
  'address',
  'religion',
  'admittedOn',
];

export const csvTemplate = () =>
  toCsv(COLUMNS, [
    [
      'Rahim Uddin',
      '',
      'male',
      '2014-05-20',
      'A-101',
      'Class 5',
      '',
      'A',
      '1',
      'Karim Uddin',
      '01712345678',
      'father',
      'Dhaka',
      'Islam',
      '',
    ],
  ]);

const rowSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  nameBn: z.string().trim().max(120).optional(),
  gender: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.enum(['male', 'female', 'other'], 'Gender must be male, female or other')),
  dob: z
    .string()
    .trim()
    .refine(isValidLocalDate, 'dob must be YYYY-MM-DD')
    .refine((d) => d < todayLocal(), 'dob must be in the past'),
  admissionNo: z.string().trim().max(40).optional(),
  className: z.string().trim().min(1, 'className is required'),
  group: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(['science', 'commerce', 'arts', '']))
    .optional(),
  sectionName: z.string().trim().max(40).optional(),
  roll: z
    .string()
    .trim()
    .regex(/^\d{1,4}$/, 'roll must be a number')
    .optional()
    .or(z.literal('')),
  guardianName: z.string().trim().max(100).optional(),
  guardianPhone: z.string().trim().optional(),
  guardianRelation: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(['father', 'mother', 'other', '']))
    .optional(),
  address: z.string().trim().max(300).optional(),
  religion: z.string().trim().max(40).optional(),
  admittedOn: z
    .string()
    .trim()
    .refine((d) => d === '' || isValidLocalDate(d), 'admittedOn must be YYYY-MM-DD')
    .optional(),
});

export interface ImportError {
  row: number;
  field: string;
  message: string;
}

const planAllowsImport = async () => {
  const t = await Tenant.findById(requireTenantId()).select('planId studentCap').lean();
  return t;
};

export const dryRun = async (fileName: string, buffer: Buffer) => {
  const tenant = await planAllowsImport();
  const table = parseCsv(buffer.toString('utf8'));
  if (table.length < 2) throw AppError.badRequest('The file has no data rows');
  const header = table[0].map((h) => h.trim());
  const missing = ['name', 'gender', 'dob', 'className'].filter((c) => !header.includes(c));
  if (missing.length) throw AppError.badRequest(`Missing required columns: ${missing.join(', ')}`);
  const data = table.slice(1);
  if (data.length > MAX_ROWS)
    throw AppError.badRequest(`Too many rows (max ${MAX_ROWS})`, undefined, 'TOO_MANY_ROWS');

  const sess = await currentSession();
  const classes = await ClassModel.find({}).lean();
  const sections = await Section.find({}).lean();
  const existing = await Enrolment.find({ sessionId: sess._id }).select('classId sectionId roll').lean();
  const takenRolls = new Set(existing.map((e) => `${e.classId}|${e.sectionId}|${e.roll}`));
  const seenRolls = new Set<string>();
  const seenAdmission = new Set<string>();

  const errors: ImportError[] = [];
  const valid: any[] = [];

  data.forEach((cells, i) => {
    const rowNo = i + 2; // spreadsheet row number including header
    const raw: Record<string, string> = {};
    header.forEach((h, idx) => (raw[h] = (cells[idx] ?? '').trim()));
    const before = errors.length;
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        errors.push({ row: rowNo, field: String(issue.path[0] ?? 'row'), message: issue.message });
      return;
    }
    const r = parsed.data;
    const group = r.group || null;
    const cls =
      classes.find(
        (c) => c.name.toLowerCase() === r.className.toLowerCase() && (c.group ?? null) === group,
      ) ?? classes.find((c) => c.name.toLowerCase() === r.className.toLowerCase() && !group);
    if (!cls) {
      errors.push({ row: rowNo, field: 'className', message: `Class "${r.className}" not found` });
      return;
    }
    let sectionId: string | undefined;
    if (r.sectionName) {
      const sec = sections.find(
        (s) => String(s.classId) === String(cls._id) && s.name.toLowerCase() === r.sectionName!.toLowerCase(),
      );
      if (!sec)
        errors.push({
          row: rowNo,
          field: 'sectionName',
          message: `Section "${r.sectionName}" not found in ${cls.name}`,
        });
      else sectionId = String(sec._id);
    } else {
      const def = sections.find((s) => String(s.classId) === String(cls._id) && s.isDefault);
      sectionId = def ? String(def._id) : undefined;
    }

    let guardian: any;
    if (r.guardianName || r.guardianPhone) {
      const phone = r.guardianPhone ? normalizeBdPhone(r.guardianPhone) : null;
      if (!r.guardianName)
        errors.push({
          row: rowNo,
          field: 'guardianName',
          message: 'guardianName is required with guardianPhone',
        });
      if (!phone)
        errors.push({
          row: rowNo,
          field: 'guardianPhone',
          message: 'Enter a valid Bangladesh mobile number',
        });
      if (r.guardianName && phone)
        guardian = { name: r.guardianName, phone, relation: r.guardianRelation || 'other' };
    }

    const roll = r.roll ? Number(r.roll) : undefined;
    if (roll && sectionId) {
      const key = `${cls._id}|${sectionId}|${roll}`;
      if (takenRolls.has(key))
        errors.push({ row: rowNo, field: 'roll', message: `Roll ${roll} is already used in this section` });
      else if (seenRolls.has(key))
        errors.push({ row: rowNo, field: 'roll', message: `Roll ${roll} appears twice in this file` });
      seenRolls.add(key);
    }
    if (r.admissionNo) {
      if (seenAdmission.has(r.admissionNo))
        errors.push({ row: rowNo, field: 'admissionNo', message: 'admissionNo appears twice in this file' });
      seenAdmission.add(r.admissionNo);
    }

    if (errors.length === before) {
      valid.push({
        name: r.name,
        nameBn: r.nameBn || undefined,
        gender: r.gender,
        dob: r.dob,
        admissionNo: r.admissionNo || undefined,
        address: r.address || undefined,
        religion: r.religion || undefined,
        admittedOn: r.admittedOn || undefined,
        enrolment: { classId: String(cls._id), sectionId, roll, group },
        guardians: guardian ? [guardian] : [],
      });
    }
  });

  const active = await Student.countDocuments({ status: 'active' });
  if (tenant && active + valid.length > tenant.studentCap) {
    errors.push({
      row: 0,
      field: 'file',
      message: `Import would exceed your plan limit of ${tenant.studentCap} students (${active} active now)`,
    });
  }

  const job = await ImportJob.create({
    kind: 'students',
    status: 'dry_run',
    fileName,
    totalRows: data.length,
    validRows: valid.length,
    rowErrors: errors.slice(0, 500),
    rows: valid,
  });
  return {
    jobId: job._id,
    status: job.status,
    fileName,
    totalRows: data.length,
    validRows: valid.length,
    errorCount: errors.length,
    errors: errors.slice(0, 500),
  };
};

const CHUNK = 200;

/** Commits a clean dry run. Safe to call again: it resumes after the last committed chunk or returns the stored result. */
export const commitJob = async (jobId: string) => {
  const job = await ImportJob.findById(jobId).select('+rows');
  if (!job) throw AppError.notFound('Import job not found');
  if (job.status === 'committed') return { jobId: job._id, status: 'committed', ...(job.result as any) };
  if (job.status !== 'dry_run') throw AppError.conflict('This import job cannot be committed', 'JOB_STATE');
  if ((job.rowErrors?.length ?? 0) > 0)
    throw AppError.badRequest(
      'Fix the errors in the file and run a new dry run first',
      undefined,
      'JOB_HAS_ERRORS',
    );

  const rows = (job.rows ?? []) as any[];
  let created = (job.result as any)?.created ?? 0;
  let reused = (job.result as any)?.guardiansReused ?? 0;

  while (created < rows.length) {
    const slice = rows.slice(created, created + CHUNK);
    const res = await withTransaction(async (session) => {
      let r = 0;
      for (const row of slice)
        r += (await createStudentRecord({ ...row, guardians: row.guardians ?? [] }, session)).guardiansReused;
      // Progress is saved in the same transaction so a retry never repeats a chunk.
      await ImportJob.updateOne(
        { _id: job._id },
        { $set: { result: { created: created + slice.length, guardiansReused: reused + r } } },
        { session },
      );
      return r;
    });
    created += slice.length;
    reused += res;
  }

  await ImportJob.updateOne(
    { _id: job._id },
    {
      $set: { status: 'committed', committedAt: new Date(), result: { created, guardiansReused: reused } },
      $unset: { rows: 1 },
    },
  );
  await writeAudit({
    action: 'student.import_commit',
    entityType: 'ImportJob',
    entityId: job._id as Types.ObjectId,
    after: { created, guardiansReused: reused },
  });
  return { jobId: job._id, status: 'committed', created, guardiansReused: reused };
};
