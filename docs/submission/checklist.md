# Submission checklist

Last checked: 2026-11-07. Status words: **Verified** (seen at the source), **Unverified** (could not confirm), **Open** (still to do).

## Organizer requirements

| Item | Status | Source and note |
| --- | --- | --- |
| Event dates | **Verified, with a conflict** | [aws.scuacm.com](https://aws.scuacm.com/) header says November 7-8, 2026. The same page labels Day Two "November 17th, 2026", which looks like a typo for the 8th. Confirm with organizers. |
| Submission deadline | **Verified, date to confirm** | Same page: "DevPost Submissions Due!" at 9:00 AM (PST) on Day Two. If Day Two is Nov 8, that is the morning after the hackathon starts. |
| Devpost Q&A | **Verified** | 8:30 AM Day Two, Bergin 116. |
| Demos and judging | **Verified** | Judging begins 9:15 AM, finalist presentations 11:00 AM, Bergin 116. |
| Team size | **Verified** | FAQ: 2-6 people per team. |
| Eligibility | **Verified** | FAQ: Santa Clara University undergraduate and graduate students. |
| AWS use | **Verified** | Track FAQ: all teams are encouraged to use AWS services. |
| Presentation length | **Unverified** | Devpost returned HTTP 403 to my fetch. Read the listing and rules by hand. |
| Demo video limit and hosting | **Unverified** | Same reason. Do not rely on a generic "3 minutes". |
| Required Devpost fields | **Unverified** | Same reason. |
| Teammate registration / team check-in | **Open** | The site lists "Check in your team" and a "Team portal". Confirm each teammate is registered and the team is checked in. |
| Track choice (A10 problem statement or general) | **Open** | The site mentions an A10 track with its own problem statement. Confirm which track Causality is entered in. |

Links to re-check by hand: <https://aws.scuacm.com/>, <https://a10-x-aws-hack-26.devpost.com/>, <https://a10-x-aws-hack-26.devpost.com/rules>.

## Evaluation (from the handoff)

- [x] Three evaluation cases run live (two runs each, 2026-11-07) and compared claim by claim against the fixtures ([results.md](../evaluation/results.md)). AI-assisted; human confirmation still **open**.
- [ ] Human source-level review of the material findings, ideally with Aiden.
- [ ] Reasoning failures sent to Aiden; interaction problem sent to Eric (drafted in results.md, not sent); affected cases rerun after fixes.
- [x] Unresolved limitations disclosed in the results file. Still to add to the submission text.

## Presentation and recording

- [ ] Script trimmed to the verified time limit.
- [ ] One full rehearsal of the final release.
- [ ] Fresh backup recording of the current Causality app (not the older `docs/demo/` standalone Casework video).
- [ ] [recording-manifest.md](recording-manifest.md) filled in with the final build, inputs, inference mode and date.
- [ ] Current screenshots captured, with no passwords, tokens, QR/redemption secrets or customer exports visible.
- [ ] Live inference, recordings, deterministic samples and synthetic inputs labeled on screen or in narration.

## Claims review

- [ ] No win-rate, recovered-revenue, automatic-refund, lawsuit-prevention or exclusivity claims.
- [ ] No time-savings figure unless measured, including review and correction time.
- [ ] Architecture text matches the deployed system (see [pitch.md](pitch.md)).
- [ ] Production ATMSPHR evidence and Stripe submission described as not connected.

## Handoff

- [ ] Smoke runs scheduled with Aiden outside any recording (`test:dev:smoke` approves ATM-1042 and adds an attachment to ATM-1044).
- [ ] Package handed to Aiden.
- [ ] Branch committed and pushed; commit SHA, checks run, artifact locations and limitations reported.
