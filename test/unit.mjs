// Zero-network unit tests: query parsing, field mapping, and the request the
// hooks send, against a fake ctx.fetch.
import assert from 'node:assert';
import hooks, { parseSearch, toJob } from '../index.mjs';

assert.deepStrictEqual(parseSearch('stripe.com: engineer'), { url: 'stripe.com', query: 'engineer' });
assert.deepStrictEqual(parseSearch('Linear: product manager'), { company: 'Linear', query: 'product manager' });
assert.deepStrictEqual(parseSearch('https://jobs.lever.co/acme'), { url: 'https://jobs.lever.co/acme' });
assert.deepStrictEqual(parseSearch('  Notion  '), { company: 'Notion' });
assert.strictEqual(parseSearch('   '), null);

const job = toJob({ title: 'Engineer', url: 'https://x.com/j/1', location: null, remote: true, id: '1', postedAt: '2026-04-29T13:15:11-04:00', salaryMin: 100000, salaryMax: 150000, salaryCurrency: 'usd', salaryPeriod: 'YEARLY' }, 'X');
assert.strictEqual(job.location, 'Remote');
assert.strictEqual(job.externalId, '1');
assert.strictEqual(typeof job.postedAt, 'number');
assert.deepStrictEqual(job.salary, { min: 100000, max: 150000, currency: 'USD' });
assert.strictEqual(toJob({ title: 'Hourly', url: 'https://x.com/j/2', salaryMin: 30, salaryPeriod: 'HOURLY' }, 'X').salary, undefined);
assert.strictEqual(toJob({ title: '', url: 'https://x.com' }, 'X'), null);
assert.strictEqual(toJob({ title: 'Bad url', url: 'javascript:alert(1)' }, 'X'), null);

let sent;
const ctx = {
  env: { BOWMARK_API_KEY: 'test-key-123456' },
  log: () => {},
  fetch: async (url, opts) => {
    sent = { url, opts };
    return { json: async () => ({ ok: true, result: { company: 'Stripe', ats: 'greenhouse', total: 2, warnings: [], jobs: [
      { title: 'A', url: 'https://stripe.com/jobs/search?gh_jid=1', location: 'NYC' },
      { title: 'A dup', url: 'https://stripe.com/jobs/search?gh_jid=1', location: 'NYC' },
    ] } }) };
  },
};
const out = await hooks.search('stripe.com: engineer', ctx);
assert.strictEqual(sent.url, 'https://api.bowmark.ai/v1/run');
assert.strictEqual(sent.opts.headers.Authorization, 'Bearer test-key-123456');
assert.match(JSON.parse(sent.opts.body).script, /"url":"stripe\.com","query":"engineer"/);
assert.deepStrictEqual(out, [{ title: 'A', url: 'https://stripe.com/jobs/search?gh_jid=1', company: 'Stripe', location: 'NYC' }]);

// A quote in the query stays data: it is JSON-escaped, never closes the script string.
await hooks.search('Acme"); process.exit(1); ("', ctx);
assert.match(JSON.parse(sent.opts.body).script, /"company":"Acme\\"\); process\.exit\(1\); \(\\""/);

const fromPortal = await hooks.provider.fetch({ name: 'Stripe', careers_url: 'https://stripe.com/jobs' }, ctx);
assert.strictEqual(fromPortal.length, 1);
assert.match(JSON.parse(sent.opts.body).script, /"url":"https:\/\/stripe\.com\/jobs","company":"Stripe"/);

await assert.rejects(hooks.search('stripe.com', { ...ctx, env: {} }), /BOWMARK_API_KEY is missing/);
await assert.rejects(hooks.search('x.com', { ...ctx, fetch: async () => ({ json: async () => ({ ok: false, error: 'no ATS found for test-key-123456' }) }) }), (e) => /could not read/.test(e.message) && !e.message.includes('test-key-123456'));

console.log('✓ unit ok');
