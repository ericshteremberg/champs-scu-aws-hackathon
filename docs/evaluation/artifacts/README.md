# Current Causality sample rehearsal

Captured November 7, 2026 Pacific from a fresh local build of application commit `e03de6119d27b63f6e2f0e483d4e1d010cbdc6fc`. Exact timestamps, source-tree fingerprint, run IDs, labels and action timings are in [rehearsal.json](rehearsal.json). The application diff was empty at capture time.

**Mode: deterministic sample. All case data is fictional.** This uses the retained local Sites D1/R2 compatibility runtime at `http://127.0.0.1:8788`. It makes no Bedrock request, uses no deployed login, and does not exercise the AWS bridge, DynamoDB, S3 archival or production connectors. The app's own sample labels remain visible. No shared smoke test ran during capture.

| Artifact | What it shows |
| --- | --- |
| [Silent walkthrough](causality-local-sample.webm) | All three ticket reports; original customer acknowledgement; saved reviewer edit, exact-revision approval and sample export. About 36 seconds, 1440 × 1000, VP9 WebM. No narration. |
| [ATM-1042 report](ATM-1042-report.png) | Supported sample assessment and source links |
| [ATM-1042 source](ATM-1042-source.png) | Original fictional “Found both tickets” message |
| [ATM-1042 approval](ATM-1042-approved.png) | Saved revision 2 and its approval state; sample remains non-submittable |
| [Reviewed sample TXT](ATM-1042-reviewed-sample.txt) | Actual browser download, explicitly marked synthetic and not for submission |
| [ATM-1043 report](ATM-1043-report.png) | Mixed sample assessment; evidence needs a closer look |
| [ATM-1044 report](ATM-1044-report.png) | Insufficient sample assessment; more evidence needed |

The capture assertions verified all three expected sample labels, the source inspector, the unsaved-edit approval gate, saved approval, the exported synthetic warning and zero JavaScript page errors. The five screenshots were visually inspected. The existing complete browser suite passed separately: **13 tests in 23.2 seconds**. Its upload and failure scenarios simulate AWS responses rather than calling real S3 or Bedrock.

The reviewer note was appended by browser automation as an explicit demo edit; it is not evidence of a person's claim review or measured operator effort. This is a workflow backup, not a narrated pitch or a release-quality live inference recording. Submission-package work is deferred at the user's request.

To regenerate, follow [the evaluation instructions](../README.md). Historical standalone Casework recordings under `docs/demo/` remain untouched.
