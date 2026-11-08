# Demo script

Rehearse a three-minute version and adapt to the organizer's actual presentation limit. The AWS track story is a completed business workflow powered by AWS. Explain the controlled evidence API briefly as the integration design.

## Before going on stage

- Verify the case list loads and a complete investigation succeeds on the presentation machine.
- If showing Bedrock, verify the current temporary credentials, `us-east-1`, and model access. Temporary credentials can expire.
- Keep the source badge visible. Bundled cases are synthetic even when an actual Bedrock model investigates them.
- Confirm review and both export formats work. Record a backup video of this exact build.
- Open the architecture diagram and business assumptions in backup slides. Do not expose configuration files, credentials, or real customer records.

## Three-minute walkthrough

| Time | Speaker and action |
|---|---|
| 0:00-0:25 | Eric explains the real work: a ticket customer disputes a charge, and the organizer has to find payment, ticket, delivery, and support records in separate systems. |
| 0:25-0:45 | Open Casework and select sample case ATM-1042. State: "These are fictional records shaped around our workflow." If Bedrock is enabled, state that the investigation uses a real AWS model. |
| 0:45-1:30 | Start the investigation. Show evidence arriving from the scoped API, then open the customer's receipt acknowledgement and the SMS delivery record. Explain that an accepted email alone would not establish delivery. |
| 1:30-2:00 | Open findings and the response draft. Click a citation to inspect its source. Show the missing attendance and historic-policy information. Edit one sentence, mark reviewed, and export. |
| 2:00-2:25 | Briefly open the insufficient-evidence case or its completed report. Explain why the product can conclude that more information is needed. |
| 2:25-2:45 | Show the architecture: merchant-controlled evidence endpoint, Casework application, Amazon Bedrock, and optional private S3 export archive. |
| 2:45-3:00 | State the customer hypothesis, the manual-time measurement plan or actual measured result, and the next step: an ATMSPHR pilot followed by a Rentul adapter. |

If a model call is slow, use the recorded backup and state what it shows. Never simulate a live completed model call without labeling the replay.

## Case outcomes

| Case | Evidence lesson |
|---|---|
| ATM-1042 | Payment and issuance are recorded; SMS is marked delivered; a matched fictional customer message acknowledges finding both tickets. That supports a response, while attendance and purchase-time terms remain unknown. |
| ATM-1043 | A ticket exists, but email delivery and resend failed, SMS was undelivered, and the customer asked for help before the event. The report should surface evidence supporting the complaint. |
| ATM-1044 | Payment and issuance exist, but delivery, recovery, and matched support history are unavailable. The report should request more evidence and avoid claiming receipt. |

These scenarios validate different behavior. They are not three observed outcomes or a measured win-rate improvement.

## Pitch wording

"Casework prepares a dispute case from the records a business already has. The business exposes a narrow API for the selected case, so the investigator can gather relevant evidence without database access. The organizer gets a sourced timeline, gaps to resolve, and a response to review. Amazon Bedrock powers the investigation. We are validating the time saved with ATMSPHR before expanding to rental workflows."

Use the Bedrock sentence only when that integration is configured and demonstrated. If running demo mode, say "The application includes a Bedrock integration; this offline demonstration uses the labeled sample investigator."

## Questions to be ready for

**What makes this different?** Our initial implementation fits a custom ticketing workflow and lets the merchant control case-level access. Automated dispute products already exist. We have not established that these capabilities are unique.

**Does it issue refunds or submit disputes?** This build produces a reviewed export. Those financial actions would need separate permissions and workflow validation.

**How do you know the answer is correct?** Findings cite returned records, the app validates citation identifiers, and a human reviews the interpretation. Existing citations alone do not prove a claim is accurate.

**Where does AWS matter?** Bedrock supplies model inference and tool-use decisions. S3 archival is optional and should be claimed only if configured and tested.

**How will you sell it?** Start with a paid pilot around measured preparation time, connector effort, and review quality. Pricing and demand remain hypotheses.

**What comes next?** A verified real-case ATMSPHR pilot, then another merchant adapter such as Rentul. Hosted organization accounts and operational controls precede a broader rollout.
