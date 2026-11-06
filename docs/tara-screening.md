# Tara screening v2: CV claims

## Implementation boundary

Indonesia only, all packages; `TARA_SCREENING_ENABLED=false` by default. No deployment is performed by this change. The six candidate pages use the approved Talentio layout. Tara appears from the introduction onward. Company profile and cover letter uploads are optional and private.

Initial questions come from the selected immutable CV version. The job context provides common competencies and anchors, not universal questions. Every claim has an exact quote and source line range. New conversations have at most three initial questions and five follow-ups altogether, with at most two per root. First follow-ups cover all eligible roots before second follow-ups use the remaining budget in claim-priority order. A follow-up at depth two uses the depth-one answer. The result describes support or a need for confirmation; it is not a lie detector.

Prompt modules live only under `apps/api/src/ai-screening/prompts`: shared rules, task instructions, and examples are separate small files. `compose.ts` selects modules; schemas and session policy remain separate. Each context persists the assembled task instructions, output schemas, model, reasoning policy and output limits. Resuming a started session uses those frozen presets, including after a later prompt deployment. Change the prompt version when changing behavior. Job fingerprints include the methodology version and preset digest, so results from different requirements/methodologies are not ranked together.

## Operator preparation

1. Apply the additive Prisma migration and regenerate the client before enabling the feature. Build the shared package before the API and web.
2. Configure a valid `OPENAI_API_KEY`, private storage and `REDIS_URL`. The outbox in PostgreSQL is authoritative; Redis/BullMQ accelerates delivery. Database delivery recovers queued work while Redis is unavailable.
3. Keep `TARA_SCREENING_MARKET=id`. Set `TARA_SCREENING_ENABLED=true` only after live model, quality, cost, and operational checks pass. Railway/Uzbekistan must retain the flag off.
4. Turning the flag off stops new screening starts and new drafts. Existing started sessions can still resume and submit through their dedicated endpoint. The legacy flow stays available for non-rollout jobs/applications.

Job publication and substantive changes enqueue context preparation. A bounded reconciliation sweep repairs missed work. CV selection prepares a candidate plan while the candidate completes the next pages. Identical source pairs reuse cached application results. Selecting a different CV invalidates the previous selection; starting freezes the version, rubric and documents.

## Reliability and recovery

The database stores the active question, server deadline, last saved draft, locked answer, tab lease and revision. Acknowledging display starts the pinned timer: 30 seconds for new conversations, 60 seconds for pre-v4 conversations. Refresh does not reset it. AI waiting time creates no deadline. A different tab cannot submit while the current lease is active. Autosave makes no model calls.

Application finalization links the screening session, creates the unique application and queues evaluation in one transaction. Evaluation may finish afterward. Provider failures never create zero scores. After an answer opportunity, empty answers score zero on sampled claims. A provider failure never produces a score. Missing CV scores remain unavailable, with HR review required. Existing CV matching supplies the CV score; backend arithmetic combines complete scores 50:50. Ranking happens before pagination and remains separate by source version.

`GET /api/ai-screening/operations` is Super Admin only. It lists failed outbox jobs and uncertain provider calls. Inspect the provider response ID/billing before retrying an uncertain create request. A missing provider response, authorization error during polling, or a response pending beyond 15 minutes is sent to operational review rather than blindly creating another charge.

`POST /api/ai-screening/operations/:workId/retry` requires `{acknowledgePossibleCharge:true, reason:"..."}`. It records an audit event and retains earlier token/cost records. Recovery is an operator action; candidates are not asked to approve costs. Never delete uncertain call records to reset retries.

PDF rendering uses stored results, embeds Noto Sans and stores a private artifact. Viewing results, pagination and repeated downloads do not call AI. HR authorization checks company membership on each assessment or signed download request. Candidate erasure removes screening data, cancels its work, clears private provider results and deletes related cover/PDF objects while retaining non-content usage accounting.

## Verification commands

From the repository root:

```text
node apps/api/node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json
node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
node apps/api/node_modules/tsx/dist/cli.mjs --tsconfig apps/api/tsconfig.json apps/api/src/ai-screening/screening.smoke.ts
node scripts/tara-screening-local.cjs
node apps/api/node_modules/tsx/dist/cli.mjs --tsconfig apps/api/tsconfig.json apps/api/src/ai-screening/screening-report.smoke.ts
node --test scripts/recruiter-package-onboarding.smoke.cjs
```

The local integration runner creates and destroys a uniquely named database on the existing Docker PostgreSQL at `127.0.0.1:5434`. It does not load application credentials into tests or contact a model. The browser test `scripts/tara-screening-ui.cjs` uses a local Next server and intercepts all API calls with synthetic fixtures. Configure `TARA_UI_ORIGIN` and, where necessary, `CODEX_RUNTIME_NODE_MODULES` for Playwright. Screenshots and PDF fixtures go under ignored `tmp/` and `output/` paths.

The main API smoke suite passes. Relevant HR editor/detail tests and recruiter onboarding/package tests pass. The wider existing web suite currently has unrelated stale refresh tests in `journey-sync-ui.smoke.cjs` and `job-promotion-ui.smoke.cjs` (refresh cooldown assumptions and a missing `useApiResource` harness dependency); those application hooks were not changed by this implementation.

## Cost and release gate

`AiScreeningCall` stores input, output, cached and reasoning tokens, raw usage, retry status and pricing. Reasoning tokens are a subset of output tokens and are not counted twice. When cache-write usage is absent, the cost calculation conservatively applies the write rate to uncached input. Cost arithmetic is independent of the candidate flow: no cost threshold terminates an application.

An explicit `node scripts/tara-screening-local.cjs --live` runs a synthetic sample using existing local key configuration. It writes `output/tara-cost/live-sample.json`, including provider IDs, observed usage and projections for 50, 100, 200, 300, 400, 500, 750 and 1,000 applicants. Unfinished calls must be cancelled/reconciled before discarding test state. An incomplete lifecycle must never be reported as a successful zero-cost result.

**Release is not yet approved:** one configured key returned `401 invalid_api_key`; the alternative passed preflight but its background response did not complete within the sample window. The US$0.01 target is unverified. The current fixture documents approximate the requested extreme sizes; acceptance must use verified 6,000-token CV, 10,000-token company profile and 3,000-token job fixtures and representative completed sessions. Include abandoned sessions, CV replacement, cache writes/reads and retries in the denominator and report both per-start and per-completion costs. Validate model output against human-reviewed strong/weak/ambiguous/empty/corrected-claim examples and equivalent evidence with different names or wording before rollout.

## References

- [OpenAI prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI background responses](https://developers.openai.com/api/docs/guides/background)
- [OPM structured interviews](https://www.opm.gov/policy-data-oversight/assessment-and-selection/other-assessment-methods/structured-interviews/)

Personalized CV questions are not automatically equivalent to a fully standardized interview. The shared rubric and equal competency weights require human quality/comparability validation; the 50:50 composite is the initial product policy.


## Conversation enhancement v4

Each job package stores a nullable `conversationPolicy` snapshot. Missing snapshots resolve to legacy limits (5 + 10, 60 seconds, per-claim probing). New packages freeze 3 + 5, 30 seconds, breadth-first probing, 35 words and 280 characters per question. `conversationPolicy` in the session response exposes only version, questionSeconds and maxQuestions. Active sessions keep their frozen policy and prompt; unstarted drafts refresh on reopen, CV selection or Start. New prompt fingerprints do not re-evaluate existing results or regenerate PDFs. The 0–4 claim methodology stays v3. New conversations use a separately versioned v3.0.3 clarification of score boundaries and factual contradictions. The AI supplies evidence-grounded level and detail categories; backend mapping derives 0–4 without extra AI calls. Accepted historical v3 results are retained without automatic re-evaluation.

The candidate/follow-up composer includes modular Gen Z voice and humor; the assessment composer does not. Generated chat uses gue/lu, one focus, no colon/list/speaker labels, and at most one emoji. Explicit discomfort reduces humor on subsequent generated follow-ups through `tonePreference`; pre-generated initial questions remain grounded and stable. Prior candidate slang, humor or formality never changes scoring rules.

Local checks include `conversation.smoke.ts`, `screening.smoke.ts`, `claim-assessment.smoke.ts`, the disposable integration runner, mocked browser checks, and `node scripts/tara-screening-local.cjs --conversation-quality`. Live quality evaluation uses synthetic profiles only, records all attempts and provider usage in `output/tara-conversation/`, and keeps held-out fixtures out of prompt modules. No VPS deployment is part of this change.
