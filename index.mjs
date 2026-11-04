// @ts-check
// career-ops-plugin-bowmark: every open job at one company, read live from its
// own applicant-tracking system through Bowmark's job_search.atCompany.
// License: MIT
//
//   portals.yml:  - name: Stripe
//                   careers_url: https://stripe.com/jobs
//                   provider: bowmark
//   one-off:      node plugins.mjs run bowmark search "stripe.com: engineer"
//
// Both hooks only RETURN Job[]. The engine de-duplicates, applies
// data/blacklist.md and the portals.yml filters (manifest jobPostings: true),
// and writes data/pipeline.md. Network access goes through ctx.fetch only; the
// manifest allowedHosts pins it to api.bowmark.ai.

const RUN_URL = 'https://api.bowmark.ai/v1/run';
// The engine's default hook timeout is 15s. Bowmark gets 12.5s for the board and
// the request itself gets 14s, so a slow board fails with a clear message instead
// of the engine's generic timeout.
const BOARD_TIMEOUT_MS = 12_500;
const REQUEST_TIMEOUT_MS = 14_000;
const MAX_JOBS = 500;
const MAX_ARG_CHARS = 200;

function clean(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, MAX_ARG_CHARS) : '';
}

function redact(message, secret) {
  let out = String(message ?? '');
  if (typeof secret === 'string' && secret.length >= 6) out = out.split(secret).join('«redacted»');
  return out.slice(0, 300);
}

/**
 * "stripe.com: engineer"  -> { url: "stripe.com", query: "engineer" }
 * "Linear: product"       -> { company: "Linear", query: "product" }
 * "https://jobs.lever.co/acme" -> { url: "https://jobs.lever.co/acme" }
 * @param {string} raw
 */
export function parseSearch(raw) {
  const text = clean(raw);
  if (!text) return null;
  // Split on the first ": " (not the colon in "https://").
  const m = text.match(/^(.+?)\s*:\s+(.+)$/);
  const target = clean(m ? m[1] : text);
  const query = m ? clean(m[2]) : '';
  const looksLikeUrl = /^https?:\/\//i.test(target) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(target);
  return { ...(looksLikeUrl ? { url: target } : { company: target }), ...(query ? { query } : {}) };
}

/** Bowmark's CompanyJob -> career-ops Job. */
export function toJob(j, companyName) {
  const title = clean(j?.title);
  let url;
  try { url = new URL(String(j?.url ?? '')); } catch { return null; }
  if (!title || !/^https?:$/.test(url.protocol)) return null;
  /** @type {any} */
  const job = { title: title.slice(0, 250), url: url.href, company: companyName || '', location: clean(j?.location) };
  if (!job.location && j?.remote === true) job.location = 'Remote';
  if (typeof j?.id === 'string' && j.id) job.externalId = j.id;
  const posted = j?.postedAt ? Date.parse(j.postedAt) : NaN;
  if (Number.isFinite(posted)) job.postedAt = posted;
  // Only real, annual figures; career-ops never infers pay.
  const yearly = !j?.salaryPeriod || /year|annual/i.test(j.salaryPeriod);
  if (yearly && (Number.isFinite(j?.salaryMin) || Number.isFinite(j?.salaryMax))) {
    job.salary = {};
    if (Number.isFinite(j.salaryMin)) job.salary.min = j.salaryMin;
    if (Number.isFinite(j.salaryMax)) job.salary.max = j.salaryMax;
    job.salary.currency = typeof j.salaryCurrency === 'string' ? j.salaryCurrency.toUpperCase() : '';
  }
  return job;
}

/** @param {{url?: string, company?: string, query?: string, location?: string}} args @param {any} ctx */
async function atCompany(args, ctx) {
  const apiKey = ctx?.env?.BOWMARK_API_KEY;
  if (!apiKey) throw new Error('BOWMARK_API_KEY is missing. Add it to your .env (free key at https://bowmark.ai).');
  if (!args.url && !args.company) throw new Error('bowmark needs a company site, careers URL or company name.');
  const call = { ...args, maxJobs: MAX_JOBS };
  // The arguments travel as JSON data inside the script, never as code.
  const script = `const args = ${JSON.stringify(call)};
const r = await bowmark.job_search.atCompany(args, { timeoutMs: ${BOARD_TIMEOUT_MS} });
return { company: r.company, ats: r.ats, total: r.total, warnings: r.warnings, jobs: r.jobs.map((j) => ({ title: j.title, url: j.url, location: j.location, remote: j.remote, id: j.id, postedAt: j.postedAt, salaryMin: j.salaryMin, salaryMax: j.salaryMax, salaryCurrency: j.salaryCurrency, salaryPeriod: j.salaryPeriod })) };`;

  if (typeof ctx.log === 'function') ctx.log(`bowmark: open jobs at ${args.url || args.company}${args.query ? ` matching "${args.query}"` : ''}`);
  let data;
  try {
    const res = await ctx.fetch(RUN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'User-Agent': 'career-ops-plugin-bowmark/0.1.0' },
      body: JSON.stringify({ script }),
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    data = await res.json();
  } catch (err) {
    throw new Error(`Bowmark request failed: ${redact(err instanceof Error ? err.message : err, apiKey)}`);
  }
  if (!data?.ok || !data.result) {
    throw new Error(`Bowmark could not read ${args.url || args.company}: ${redact(data?.error || data?.status || 'no result', apiKey)}`);
  }
  const r = data.result;
  if (typeof ctx.log === 'function') {
    ctx.log(`bowmark: ${r.ats} board, ${r.jobs?.length ?? 0} of ${r.total ?? '?'} open jobs`);
    for (const w of Array.isArray(r.warnings) ? r.warnings.slice(0, 3) : []) ctx.log(`bowmark: ${clean(String(w))}`);
  }
  const name = clean(r.company) || clean(args.company);
  const seen = new Set();
  const jobs = [];
  for (const j of Array.isArray(r.jobs) ? r.jobs : []) {
    const job = toJob(j, name);
    if (!job || seen.has(job.url)) continue;
    seen.add(job.url);
    jobs.push(job);
  }
  return jobs;
}

export default {
  provider: {
    id: 'bowmark',
    detect: null, // fires only on an explicit `provider: bowmark` portals.yml entry
    /** @param {any} entry a portals.yml company entry @param {any} ctx */
    fetch: async (entry, ctx) => {
      const url = clean(entry?.careers_url) || clean(entry?.url) || clean(entry?.api);
      const company = clean(entry?.name);
      return atCompany({ ...(url ? { url } : {}), ...(company ? { company } : {}) }, ctx);
    },
  },

  /**
   * @param {string} query "<company site, careers URL or name>[: <title words>]"
   * @param {any} ctx
   */
  async search(query, ctx) {
    const args = parseSearch(query);
    if (!args) throw new Error('bowmark search needs a company: node plugins.mjs run bowmark search "stripe.com: engineer"');
    return atCompany(args, ctx);
  },
};
