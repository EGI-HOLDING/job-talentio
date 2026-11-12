**AI reliability regression gate**

This suite verifies the current recruitment and screening flows. Passing it is evidence for its covered scenarios; it does not establish that all production journeys or live-provider behavior pass.

Run from the repository root with the existing local PostgreSQL, MinIO, Mailpit, and development dependencies. Do not run against production data. Local integration harnesses create disposable databases and buckets and enforce loopback guards.

```powershell
node scripts/ai-reliability-regression.cjs --unit --integration
```

The integration group builds the API before exercising its compiled Nest dependency graph, authentication, private storage, SMTP, and recruitment APIs. It also creates a disposable Redis container from the installed local Redis image. Three companies import 1, 10, and 100 CVs through real HTTP and storage while Redis is stopped and restarted on the same port. A pre-expired database lease simulates an interrupted worker. No paid provider calls are made.

For browser fixtures, start the current web with `NEXT_PUBLIC_HR_CREATION_V2=true` at `http://127.0.0.1:3035`, then:

```powershell
node scripts/ai-reliability-regression.cjs --browser
```

The browser gate covers onboarding navigation/reload, skip confirmations, upload list accumulation and retry identity, CV-only application submission, stale verification tabs/account switches, voice permission/join/disconnect/end states, HR result/evidence/transcript/PDF navigation, and the four AI job-drafting actions. AI job drafting must not send two requests on a rapid double click or replace manual content before preview acceptance.

When both `--integration` and `--browser` are selected, the gate also runs a browser journey against its disposable Nest, PostgreSQL, MinIO, and Mailpit services. It verifies a single CV-only application, a single durable CV scoring job, the resulting score and rationale in the HR drawer, tenant isolation, and an invitation unlocked by verification in a separate browser context. Provider output is simulated. The same journey can be rerun directly with `node scripts/recruitment-http.cjs --browser` after the API build. The combined gate also exercises company registration, Free checkout, draft navigation/reload, Skip confirmation, and ten-file onboarding in two selections through the real API. Use `node scripts/recruitment-http.cjs --onboarding` to run it alone.

An opt-in probe checks all four drafting actions against GPT-6 Luna with a synthetic company profile, including an injected instruction that must be ignored. It checks the validated suggestions and verifies that they do not save changes to the job. Run after the API build:

```powershell
$env:RELIABILITY_LIVE_AI='1'
node scripts/recruitment-http.cjs --live-draft
```

The probe makes at most four provider requests. To diagnose one action, set `RELIABILITY_DRAFT_TARGET` to `description`, `responsibilities`, `kpis`, or `skills`. Invalid output is recorded only for the synthetic test context.

`tara-screening-ui.cjs` and `hr-assistant-onboarding.browser.cjs` contain historical application-time screening or inert-upload assumptions. They are not part of this current-flow acceptance gate. Their existence must not be counted as proof for the replacement flows.

The live-screening probes use a disposable browser, database, MinIO and local Mailpit. The voice probe substitutes a local synthetic WAV for microphone capture while using actual WebRTC and the configured voice provider. It prepares, evaluates, verifies evidence, and checks the HR PDF. The text probe uses a single synthetic CV claim and submits a bounded injection attempt through the chat UI. CV scores are fixtures in both probes.

```powershell
$env:RELIABILITY_LIVE_AI='1'
node scripts/recruitment-http.cjs --live-text
$env:RELIABILITY_VOICE_WAV='C:/path/to/synthetic-candidate.wav'
node scripts/recruitment-http.cjs --live-voice
```

Use only synthetic inputs and a known local audio file. The `--text-ui` mode replays three questions with a long answer on a mobile viewport without paid calls. These probes test one session each and stop on a failed provider work item before starting its paid retry. Timing and fault-policy fixtures remain separate from the live samples.

**CV pipeline load and real-provider evidence**

The CV probe uses actual HTTP import/completion/ranking endpoints, private local object storage, the durable database worker, and synthetic PDF documents.

```powershell
$env:RELIABILITY_CV_PROFILE='bulk'
node scripts/ai-reliability-cv.cjs
```

This profile uploads 100 unique files, stops/restarts the worker around enqueueing, and measures each file from `CV_RECEIVED` to `CV_ANALYZED`. The AI is a fixture. Its throughput results must not be labelled as real AI latency.

Real AI is a separate explicit opt-in. Use a bounded number of samples; the script reads the local key without printing it:

```powershell
$env:RELIABILITY_LIVE_AI='1'
$env:RELIABILITY_CV_PROFILE='detailed' # small, detailed, or long
node scripts/ai-reliability-cv.cjs
```

The real probe records provider request/queue/processing observations, usage, elapsed E2E time and the validated synthetic assessment. A sample exceeding 180 seconds fails its latency gate even if its result eventually completes. The existing request continues to be observed; it must not be restarted merely because the observation deadline expired. A process with unresolved provider requests retains its isolated database/bucket for recovery, rather than deleting its request identity. Inspect the run manifest and live process before another attempt. Terminal runs clean their own isolated resources.

Results default to `output/ai-reliability`; override with `AI_RELIABILITY_OUTPUT` for review artifacts. A finite three-sample provider probe is not a statistically reliable p95 or a concurrent-company load result.

The format probe checks a genuine Word DOC, DOCX and image-only PDF from two synthetic companies through the real API and durable worker. Put `CV-Dinda-Synthetic.doc`, `CV-Dinda-Synthetic.docx` and `CV-Dinda-Scan-Synthetic.pdf` in the fixture directory. Set `RELIABILITY_CV_FORMAT` to `DOC`, `DOCX` or `SCAN` for a single-format probe. The invalid-file control never calls the model.

```powershell
$env:RELIABILITY_LIVE_AI='1'
$env:RELIABILITY_CV_FIXTURES='C:/path/to/synthetic-cv-fixtures'
node scripts/recruitment-http.cjs --live-cv-formats
```

The observation can continue beyond 180 seconds to recover the same response. An unresolved synthetic call keeps its disposable database and bucket; inspect its retained-provider manifest before retrying.

**Taka CV scoring recovery**

- Run `node scripts/recruitment-local.cjs --taka-only` against the disposable local database. It covers evidence repair, missed pages, simulated provider delays, retries, webhook reconciliation, tenant isolation, and batches of 1, 10 and 1,000. The HR browser regression covers the transition from processing to delayed to scored while the detail drawer is open.
- In the current CV response format the model tags evidence on source blocks and the application assigns their IDs. Page recovery uses retained evidence and, when the PDF can be split, sends only the pages still needed. The same response can complete scoring. A completed repair that adds no valid grade or resolves no additional page is handed to the operator with the saved evidence.
- After the API build, run `node scripts/recruitment-http.cjs --taka-v2` for the Nest/JWT, S3, status and webhook routes with the synthetic provider. This also exercises a Tara invitation using a v2 CV result.
- The separate document check is `node apps/api/node_modules/tsx/dist/cli.mjs --tsconfig apps/api/tsconfig.json apps/api/src/ai-screening/recruitment/cv-document.smoke.ts`. Set `TAKA_LOCAL_RENDERER` to the loopback renderer's `/render` endpoint to exercise real Word conversion and verify that the rendered PDF still contains embedded images.
- The synthetic real-provider check is `cv-assessment.live.ts` with `TAKA_CV_LIVE=1` and the local OpenAI key. It submits at most two requests, for a two-column PDF and an image-only PDF. It logs timings and checks against the known content of each fixture. Use the deterministic checks for fault injection.
- Apply the additive migration before enabling `CV_SCORING_V2_ENABLED=true`. Set `CV_SCORING_V2_COMPANIES` to the initial company IDs, comma separated. An empty list enables the new policy for all newly queued assessments. Disable the flag to stop admitting new work while already queued work retains its version. Keep a v2-aware worker until those jobs drain. Review project retention and the RPM/TPM settings before increasing the pilot.
- Configure the OpenAI webhook at `/api/recruitment/provider/openai` using `OPENAI_CV_WEBHOOK_SECRET` and the terminal response events. Use the renderer Compose overlay with the stack that defines the API. If the main Compose file sits outside the repository Docker directory, set `CV_RENDERER_CONTEXT` to the absolute path of `infra/cv-renderer`.
- Operators can list delayed and failed work via `GET /api/recruitment/cv-recovery` and resume it with `POST /api/recruitment/candidates/:id/cv-recovery` and `{"action":"RESUME"}`. For an unconfirmed POST, use the attempt ID and OpenAI request trace. `CONFIRM_NOT_ACCEPTED` requires a provider investigation reference and only applies to an unconfirmed request without a response ID.

**Taka assessment of Tara interviews**

- Run `node scripts/recruitment-local.cjs --taka-interview-only` for the scored subset, Live/Chat parity, cited evidence, recovery, historical behavior, tenant access, and generated PDF on disposable data. The HR browser check is `node scripts/screening-workspace.browser.cjs` with a local preview and mocked responses.
- `TAKA_INTERVIEW_EVIDENCE_ENABLED=true` freezes the new evaluator on newly created v8 invitations. A later flag change affects future invitations. Activation requires evidence and rubric calibration with synthetic transcripts, separately from the deterministic tests. Track evaluation status, coverage, retry, and unexpected references without logging candidate text.

**Current production acceptance still requires**

The remaining gates include real AI latency across multiple companies, other supported CV formats, live voice fault and language coverage, deployment verification on the primary domain, and a full rehearsal. These gates remain separate from fixture-based browser acceptance and must have their own evidence before declaring the mission complete.
