# career-ops-plugin-bowmark

A community plugin for [career-ops](https://github.com/career-ops-hq/career-ops).

## What it does

Lists every open job at one company, read live from that company's own applicant-tracking system: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Workday, Teamtailor, BambooHR, Rippling, Personio or Breezy HR. You give a company site (`stripe.com`), a careers page, a board link or just a name, and it finds the board.

It adds two hooks:

- `provider`: put `provider: bowmark` on a `portals.yml` entry and `scan` reads that company like any other portal. Useful for companies whose board is not one career-ops already reads directly.
- `search`: a one-off lookup, `node plugins.mjs run bowmark search "stripe.com: engineer"`.

Both return postings with title, URL, company, location, and, when the board publishes them, the posting date and yearly pay range. career-ops then drops anything already in your tracker, pipeline or scan history, applies `data/blacklist.md` and your filters, and writes the rest to `data/pipeline.md`.

## Install

```bash
# Once it's in the career-ops registry:
node plugins.mjs add bowmark

# Before listing (install from the repo at a pinned commit):
node plugins.mjs add bowmark-ai/career-ops-plugin-bowmark --sha <40-hex-commit>
```

Then enable it. The capability card shows that it contacts `api.bowmark.ai` and reads `BOWMARK_API_KEY`:

```bash
node plugins.mjs enable bowmark
node plugins.mjs enable bowmark --confirm
```

## Configure

Put `BOWMARK_API_KEY=...` in your `.env` (data root). Keys are at [bowmark.ai](https://bowmark.ai).

```yaml
# portals.yml
- name: Stripe
  careers_url: https://stripe.com/jobs
  provider: bowmark
```

```bash
node plugins.mjs run bowmark search "Linear: product" --dry-run
```

## Limits to know about

- **One company per call.** Up to 500 postings each.
- **Boards it can read.** The twelve systems above. A company on another system, or a careers page with no link to a supported board, returns an error naming what was checked.
- **Name lookups can guess.** Given only a name, the plugin asks each system for a board under that name. Give the company's site when you can.
- **15 second limit.** career-ops gives a hook 15 seconds. Most boards answer in under 10; a slow one fails with a clear error.
- **What it sends.** Only the company and your title words go to `api.bowmark.ai`. Nothing from your CV or profile.
- It never applies to jobs.

## Tests

```bash
node test/smoke.mjs   # imports cleanly, hooks match the manifest
node test/unit.mjs    # parsing, mapping and the request shape, no network
```

## License

MIT
