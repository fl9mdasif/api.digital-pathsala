import { describe, expect, it } from 'vitest';
import { agent, authed, registerTenant } from './helpers/api';
import { useTestDb } from './helpers/db';
import { platformToken } from './helpers/platform';

useTestDb();

const body = { title: 'SSC 2027 form fill-up notice', source: 'dshe', url: 'https://dshe.gov.bd/notice/1', publishedOn: '2026-11-10' };

describe('government notices', () => {
  it('only the platform owner can write them', async () => {
    const t = await registerTenant();
    expect((await agent().post('/api/v1/platform/gov-notices').send(body)).status).toBe(401);
    expect((await agent().post('/api/v1/platform/gov-notices').set(authed(t.token)).send(body)).status).toBe(403);
    const p = await platformToken();
    const res = await agent().post('/api/v1/platform/gov-notices').set(authed(p)).send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.source).toBe('dshe');
  });

  it('rejects a non-web link and an unknown source', async () => {
    const p = await platformToken();
    expect((await agent().post('/api/v1/platform/gov-notices').set(authed(p)).send({ ...body, url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await agent().post('/api/v1/platform/gov-notices').set(authed(p)).send({ ...body, source: 'x' })).status).toBe(400);
  });

  it('shows the latest publicly, pinned first, and reflects edits and deletes', async () => {
    const p = await platformToken();
    const a = await agent().post('/api/v1/platform/gov-notices').set(authed(p)).send(body);
    await agent().post('/api/v1/platform/gov-notices').set(authed(p)).send({ ...body, title: 'Newer DPE notice', source: 'dpe', publishedOn: '2026-11-12' });
    await agent().post('/api/v1/platform/gov-notices').set(authed(p)).send({ ...body, title: 'Pinned NCTB notice', source: 'nctb', publishedOn: '2026-10-01', pinned: true });

    const pub = await agent().get('/api/v1/public/gov-notices').query({ limit: 5 });
    expect(pub.status).toBe(200);
    const titles = pub.body.data.map((n: any) => n.title);
    expect(titles[0]).toBe('Pinned NCTB notice');
    expect(titles.indexOf('Newer DPE notice')).toBeLessThan(titles.indexOf(body.title));

    await agent().patch(`/api/v1/platform/gov-notices/${a.body.data._id}`).set(authed(p)).send({ title: 'Edited title' });
    await agent().delete(`/api/v1/platform/gov-notices/${a.body.data._id}`).set(authed(p));
    const after = await agent().get('/api/v1/public/gov-notices');
    expect(after.body.data.map((n: any) => n.title)).not.toContain('Edited title');
    expect(after.body.data.map((n: any) => n._id)).not.toContain(a.body.data._id);

    const list = await agent().get('/api/v1/platform/gov-notices').set(authed(p));
    expect(list.body.meta.total).toBeGreaterThanOrEqual(2);
  });
});
