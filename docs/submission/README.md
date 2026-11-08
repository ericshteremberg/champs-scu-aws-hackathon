# Causality submission preparation

Status: Devpost remains DRAFT, 4/5 steps, not submitted. On November 8, 2026, saved the current Opus story, elevator pitch, built-with tags and live application link. Both AWS prizes remain selected. GitHub is now public, changed by the user. The team has added a YouTube demo link and seven gallery screenshots. A follow-up review removed Markdown heading markers and verified the rendered story, four team members, both AWS prize selections, repository link and direct live workspace link. Eric reports that he cannot remove Zach from the judging portal; organizer assistance is needed. No final submission or customer-report update was performed.

## Deadline and required actions

Both steps are due **November 8 at 9:00 AM PST**:

1. Finalize the Devpost entry, including its terms confirmation and Submit project action.
2. Add the project Devpost URL and public GitHub repository to the separate judging portal.

The 2:55 AM announcement from Chris Shobe in [Discord announcements](https://discord.com/channels/1555281943350878298/1559024408251600986) explicitly requires both. A saved draft alone is not a submission. Devpost confirms the same deadline in its [rules](https://a10-x-aws-hack-26.devpost.com/rules). Do not perform either final submission until the team authorizes it.

## Live checklist

| Item | Observed status | Next action / suggested owner |
| --- | --- | --- |
| Final application and report | User accepted the latest Opus result. Latest completed Opus run took 120.37 seconds from queued start to completion. | Freeze application/report for this presentation. Aiden. |
| Devpost submission | DRAFT, 4/5 steps | Finish remaining fields, review, then submit only when authorized. Aiden/Ayan. |
| Devpost team | Four members: Ayan, Alex, Aiden, Eric | Correct for the final team confirmed by Aiden. |
| Judging-portal team | Five members, including Zach | Eric cannot remove Zach; ask an organizer to correct the roster. Do not add Zach to Devpost. |
| AWS track | AWS Track - First Place and AWS Track - Second Place selected and saved | Complete. Entry remains a draft. |
| GitHub access | Repository is PUBLIC, verified through GitHub | Complete. User changed visibility. |
| Final code location | Final deployed feature integrated with main | Main includes the accepted Opus/PDF workflow plus compatible main updates. Public workspace access and investigation status/timeout improvements follow the accepted report version. The saved report is preserved. |
| Judging portal GitHub field | Existing repository URL already saved | Recheck access and final-code discoverability before deadline. |
| Judging portal Devpost field | Blank | Prepared URL below; save only when submission is authorized. |
| Devpost story | Current Opus workflow saved | [Current copy](devpost-story.md). Final submission still pending. |
| Devpost built-with tags | Current AWS/Claude and connector tags saved; amazon-nova removed | Complete. |
| Demo link | Live app URL saved alongside GitHub | Public shared workspace, no username/password. |
| Thumbnail/gallery | Seven gallery screenshots are present | Gallery preserved during formatting review. |
| Video | https://youtu.be/rm6GlSNpbKk is saved; embedded preview loads | Team video preserved. Full playback/content was not reviewed in this formatting pass. |
| Slides | No submission slide link observed | Add the team's final deck if available. Recommended, not listed as mandatory. |

The official [Devpost requirements](https://a10-x-aws-hack-26.devpost.com/) require a repository link and all teammates on the project. A short video, slides, screenshots, and logo thumbnail are recommended. The forms require project name, elevator pitch, story, and built-with tags. Media accepts JPG/PNG/GIF, 5 MB each, recommended 3:2 ratio, up to 15 gallery images. A precise video or presentation time limit was not found in the reviewed requirements. Aim for a 2 to 3 minute video, ideally about 2.5 minutes. The current Google Docs script is about 3:30; treat that as the team's plan, not an organizer rule.

## Prepared links and values

- Project name: **Causality**
- Team in judging portal: **champs**
- Track: **AWS**
- Devpost project URL: https://devpost.com/software/champs-qyo025
- Devpost editing: https://devpost.com/submit-to/31660-aws-x-a10-hack-2026/manage/submissions/1286925-causality/project-overview
- Judging portal: https://judging.scuacm.com/team
- Live application: https://causality-hackathon-dev.slidah60.workers.dev
- Repository: https://github.com/ericshteremberg/champs-scu-aws-hackathon
- Final integrated branch: https://github.com/ericshteremberg/champs-scu-aws-hackathon/tree/main
- Current deployment notes: [handoff](../HANDOFF.md). AWS source `5088ad6`; public-access frontend follows on `codex/public-hackathon-workspace`.
- Suggested tags: amazon-bedrock, anthropic, claude, aws-lambda, amazon-dynamodb, amazon-s3, aws-secrets-manager, aws-cloudformation, typescript, react, next.js, tailwind-css, node.js, cloudflare-workers, supabase, stripe, resend, gmail, imap, vite, vitest.
- Proposed elevator pitch: **Causality turns payment records, customer messages, and policies into evidence-backed chargeback responses with original exhibits, ready for merchant review.**

## Presentation preparation

Use [the judge walkthrough](judge-guide.md). Keep the existing script's roles: Eric introduces the business problem, Alex explains the product, Ayan demonstrates it, and Aiden explains AWS and the controlled investigation loop. The shared script remains unmodified.

Show the final saved report and PDF during the timed demo. If demonstrating a fresh run, start it before presenting the architecture; do not overwrite the team's chosen final draft just to rehearse. The measured 120.37 seconds covers one investigation, not customer onboarding, all connector collection, human review, or PDF production. It is not an average or a time-savings study.

The [event site](https://aws.scuacm.com/) lists judging at 9:15 AM; the signed-in team portal says 9:30 AM and has not published the team's station/time. Be ready at 9:15 AM and follow the posted portal assignment when available. The site lists an 8:30 AM submission Q&A in Bergin 116. Its day-two date heading contains a typo; use the explicit November 8 deadline on Devpost and the organizer announcement.

## Before public release or recording

Keep private originals and the final customer PDF out of the repository. Use reviewed, redacted copies for public video/gallery examples and preserve the private original. Never describe a generated record rendering as an original provider screenshot. Do not publish the development login, OAuth secrets, workshop links/codes, customer exports, or private invite links. The repository is public. This preparation is not a full-history publication audit.

The demo's Send to Stripe control is inert. Do not present it as a working submission. Actual dispute submission, refunds, and outbound customer messaging remain disabled.
