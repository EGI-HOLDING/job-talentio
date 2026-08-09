# CV parse providers (local-first)

Job Talentio parses CVs **asynchronously** (BullMQ `cv-parse` worker) so upload requests stay fast. Extraction is behind a swappable provider interface.

## Architecture

```
Upload/attach -> store file -> parseStatus=PENDING -> queue
  -> CvParseService.processResume
  -> CvParseProvider.parse(buffer)
  -> parsedData + parseStatus=READY|FAILED
```

Provider selection is env-driven. Orchestration and UI do not change when swapping tools.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `CV_PARSE_PROVIDER` | `local` | `local` \| `affinda` \| `llm` |
| `CV_PARSE_OCR` | `true` | Local only: OCR thin/scanned PDFs via tesseract.js |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ (in-process fallback if unavailable) |
| `AFFINDA_API_KEY` | - | Future Affinda integration |
| `LLM_*` | - | Future LLM provider credentials |

## Providers

### `local` (free, current)

Implementation: `apps/api/src/profiles/parse/providers/local-cv-parse.provider.ts`

1. PDF text: `pdf-parse`
2. DOCX text: `mammoth`
3. If PDF text is thin (< 80 chars) and `CV_PARSE_OCR` is on: rasterize page 1 (`pdfjs-dist` + `@napi-rs/canvas`) and OCR with `tesseract.js` (30s timeout). Soft-fail keeps thin text.
4. Structured fields: existing heuristic `parseCvText` + skill catalog

`parsedData.meta` may include `{ provider: 'local', ocrUsed: boolean }` (UI should ignore).

### `affinda` / `llm` (stubs)

Factory returns stub providers that fail with a clear `parseError` until real API clients are implemented. Swap path:

1. Implement `AffindaCvParseProvider` / `LlmCvParseProvider`
2. Map vendor JSON -> `ParsedCvData`
3. Set `CV_PARSE_PROVIDER=affinda` or `llm` + credentials

## Pricing notes (when leaving free tier)

### Affinda

- Paid per document (credit). Self-serve roughly US$0.20/CV; annual packs lower the unit cost.
- Trial often available (~14 days).

### LLM APIs

- Paid per token. Typical CV extract ~US$0.01-0.05 (text) or higher with vision.
- Self-hosted open models: software may be free; GPU/infra is not.

## Performance rules

- Never run OCR/LLM/Affinda on the HTTP upload path.
- Worker concurrency stays low (2).
- Disable OCR on constrained hosts: `CV_PARSE_OCR=false`.
