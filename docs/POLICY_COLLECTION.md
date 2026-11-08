# Policy collection and evidence

Policy collection extends the existing workspace policy library, authorized connectors, DynamoDB evidence records and private S3 originals. It introduces no new database or customer credentials. Submissions remain disabled.

## Merchant workflow

1. Open Policies, then Add policy version. Choose terms, refund or cancellation policy and supply pasted text, a public HTTPS URL, or a PDF/UTF-8 text file. Enter the declared effective date, optional exclusive end date and optional prior version.
2. Causality saves a new immutable version, collection time, original bytes and SHA-256. URL captures retain the fetched source separately from extracted text. A current website capture is never represented as a historical checkout screenshot.
3. In Connections, select a case and run Get evidence. Independent Stripe, Supabase, Resend and IMAP previews run together. The policy stage then refreshes approved database originals, matches policy versions, searches Gmail and IMAP, and refreshes the saved case. Case-changing steps run sequentially to preserve optimistic concurrency checks.
4. Prepare a fresh investigation after collection. Added records invalidate previous approval. The investigator receives attached policies before drafting and examines disclosure, acceptance and refund/cancellation correspondence separately.
5. Download the evidence PDF for review. It includes numbered factual arguments, cited fact rows, policy clauses and retained originals. No dispute, refund or email is sent.

## Dates and evidence strength

Matching uses the verified original Stripe charge timestamp and exact order/payment boundary. Where a connector has already supplied an unambiguous trusted `purchasedAt`, `paidAt` or `orderCreatedAt` field, that timestamp can be used if Stripe is unavailable. Case creation and dispute dates are never purchase-date substitutes.

For each policy family, select the latest declared effective date at or before the purchase, provided its exclusive end date has not passed. Do not resurrect an older version after its replacement expires. Same-date versions remain ambiguous and are retained as candidates. Versions captured after the purchase explicitly retain that qualification. The declaration alone does not establish which version was actually used at checkout.

Policy possession, historical applicability, disclosure and acceptance are different facts. A matching effective date never marks acceptance verified. Approved Supabase mapping now allows a related `policy` table, so merchants can expose checkout disclosures, consent records and version identifiers within their existing scope. No new columns are silently approved. Related records are search matches for review, not inferred proof. A nonrefundable clause does not establish service delivery or determine the dispute outcome.

Gmail and IMAP reuse customer-authorized read access. Policy searches include refund, cancellation, terms, policy, consent, acceptance, agreement, disclosure and checkout language. Auto-import requires an exact customer email in the envelope and exact order reference in the subject/body. Same-customer messages lacking an order reference require individual review. A request is not proof that a refund was paid or a cancellation completed. Existing mailbox text-extraction and folder/recency bounds remain; original mailbox attachments are not newly collected by this feature.

## Implementation and limits

- `POST /api/policies`: `save`, `prepare-upload`, `finalize-upload`. Uploads use existing S3 presigned POST and size/signature checks. DynamoDB `policy#` rows remain the library; `policy-family#` tracks monotonically increasing version numbers. Legacy text-only versions still display and can match with explicit qualifications.
- `GET /api/policies/:id`: workspace-owned, short-lived signed original download. Attached case evidence uses the existing `/api/evidence/:id` endpoint. Removing a library entry does not delete an already attached case original.
- `POST /api/policies/collect`: `records`, `gmail`, `imap` and `match` stages. Case IDs are ownership-checked. Deterministic evidence IDs deduplicate retries, connection/version checks prevent stale grants, and existing case revisions clear approval.
- URL retrieval checks each redirect, validates all DNS answers, pins a public IP to HTTPS, forwards no credentials, and enforces 12 seconds and 2 MB. PDF/text uploads support 10 MB and PDFs up to 50 pages. `unpdf` extracts PDF text in Lambda; image-only PDFs remain original documents with an extraction notice, not invented OCR.
- Text extraction retains up to 24,000 characters for matching; all original bytes remain in S3. Automatic clause excerpts select up to 12 matching passages, with the complete policy available for inspection. Up to 40 new policy attachments fit a collection transaction; additional matches are reported for another pass. Existing 90-record case and 100-version library limits apply.
- Mail collection inspects up to three pending results per provider per pass from the connector's bounded search. Repeated passes deduplicate attached records. Unlinked candidate messages remain manual review items.
- `lib/report/policy-renderer.ts` renders retained text/HTML snapshots as labeled text exports. It never executes retained HTML. Large visual previews explicitly mark their excerpt boundary; the complete original is embedded. Native policy PDFs reproduce their original pages through the existing exhibit system.
- `lib/report/packet.ts` parses numbered headings and `Label | Value [citation]` fact rows without inferring or discarding prose. Legacy drafts still render. The prompt preserves material contradictions and requires supported headings, exact quotes and a defensible conclusion without a fixed page/evidence target.

## Verification and handoff

Tests cover immutable text/URL versions, PDF upload extraction and idempotent finalization, purchase-date boundaries, expired/replaced versions, ambiguous versions, owner isolation, exact-order mail matching, URL SSRF/redirect defenses and existing disabled-submission behavior. Local browser checks cover all three form paths, sequential Get evidence stages and a monochrome PDF containing both a rendered policy capture and an original PDF attachment. Provider/S3 operations use synthetic fixtures; this does not claim a live merchant authorization or deployment test.

Verification completed: TypeScript and frontend/AWS builds passed; the full investigation/AWS/PDF suite passed 456 tests; three targeted browser scenarios passed, with rendered PDF pages visually checked. Targeted ESLint reported no errors (existing warnings remain). The Lambda-style bundled PDF extractor also passed a synthetic document check.

Changes are on `codex/policy-evidence-workflow`, based on `codex/evidence-pdf-review`. Push this feature branch for review; no default-branch merge or hosted deployment is part of this handoff. Build/deploy the AWS bundle and frontend together when adopting the branch. No migrations or new IAM permissions are required. This repository has no root `context.md`; architecture notes are maintained here and in HANDOFF.md and EVIDENCE_PACKET.md.
