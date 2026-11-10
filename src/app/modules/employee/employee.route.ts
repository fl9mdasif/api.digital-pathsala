import { z } from 'zod';
import { AppError } from '../../errors/AppError';
import { crudRouter } from '../../lib/crud';
import { objectIdSchema } from '../../lib/objectId';
import { ROLE } from '../../lib/roles';
import { nextSeq } from '../counter/counter.model';
import { Department } from '../department/department.model';
import { Designation } from '../designation/designation.model';
import { User } from '../user/user.model';
import { Employee } from './employee.model';

const STAFF_ROLES = ['admin', 'teacher', 'accountant'] as const;
const STATUSES = ['active', 'on_leave', 'resigned', 'terminated'] as const;

const fields = {
  employeeCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,20}$/, 'Use letters, digits, dash or underscore')
    .optional(),
  designationId: objectIdSchema.optional(),
  departmentId: objectIdSchema.optional(),
  joinDate: z.coerce.date().optional(),
  employmentType: z.enum(['permanent', 'contractual', 'part_time']).optional(),
  employmentStatus: z.enum(STATUSES).optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  dateOfBirth: z.coerce.date().optional(),
  bloodGroup: z.string().trim().max(10).optional(),
  nationalId: z.string().trim().max(30).optional(),
  qualification: z.string().trim().max(200).optional(),
  address: z.string().trim().max(300).optional(),
  basicSalary: z.number().min(0).max(10_000_000).optional(),
  photoUrl: z.string().trim().max(500).optional(),
};

const createBody = z.strictObject({ userId: objectIdSchema, ...fields });
const updateBody = z.strictObject(fields).partial();

export const employeeRoutes = crudRouter({
  name: 'employee',
  model: Employee,
  createBody,
  updateBody,
  filterShape: {
    userId: objectIdSchema.optional(),
    designationId: objectIdSchema.optional(),
    departmentId: objectIdSchema.optional(),
    employmentStatus: z.enum(STATUSES).optional(),
  },
  buildFilter: (q) => {
    const f: Record<string, unknown> = {};
    for (const k of ['userId', 'designationId', 'departmentId', 'employmentStatus']) if (q[k]) f[k] = q[k];
    return f;
  },
  populate: 'userId designationId departmentId',
  sort: { employeeCode: 1 },
  readRoles: [ROLE.ADMIN],
  writeRoles: [ROLE.ADMIN],
  allowDelete: false, // leavers are marked resigned/terminated, never removed
  prepare: async (body, existing) => {
    if (body.designationId && !(await Designation.exists({ _id: body.designationId })))
      throw AppError.badRequest('Designation not found');
    if (body.departmentId && !(await Department.exists({ _id: body.departmentId })))
      throw AppError.badRequest('Department not found');
    if (existing) return body;

    if (!(await User.exists({ _id: body.userId, role: { $in: [...STAFF_ROLES] } })))
      throw AppError.badRequest('User must be an existing staff member (admin, teacher or accountant)');
    if (await Employee.exists({ userId: body.userId }))
      throw AppError.conflict('This staff member already has an employee record');
    if (!body.employeeCode) body.employeeCode = `EMP-${String(await nextSeq('employee')).padStart(4, '0')}`;
    return body;
  },
});
