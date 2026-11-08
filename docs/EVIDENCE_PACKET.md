# Evidence packet and review boundary

## Customer flow

1. Collect, inspect, and attach the relevant provider evidence to the case. Connector previews that have not been attached are not included.
2. Run the investigation or prepare an evidence template. Fresh investigations use the updated topic routing and response instructions.
3. Open Report and download the evidence PDF. Draft copies are explicitly labeled for review. Save any response edits first.
4. Optionally approve the saved revision to record merchant review. Downloading, approval and S3 archival never submit to Stripe.

Report preview and Review package use the same response/source presentation. Material limitations remain in the PDF. Internal category diagnostics from old investigations are accessible separately, not presented as proof that a document is absent.

## Implementation

- `lib/report/packet.ts`: stable source numbering, readable citations, legacy diagnostic separation, review notes, export preconditions.
- `lib/report/pdf.ts`: lazy-loaded PDF generation using pdf-lib and fontkit. Embedded Ubuntu regular/bold fonts are licensed under the bundled Ubuntu Font Licence (`public/fonts/UFL.txt`). Source: pdf-lib's Ubuntu font assets. All fonts load from this app's origin.
- `components/workspace/evidence-packet.tsx`: shared preview. The PDF renderer independently paginates content, avoiding browser print controls, URLs and clipped textareas.
- `lib/investigation/sections.ts`: case-local topic routing. Matching words route evidence but never assert a fact. Provenance-defined sections are retained. Combined unclassified documents can cover more than one topic.

The PDF uses Letter pages, 48-point margins, repeated headers, page numbers, source IDs, UTC timestamps and a source appendix. Long references wrap within margins. Font-unsupported characters are preserved as explicit Unicode code point notation with a typography note. There is no silent truncation of saved source text. Original binary attachments are not embedded; their filenames are listed and the originals remain in the case. Signed download URLs and credentials are not included.

The response reflects the saved case revision. Export requires a saved, current draft and all cited sources. It does not approve, persist, call a model or provider, or claim that available sources prove delivery or attendance. Existing historical drafts are not silently rewritten. Reinvestigation updates the narrative and review metadata. Model responses over 400 words or containing internal strategy/checklist language receive corrective feedback; material qualifications remain required.

## Disabled submissions

`aws/stripe.ts` and `lib/stripe/service.ts` unconditionally reject submission with HTTP 409 and `submission_disabled`. Both report `submissionEnabled: false`. The old environment flag cannot override the restriction. Stripe update calls were removed from both services. Read/sync and webhook ingestion remain available.

## Verification

Run `npm run check` and the investigation UI Playwright suite against a local preview. Unit tests cover combined document routing, conflicting source IDs, PDF pagination/Unicode, stale snapshots, missing citations and immutable exports. The Stripe service tests exercise both legacy flag values and assert no client calls or database writes. Browser checks cover pre-approval PDF download, dirty/stale gates, readable preview, source inspection and reviewed JSON export. Real customer PDFs and screenshots belong only in ignored local output directories, never in Git.


## Verified development deployment

On November 8, 2026, the full project check passed, followed by 422 investigation/AWS/PDF tests after the final response-format change. All 14 investigation UI scenarios passed across the initial run and targeted reruns. The hosted browser check downloaded a seven-page packet containing seven real saved records, checked desktop/mobile behavior, and confirmed export caused no POST requests or case changes. A direct request for a nonexistent submission probe returned `409 submission_disabled`. The real draft was then editorially corrected against its sources and saved as an unapproved revision; it was not submitted. Rendered PDF pages were inspected for overflow, headers, source references and pagination.

The app remains on the development Worker with AWS persistence. This feature branch does not merge into main or incorporate concurrent work on other branches. The private example PDF under ignored `output/pdf/` and local verification files under `.aws-build/` are not part of the GitHub handoff.
