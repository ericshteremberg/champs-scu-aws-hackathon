# Prepared Devpost story

Saved to the Devpost draft on November 8, 2026. Not submitted. Plain-text section labels are intentional; do not reintroduce Markdown heading markers in the pasted story.

Inspiration

One of our teammates operates an event-ticketing business and deals with payment disputes himself. Responding means finding the payment, matching it to an order, retrieving the ticket and email history, locating the right policy, and turning those records into a clear explanation before the deadline.

Those records live in different systems. We built Causality to assemble the case and produce a response the merchant can inspect, edit, and approve.

What it does

Causality connects payment disputes to the evidence behind the transaction. Merchants connect their services, select a case, and use Get evidence to collect relevant records from the configured sources. The workflow supports Stripe, Supabase, Resend, Gmail, and other mailboxes through IMAP.

The investigator retrieves case-scoped evidence, relates it to the cardholder's actual allegation, and drafts a cited rebuttal. The merchant can inspect the underlying records and export a professional PDF containing the response, source references, and available original documents or evidence captures.

Merchants can also add terms, refund policies, and cancellation policies by URL, file, or pasted text. Causality stores dated versions and distinguishes a policy's existence from proof that it applied to the purchase or was accepted by the customer.

What we demonstrated

We developed against ATMSPHR/Broese ticketing workflows and connected business records, then tested real dispute investigations. The final demonstration uses Claude Opus 5 through Amazon Bedrock. Our latest completed investigation took approximately two minutes from its queued start to completion, and we reviewed its resulting draft. That is one observed run, not a benchmark or a claim of recovered revenue.

The output goes beyond a narrative: it connects arguments to inspectable source records and includes available supporting exhibits. When a source no longer exposes an original email or document, Causality preserves that limitation instead of inventing a screenshot or claiming fresh provider verification.

How we built it

The interface uses React and TypeScript. Cloudflare Workers hosts the frontend and an authenticated bridge to the AWS backend.

AWS Lambda runs the API and background investigation jobs. Amazon Bedrock supplies Claude Opus 5 for evidence tool calls and response drafting. DynamoDB stores cases, revisions, investigation events, policy versions, and connection metadata. S3 stores private attachments and document artifacts. Secrets Manager holds developer integration credentials, and CloudFormation defines the AWS infrastructure.

Our application implements the agent's control loop. The model can request approved evidence sections for the assigned case and return a structured report. It cannot run arbitrary database queries, fetch arbitrary URLs, send messages, issue refunds, or submit a dispute. Citation validation and revision checks run outside the model.

Challenges we faced

The difficult part was making evidence useful without overstating it. A successful payment does not establish service delivery. An email marked sent does not establish that a customer read it. A policy snapshot is not proof of checkout acceptance. We had to preserve those distinctions while writing a persuasive response to the actual allegation.

We also had to connect records across providers, handle historical data that was no longer available, and prevent delayed investigations from overwriting a merchant's newer edits. Switching from Nova to Opus exposed a report-generation timeout, which we resolved by aligning the request, investigation, and worker limits.

Accomplishments

We built a deployed workflow that connects source collection, a controlled Bedrock investigation, human review, and a professional evidence PDF. The system can use the merchant's own records and retains source references rather than relying on unsupported generated claims.

What we learned

A useful AI product needs more than a strong model. It needs scoped access, reliable record matching, dated policies, inspectable evidence, and an interface where a person can correct the result. We used AI development tools during the build and can explain the code, architecture, and limitations.

What's next

Our first customers would be independent ticketing operators and event organizers with recurring dispute work. We would validate a subscription with usage-based case limits, measuring preparation time and review effort before making savings claims. Our cost model includes model input/output across every tool round, retries, AWS compute/storage, connector maintenance, and customer support.

Rentals are the next planned vertical, reusing the evidence and review workflow with booking, pickup, return, deposit, and cancellation records. Production work includes individual tenant access, onboarding hardening, quotas, retention controls, and broader evaluation.

This prototype prepares evidence for merchant review. Actual Stripe submissions, refunds, and outbound customer messaging are disabled. The Send to Stripe button is a presentation-only control.

Try it

Open https://causality-hackathon-dev.slidah60.workers.dev/workspace with no username or password. This is our live shared hackathon workspace, including connected business records. Actual Stripe submissions, refunds, and outbound customer messaging are disabled.
