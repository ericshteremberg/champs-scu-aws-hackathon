# Business case and validation plan

Causality helps an operator prepare a payment-dispute response using payment records, operational evidence, delivery events, and customer conversations. The first buyer hypothesis is a ticketing platform or event business with recurring disputes and a costly manual evidence search.

ATMSPHR is the team's available design partner. Access to its workflow is not proof of willingness to pay. Confirm the current task, who bears the disputed amount, where time is spent, and how much connector setup the operator will accept.

## Value to measure

Measure time from receiving a case to producing an evidence packet ready for review. Count review and correction time in the assisted workflow. Also record relevant sources found, missing evidence correctly identified, unsupported claims, and manual systems visited.

The product should reduce operator effort while preserving review quality. A faster response that misstates delivery or omits counterevidence is not a successful result.

The integration hypothesis is that custom applications will accept a merchant-owned API exposing approved case records more readily than broad database access. Validate that claim through customer interviews and the actual time to implement, maintain, and audit an adapter.

## Time-value model

```text
Monthly hours released = disputes per month * minutes saved per dispute / 60
Illustrative time value = monthly hours released * operator hourly cost
Value after software fee = illustrative time value - monthly software fee
```

As a hypothetical example, 20 cases per month and 15 minutes saved per case release 5 hours. At an assumed $30 per hour, that is $150 of time value. An assumed $49 subscription leaves $101 before setup and other operating costs.

These are assumptions, not observed savings, a price recommendation, or proof of demand. Time released is capacity, not necessarily cash savings. The example excludes changes in dispute outcomes, provider fees, and recovered principal. Model those separately only after identifying who bears the loss and collecting supporting data.

## Pilot measurements

For each pilot case, retain baseline preparation time, assisted preparation time, review time, corrections, source gaps, final approved output, and whether the inputs were real or synthetic. Include cases supporting receipt, cases supporting the complaint, and cases with insufficient evidence.

Report the sample size and method. The hackathon does not establish a causal increase in win rates. A later outcome study needs an appropriate comparison group and enough time for issuer decisions.

## Costs and pricing

The deployed application uses AWS Lambda for the API and investigation jobs, DynamoDB for persistent records and conditional transactions, S3 for private files and approved archives, and Bedrock Nova for inference. Cloudflare Workers hosts the frontend and authenticated bridge. Costs depend on model and token usage, tool rounds, Lambda duration, DynamoDB reads and transactions, S3 storage and requests, file retention, hosting, connector maintenance, and support.

The implementation bounds each case to 90 evidence records, each database item to 300 KB, transactions to 3 MB, and uploads to 10 MB. Measure how often real cases exceed those limits before estimating support costs or promising broader coverage.

Measure AWS usage per completed and failed investigation. Include review/rework and integration support in the cost estimate. Temporary workshop credits are a development allowance, not sustainable unit economics.

Test a subscription with a case allowance, then ask operators whether predictable monthly, per-case, or outcome-based pricing matches how they buy. Do not choose an outcome-based fee before establishing attribution, liability, and actual customer preference.

## Competition and expansion

Automated dispute evidence collection is competitive. Do not claim that combining payment and operational data is new. The initial product hypothesis is a usable ticketing workflow, a practical case-scoped integration, and a transparent review process for a custom business.

Rentul could later provide booking, handoff, return, and linked-message evidence. Reusing the API shape does not prove the same reasoning, policies, or economics apply. Validate the rental workflow independently.

## Submission claims

Describe implemented behavior and measured results. Distinguish synthetic inputs, deterministic sample investigations, verified Bedrock calls, and configured-but-untested connections. Present pricing, savings, demand, and expansion as hypotheses until validated. Causality prepares evidence and a reviewed response; it does not decide disputes, resolve lawsuits, or guarantee recovery.
