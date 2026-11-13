import { describe, expect, it } from 'vitest';
import { agent, authed, login, registerTenant } from './helpers/api';
import { useTestDb } from './helpers/db';

useTestDb();

describe('school colour theme', () => {
  it('defaults to forest, the admin can change it, everyone sees it, a teacher cannot change it', async () => {
    const t = await registerTenant({ slug: 'theme-school' });
    const h = authed(t.token);
    expect((await agent().get('/api/v1/auth/me').set(h)).body.data.tenant.settings.theme).toBe('forest');

    expect((await agent().patch('/api/v1/school/settings').set(h).send({ theme: 'pink' })).status).toBe(400);
    expect((await agent().patch('/api/v1/school/settings').set(h).send({ theme: 'maroon' })).status).toBe(200);
    expect((await agent().get('/api/v1/auth/me').set(h)).body.data.tenant.settings.theme).toBe('maroon');

    await agent()
      .post('/api/v1/users')
      .set(h)
      .send({ role: 'teacher', name: 'Teach Er', email: 'th@example.com', password: 'Teacher#12345' });
    const teacher = (await login(t.slug, 'th@example.com', 'Teacher#12345')).body.data.accessToken;
    expect((await agent().get('/api/v1/auth/me').set(authed(teacher))).body.data.tenant.settings.theme).toBe('maroon');
    expect((await agent().patch('/api/v1/school/settings').set(authed(teacher)).send({ theme: 'navy' })).status).toBe(403);

    await agent().patch('/api/v1/site').set(h).send({ hero: { title: 'Welcome' }, about: 'We teach.' });
    await agent().post('/api/v1/site/publish').set(h);
    expect((await agent().get('/api/v1/public/schools/theme-school')).body.data.school.theme).toBe('maroon');
  });
});
