import { beforeAll, describe, expect, it } from 'vitest';
import { Department } from '../src/app/modules/department/department.model';
import { Designation } from '../src/app/modules/designation/designation.model';
import { Employee } from '../src/app/modules/employee/employee.model';
import { agent, authed, login, registerTenant } from './helpers/api';
import { useTestDb } from './helpers/db';

useTestDb();

beforeAll(async () => {
  await Promise.all([Designation.init(), Department.init(), Employee.init()]);
});

const newTeacher = (email: string) => ({
  role: 'teacher',
  name: 'HR Sir',
  email,
  password: 'Teacher#12345',
});

describe('teacher / HR', () => {
  it('manages designations and departments, blocking delete while assigned', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    const des = (await agent().post('/api/v1/designations').set(h).send({ name: 'Headmaster' })).body.data;
    const dep = (await agent().post('/api/v1/departments').set(h).send({ name: 'Science' })).body.data;
    expect((await agent().post('/api/v1/designations').set(h).send({ name: 'Headmaster' })).status).toBe(409);

    const user = (await agent().post('/api/v1/users').set(h).send(newTeacher('hr1@example.com'))).body.data
      .user;
    const emp = await agent()
      .post('/api/v1/employees')
      .set(h)
      .send({ userId: user.id, designationId: des._id, departmentId: dep._id, basicSalary: 25000 });
    expect(emp.status).toBe(201);

    expect((await agent().delete(`/api/v1/designations/${des._id}`).set(h)).status).toBe(409);
    expect((await agent().delete(`/api/v1/departments/${dep._id}`).set(h)).status).toBe(409);
  });

  it('creates one employee record per staff user with an auto code and filters the list', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    const u1 = (await agent().post('/api/v1/users').set(h).send(newTeacher('a@example.com'))).body.data.user;
    const u2 = (await agent().post('/api/v1/users').set(h).send(newTeacher('b@example.com'))).body.data.user;

    const e1 = (await agent().post('/api/v1/employees').set(h).send({ userId: u1.id })).body.data;
    const e2 = (await agent().post('/api/v1/employees').set(h).send({ userId: u2.id })).body.data;
    expect(e1.employeeCode).toBe('EMP-0001');
    expect(e2.employeeCode).toBe('EMP-0002');

    const dup = await agent().post('/api/v1/employees').set(h).send({ userId: u1.id });
    expect(dup.status).toBe(409);

    await agent().patch(`/api/v1/employees/${e2._id}`).set(h).send({ employmentStatus: 'resigned' });
    const active = await agent().get('/api/v1/employees?employmentStatus=active').set(h);
    expect(active.body.data).toHaveLength(1);
    expect(active.body.data[0].userId.name).toBe('HR Sir');
  });

  it('rejects non-staff users, unknown designations and non-admin access', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    const bogus = '64b000000000000000000001';
    expect((await agent().post('/api/v1/employees').set(h).send({ userId: bogus })).status).toBe(400);

    const u = (await agent().post('/api/v1/users').set(h).send(newTeacher('c@example.com'))).body.data.user;
    const badDes = await agent().post('/api/v1/employees').set(h).send({ userId: u.id, designationId: bogus });
    expect(badDes.status).toBe(400);

    const tTok = authed((await login(t.slug, 'c@example.com', 'Teacher#12345')).body.data.accessToken);
    expect((await agent().get('/api/v1/employees').set(tTok)).status).toBe(403);
    expect((await agent().get('/api/v1/designations').set(tTok)).status).toBe(200);
    expect((await agent().post('/api/v1/designations').set(tTok).send({ name: 'X1' })).status).toBe(403);
  });
});
