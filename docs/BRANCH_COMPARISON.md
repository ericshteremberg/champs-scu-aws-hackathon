# Branch comparison and integration decision

The integrated product combines Causality's interface and review controls with Casework's scoped investigator. The final hackathon backend and storage run on AWS.

| Area | Causality baseline | Casework prototype | Integrated choice |
| --- | --- | --- | --- |
| Product | Complete Causality landing page and workspace | Separate case dashboard | Preserve Causality's interface and identity |
| Identity | Managed ChatGPT owner identity | Shared operator token | Preserve owner scoping; protected Wrangler preview uses a fixed shared development reviewer |
| Backend | Vinext/Cloudflare routes | Node/Express | Private AWS Lambda API with an authenticated frontend bridge |
| Database | D1 | Local SQLite | Native DynamoDB entity items and conditional transactions |
| Investigation | Templates and pattern matching | Bedrock tool loop and sample investigator | Reuse the portable engine, run jobs asynchronously in Lambda |
| Evidence access | Attached records and Stripe connector | Merchant-owned case API | Preserve attached records and add verified case-scoped merchant reads |
| Files | Private R2 objects | Standalone prototype attachments | Direct signed S3 uploads, server validation, private downloads |
| Approval | Exact draft revision | Reviewed response state | Preserve approval and add source revision and active-run guards |
| Archive | Original attachments | Optional S3 packet archive | Private S3 originals plus explicit approved JSON archive |
| Samples | Three generic disputes | Three ticket-delivery scenarios | Preserve all six with fictional-data labels |
| Financial actions | Separately enabled Stripe text submission | Export only | Preserve guarded Stripe integration; no new refunds or customer messages |

## Source checkpoints

The integration started from these remote revisions:

- Causality `origin/main`: `0e2f191bcd7a60cee59886878f626c85b26c845b`.
- Casework engine baseline: `4c707e72906bc8abf918c4d715a16260a8ddda71`.
- Later Casework recording/assets commit: `c32e19038629a4ae1210698fcb3d1b3cb8371672`.
- Integration branch: `codex/integrate-aws-causality`.

These identify source inputs, not the final merged commit. Use the current Git history and final pushed-commit report for the delivered `main` revision. The standalone feature branch remains a historical prototype.

The `docs/demo/` recording and associated older capture/edit scripts show standalone Casework. They are retained as historical material and do not demonstrate the final combined interface.

## AWS ownership

Wrangler serves the frontend and authenticates the controlled preview. It IAM-invokes a private Lambda with trusted user identity; there is no public Lambda URL accepting arbitrary user headers. The Lambda execution role owns DynamoDB, S3, Bedrock, and asynchronous job invocation.

The AWS stack is `causality-hackathon-dev` in `us-east-1`. Direct AWS acceptance passed for native persistence, owner isolation, asynchronous investigations, private S3 files, cancellation, concurrent approvals, archives, and a complete real Nova investigation using `us.amazon.nova-2-lite-v1:0`. The public frontend bridge remains under final verification; direct Lambda tests do not establish the complete HTTPS browser path.

The development Worker has no D1 or R2 binding. Its temporary D1 database was deleted. Original D1/R2 code and immutable migrations remain for Sites compatibility and local regression tests, not as a hidden AWS database shim.

## Preserved controls

Native DynamoDB compare-and-set transactions protect each entity version. Evidence mutations invalidate source freshness and prior approval. An investigation can publish only if its run remains active and its source, draft revision, and approval state remain current. Progress events are separate items so a growing trace does not consume a single database item's size budget.

A background job claims its queued run before invoking the engine. The UI polls saved progress and can cancel the job's future steps. Model output always requires fresh human approval. Existing Stripe account binding, idempotent submission, file restrictions, and submitted-case locks remain in place.

## Excluded architecture

The final application does not run Casework's Express server, local SQLite store, second frontend, or shared operator-token account model. The A10-specific CLI supervisor is not the focus of the AWS-track submission.

The protected development password is only a team preview access mechanism. It does not replace the retained Sites-managed identity integration or establish a production multi-user authentication system.
