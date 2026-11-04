import { describe, expect, it } from 'vitest';

const baseUrl = process.env.WA_TEST_URL;

describe.skipIf(!baseUrl)('rendered login forms', () => {
  it.each(['/', '/wamaster'])('%s binds a native POST server action', async (path) => {
    if (!baseUrl) throw new Error('WA_TEST_URL must point to a running application');
    const response = await fetch(new URL(path, baseUrl), { redirect: 'manual' });
    expect(response.status).toBe(200);

    const html = await response.text();
    const form = html.match(/<form\b[^>]*>/)?.[0];
    expect(form).toBeDefined();
    expect(form).toMatch(/\bmethod="POST"/i);
    expect(form).toMatch(/\baction="/);
    expect(html).toMatch(/name="\$ACTION_/);
  });
});
