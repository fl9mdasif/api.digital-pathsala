import { describe, expect, it } from 'vitest';
import { agent, authed, login, registerTenant } from './helpers/api';
import { useTestDb } from './helpers/db';

useTestDb();

const page = { title: 'এমপিও ও জাতীয়করণের তথ্য', body: '<p>MPO since 1998</p><script>alert(1)</script>', isPublished: true };

const publish = async (token: string) => {
  const h = authed(token);
  await agent().patch('/api/v1/site').set(h).send({ hero: { title: 'Welcome' }, about: 'We teach.' });
  await agent().post('/api/v1/site/publish').set(h);
};

describe('school website pages', () => {
  it('only the admin writes pages; the body is sanitised', async () => {
    const t = await registerTenant({ slug: 'page-school' });
    expect((await agent().put('/api/v1/site-pages/mpo-nationalisation').send(page)).status).toBe(401);

    await agent()
      .post('/api/v1/users')
      .set(authed(t.token))
      .send({ role: 'teacher', name: 'Teach Er', email: 'tp@example.com', password: 'Teacher#12345' });
    const teacher = (await login(t.slug, 'tp@example.com', 'Teacher#12345')).body.data.accessToken;
    expect((await agent().put('/api/v1/site-pages/mpo-nationalisation').set(authed(teacher)).send(page)).status).toBe(403);

    const res = await agent().put('/api/v1/site-pages/mpo-nationalisation').set(authed(t.token)).send(page);
    expect(res.status).toBe(200);
    expect(res.body.data.body).toContain('MPO since 1998');
    expect(res.body.data.body).not.toContain('<script');
    expect((await agent().put('/api/v1/site-pages/not-a-page').set(authed(t.token)).send(page)).status).toBe(400);
  });

  it('public sees only published pages of a published site', async () => {
    const t = await registerTenant({ slug: 'page-school-2' });
    const h = authed(t.token);
    await agent().put('/api/v1/site-pages/land').set(h).send(page);
    await agent().put('/api/v1/site-pages/tender').set(h).send({ ...page, title: 'দরপত্র', isPublished: false });

    // site not published yet
    expect((await agent().get('/api/v1/public/schools/page-school-2/pages')).status).toBe(404);
    await publish(t.token);

    const index = await agent().get('/api/v1/public/schools/page-school-2/pages');
    expect(index.status).toBe(200);
    expect(index.body.data.map((p: any) => p.key)).toEqual(['land']);
    expect((await agent().get('/api/v1/public/schools/page-school-2/pages/land')).body.data.title).toBe(page.title);
    expect((await agent().get('/api/v1/public/schools/page-school-2/pages/tender')).status).toBe(404);

    // delete hides it
    expect((await agent().delete('/api/v1/site-pages/land').set(h)).status).toBe(200);
    expect((await agent().get('/api/v1/public/schools/page-school-2/pages/land')).status).toBe(404);
  });

  it('pages never leak between schools', async () => {
    const a = await registerTenant({ slug: 'page-a' });
    const b = await registerTenant({ slug: 'page-b' });
    await agent().put('/api/v1/site-pages/library').set(authed(a.token)).send(page);
    await publish(b.token);
    expect((await agent().get('/api/v1/site-pages').set(authed(b.token))).body.data).toEqual([]);
    expect((await agent().get('/api/v1/public/schools/page-b/pages/library')).status).toBe(404);
  });
});
