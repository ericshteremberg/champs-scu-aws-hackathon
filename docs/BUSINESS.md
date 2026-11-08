# Business case and validation plan

Casework helps an operator prepare a payment-dispute response using records held across their payment provider, application, delivery services, and customer conversations. The initial buyer hypothesis is a small ticketing platform or event business with enough recurring disputes to make manual evidence gathering expensive.

ATMSPHR is the first design partner available to this team. Access to a workflow is not proof of willingness to pay. A real case and an interview with the operator should establish how the task currently works, who bears the disputed amount, and which part of the process costs time.

## Value to test

Measure time from receiving a case to producing an evidence packet ready for review. Include correction and review time in the assisted workflow. Also track relevant records found, missing information correctly identified, unsupported claims, and the number of manual systems visited.

Success means a useful reviewed packet with less operator effort. A faster inaccurate response is not a success. Do not equate ticket issuance with delivery or fill gaps to make the merchant's case look stronger.

The first commercial hypothesis is that a merchant-controlled API makes integration acceptable for custom applications that do not want to provide broad database access. The merchant retains control over scope and field selection. That hypothesis needs customer interviews and a realistic measurement of adapter installation effort.

## Simple time-value model

Use the merchant's own measurements when available:

```text
Monthly hours released = disputes per month * minutes saved per dispute / 60
Illustrative time value = monthly hours released * operator hourly cost
Value after software fee = illustrative time value - monthly software fee
```

For a clearly hypothetical example, 20 disputes per month and 15 minutes saved per dispute release 5 hours. At an assumed $30 per hour, that is $150 of time value. An assumed $49 monthly subscription leaves $101 in modeled value before setup costs and any other operating costs.

Time released is capacity, not automatically cash savings. The example is not a price recommendation, observed result, or evidence of demand. It excludes changed dispute outcomes, provider fees, and recovered transaction amounts. Do not add those financial benefits without a separately supported model that identifies who actually bears the loss.

## Pilot measurements

For each case, capture the operator's baseline preparation time, assisted preparation time, corrections, missing-source notes, final reviewed output, and source mode. Keep synthetic evaluation results separate from real operational measurements.

Review at least three types of cases: evidence supports receipt, delivery failures support the complaint, and the available record is insufficient. Report the small sample size. A later outcome study would need a fair comparison group and enough time for issuer decisions; this hackathon does not establish an improvement in win rates.

## Costs and pricing assumptions

The prototype uses Bedrock for model calls, optional S3 storage for reviewed exports, and local application persistence. Actual operating cost depends on the model, token usage, number of tool rounds, export sizes, hosting, and support. Use measured AWS usage and current account pricing to estimate cost per case. Do not advertise the hackathon's temporary credits as sustainable unit economics.

Test a subscription with an included case allowance before choosing a pricing model. Ask whether the merchant prefers predictable monthly cost, per-case charges, or outcome-based fees, and what evidence of value they need. Include integration setup and maintenance in the economics of a custom connector.

## Expansion and competition

Automated dispute evidence collection is a competitive market. We should not claim to be the first product to combine payment data and operational evidence. The initial product hypothesis is a straightforward integration for a custom business, a focused ticket-delivery workflow, and an understandable human review experience.

Rentul is a possible second adapter, with bookings, handoff and return records, and linked messages. Validate that workflow independently. Reusing the evidence contract can reduce implementation work, but does not prove that the same reasoning, policies, or buyer economics apply.

## Claims permitted in the submission

Describe implemented behavior and measured results. Identify synthetic records, deterministic demo runs, configured AWS calls, and integrations that still require deployment. Present pricing, savings, market demand, and expansion as hypotheses until validated. The prototype prepares evidence and a reviewed response; it does not resolve lawsuits, decide a dispute, or guarantee funds will be recovered.
