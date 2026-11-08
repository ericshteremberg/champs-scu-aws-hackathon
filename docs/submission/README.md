# Causality submission preparation

Status: prepared for team review, not submitted. Checked November 8, 2026, approximately 3:50 AM PST. The user has explicitly asked not to submit yet. Follow-up: with explicit permission, both AWS prizes were selected and saved on Devpost. The entry remains a draft. Eric will remove Zach from the judging portal. No final submission, repository visibility change or customer-report update was performed.

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
| Judging-portal team | Five members, including Zach | Eric is handling removal of Zach. Do not add Zach to Devpost. |
| AWS track | AWS Track - First Place and AWS Track - Second Place selected and saved | Complete. Entry remains a draft. |
| GitHub access | Repository is private; portal says public repositories only | Eric must resolve visibility or publish an approved clean final-code repository. No visibility change performed. |
| Final code location | Final deployed feature integrated with main | Main includes the accepted Opus/PDF workflow plus compatible main updates. The live deployment remains frozen at the accepted version. |
| Judging portal GitHub field | Existing repository URL already saved | Recheck access and final-code discoverability before deadline. |
| Judging portal Devpost field | Blank | Prepared URL below; save only when submission is authorized. |
| Devpost story | Old Nova description and fictional-case-only pilot status | Replace with [prepared current story](devpost-story.md). |
| Devpost built-with tags | Includes amazon-nova, lacks current connector details | Prepared replacement tags below. |
| Demo link | Only generic GitHub URL present | Add the live app link with an accurate team-guided/private-login explanation. Never put the shared login password in a public field. |
| Thumbnail/gallery | Placeholder thumbnail; no gallery images observed | Use Causality logo and current screenshots. Alex. |
| Video | Empty | Record the current application and final PDF. The historical Casework video is not this app. Eric/Ayan. |
| Slides | No submission slide link observed | Add the team's final deck if available. Recommended, not listed as mandatory. |

The official [Devpost requirements](https://a10-x-aws-hack-26.devpost.com/) require a repository link and all teammates on the project. A short video, slides, screenshots, and logo thumbnail are recommended. The forms require project name, elevator pitch, story, and built-with tags. Media accepts JPG/PNG/GIF, 5 MB each, recommended 3:2 ratio, up to 15 gallery images. A precise video or presentation time limit was not found in the reviewed requirements. The current Google Docs script is about 3:30; treat that as the team's plan, not an organizer rule.

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
- Frozen code and deployment notes: https://github.com/ericshteremberg/champs-scu-aws-hackathon/tree/0df300af9207d503c872d3c5c8b8a95dbad0b14d
- Deployment: AWS source `116fd74`, Cloudflare Worker `327e3bc7-db20-4615-8a70-4dc66887caed`.
- Suggested tags: amazon-bedrock, anthropic, claude, aws-lambda, amazon-dynamodb, amazon-s3, aws-secrets-manager, aws-cloudformation, typescript, react, next.js, tailwind-css, node.js, cloudflare-workers, supabase, stripe, resend, gmail, imap, vite, vitest.
- Proposed elevator pitch: **Causality turns payment records, customer messages, and policies into evidence-backed chargeback responses with original exhibits, ready for merchant review.**

## Presentation preparation

Use [the judge walkthrough](judge-guide.md). Keep the existing script's roles: Eric introduces the business problem, Alex explains the product, Ayan demonstrates it, and Aiden explains AWS and the controlled investigation loop. The shared script remains unmodified.

Show the final saved report and PDF during the timed demo. If demonstrating a fresh run, start it before presenting the architecture; do not overwrite the team's chosen final draft just to rehearse. The measured 120.37 seconds covers one investigation, not customer onboarding, all connector collection, human review, or PDF production. It is not an average or a time-savings study.

The [event site](https://aws.scuacm.com/) lists judging at 9:15 AM; the signed-in team portal says 9:30 AM and has not published the team's station/time. Be ready at 9:15 AM and follow the posted portal assignment when available. The site lists an 8:30 AM submission Q&A in Bergin 116. Its day-two date heading contains a typo; use the explicit November 8 deadline on Devpost and the organizer announcement.

## Before public release or recording

Keep private originals and the final customer PDF out of the repository. Use reviewed, redacted copies for public video/gallery examples and preserve the private original. Never describe a generated record rendering as an original provider screenshot. Do not publish the development login, OAuth secrets, workshop links/codes, customer exports, or private invite links. The repo currently remains private, and this preparation is not a review approving its full history for publication.

The demo's Send to Stripe control is inert. Do not present it as a working submission. Actual dispute submission, refunds, and outbound customer messaging remain disabled.
