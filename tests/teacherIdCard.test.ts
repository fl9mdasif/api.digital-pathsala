import { beforeAll, describe, expect, it } from 'vitest';
import { Employee } from '../src/app/modules/employee/employee.model';
import { DEFAULT_TEACHER_CARD_CONFIG, TeacherCardConfig } from '../src/app/modules/teacherIdCard/teacherIdCard.model';
import { cardLines, cardQr } from '../src/app/modules/teacherIdCard/teacherIdCard.service';
import { agent, authed, login, registerTenant } from './helpers/api';
import { useTestDb } from './helpers/db';

useTestDb();

beforeAll(async () => {
  await Promise.all([TeacherCardConfig.init(), Employee.init()]);
});

const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const c: Buffer[] = [];
  res.on('data', (d: Buffer) => c.push(d));
  res.on('end', () => cb(null, Buffer.concat(c)));
};
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;
const settings = (over: Record<string, unknown> = {}) => ({ ...DEFAULT_TEACHER_CARD_CONFIG, ...over });

const addStaff = async (h: Record<string, string>, n: number) => {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const u = (await agent().post('/api/v1/users').set(h).send({ role: 'teacher', name: `Teacher ${i + 1}`, email: `t${i}@example.com`, password: 'Teacher#12345' })).body.data.user;
    out.push((await agent().post('/api/v1/employees').set(h).send({ userId: u.id })).body.data._id);
  }
  return out;
};

describe('teacher ID card settings', () => {
  it('starts from defaults, saves every option and rejects bad input', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    const first = (await agent().get('/api/v1/teacher-id-cards/config').set(h)).body.data;
    expect(first.config).toMatchObject({ design: 'modern', qrMode: 'off' });
    expect(first.config.show).toMatchObject({ designation: true, department: true, bloodGroup: false });
    expect(first.placeholders).toContain('employee_code');

    const body = settings({ design: 'classic', themeColor: '#0f766e', qrMode: 'dynamic', qrData: '{employee_code}', show: { ...DEFAULT_TEACHER_CARD_CONFIG.show, bloodGroup: true, joinDate: true } });
    expect((await agent().put('/api/v1/teacher-id-cards/config').set(h).send(body)).status).toBe(200);
    const back = (await agent().get('/api/v1/teacher-id-cards/config').set(h)).body.data.config;
    expect(back).toMatchObject({ design: 'classic', themeColor: '#0f766e', qrMode: 'dynamic' });
    expect(back.show).toMatchObject({ bloodGroup: true, joinDate: true });

    const put = (b: object) => agent().put('/api/v1/teacher-id-cards/config').set(h).send(b);
    expect((await put(settings({ themeColor: 'red' }))).status).toBe(400);
    expect((await put(settings({ design: 'neon' }))).status).toBe(400);
    expect((await put(settings({ watermarkUrl: 'http://evil.example/x.png' }))).status).toBe(400);
  });

  it('is for admins only', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    await agent().post('/api/v1/users').set(h).send({ role: 'teacher', name: 'Teacher One', email: 'only@example.com', password: 'Teacher#12345' });
    const teacher = (await login(t.slug, 'only@example.com', 'Teacher#12345')).body.data.accessToken;
    expect((await agent().get('/api/v1/teacher-id-cards/config').set(authed(teacher))).status).toBe(403);
    expect((await agent().get('/api/v1/teacher-id-cards/staff.pdf?sample=true').set(authed(teacher))).status).toBe(403);
    expect((await agent().get('/api/v1/teacher-id-cards/config')).status).toBe(401);
  });
});

describe('teacher ID card printing', () => {
  it('prints a sample, every active employee, or chosen ones', async () => {
    const t = await registerTenant();
    const h = authed(t.token);
    const ids = await addStaff(h, 3);
    const get = (qs: string) => agent().get(`/api/v1/teacher-id-cards/staff.pdf?${qs}`).set(h).buffer(true).parse(binary);

    const sample = await get('sample=true&part=both');
    expect(sample.status).toBe(200);
    expect(sample.headers['x-card-count']).toBe('1');
    expect(pages(sample.body as Buffer)).toBe(2);

    const all = await get('part=front&locale=en');
    expect(all.headers['x-card-count']).toBe('3');
    expect((all.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const some = await get(`employeeIds=${ids[0]},${ids[1]}&design=mono`);
    expect(some.headers['x-card-count']).toBe('2');

    expect((await get('employeeIds=nope')).status).toBe(400);
  });

  it('answers 404 when there is no staff to print', async () => {
    const t = await registerTenant();
    const res = await agent().get('/api/v1/teacher-id-cards/staff.pdf').set(authed(t.token));
    expect(res.status).toBe(404);
  });
});

describe('teacher card lines', () => {
  const staff = { name: 'A', code: 'EMP-0001', designation: 'Head', department: 'Sci', mobile: '017', bloodGroup: 'A+', dob: '1990-01-01', joinDate: '2020-01-01' };
  it('shows only the switched-on details', () => {
    const cfg = settings({ show: { ...DEFAULT_TEACHER_CARD_CONFIG.show, department: false, bloodGroup: true } }) as typeof DEFAULT_TEACHER_CARD_CONFIG;
    const lines = cardLines(staff, cfg, 'en');
    expect(lines).toContain('Designation: Head');
    expect(lines.some((l) => l.startsWith('Department'))).toBe(false);
    expect(lines.some((l) => l.includes('Blood: A+'))).toBe(true);
  });

  it('builds the QR text from placeholders', () => {
    const cfg = settings({ qrMode: 'dynamic', qrData: '{employee_code}|{name}' }) as typeof DEFAULT_TEACHER_CARD_CONFIG;
    expect(cardQr(staff, cfg)).toBe('EMP-0001|A');
    expect(cardQr(staff, { ...cfg, qrMode: 'off' })).toBe('');
  });
});
