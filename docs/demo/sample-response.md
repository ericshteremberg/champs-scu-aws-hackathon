# Casework evidence packet

Case: case_atm_1042
Merchant: ATMSPHR
Amount: $92.00
Source: synthetic
Investigation: demo
Reviewed: 2026-11-08T00:36:07.473Z

## Reviewed response

Re: Ticket not received
Order reference: ATM-1042

The following records were reviewed for this transaction:

A fictional USD 92.00 payment maps to order ATM-1042. [case_atm_1042:payment]

I paid for two tickets but never received them. [case_atm_1042:dispute]

Order ATM-1042 contains two general-admission tickets to After Hours: Fall Session. [case_atm_1042:order]

A ticket was created and linked to order ATM-1042. Issuance alone does not establish delivery. [case_atm_1042:ticket-1]

A second ticket was created for the same order. [case_atm_1042:ticket-2]

The email provider accepted the confirmation for processing. Inbox delivery and reading are not recorded. [case_atm_1042:email]

The SMS provider returned delivered for the order-linked message. Reading is not established. [case_atm_1042:sms]

An order-linked recovery flow completed. This records account access, not physical event attendance. [case_atm_1042:recovery]

Fictional customer message: "My payment went through, but I cannot see the tickets for order ATM-1042." [case_atm_1042:support-1]

Fictional organizer message: "Please open the ticket recovery link for order ATM-1042 and sign in with the purchase address." [case_atm_1042:support-2]

Fictional customer message: "Found both tickets in my account for ATM-1042. Thank you." [case_atm_1042:support-3]

Evidence limitations:
- Email acceptance does not prove inbox delivery. An SMS delivery status does not prove the message was read.
- This is a fictional conversation for the demo. Acknowledged access does not establish attendance or determine a bank decision.
- No case-linked scan records are available in this fixture. Scanning coverage is unknown; this does not establish nonattendance.
- An immutable purchase-time policy and acceptance record are not available. Current terms cannot establish what this customer saw.
- A provider delivery status does not establish that the message was read by the cardholder.

The customer acknowledgement above is relevant to the claim of nonreceipt. It should be reviewed in the context of the complete conversation. [case_atm_1042:support-3]

## Findings

- **Payment captured**: A fictional USD 92.00 payment maps to order ATM-1042. (case_atm_1042:payment)
- **Dispute requires a response**: I paid for two tickets but never received them. (case_atm_1042:dispute)
- **Order confirmed for two tickets**: Order ATM-1042 contains two general-admission tickets to After Hours: Fall Session. (case_atm_1042:order)
- **First ticket issued**: A ticket was created and linked to order ATM-1042. Issuance alone does not establish delivery. (case_atm_1042:ticket-1)
- **Second ticket issued**: A second ticket was created for the same order. (case_atm_1042:ticket-2)
- **Confirmation email accepted**: The email provider accepted the confirmation for processing. Inbox delivery and reading are not recorded. (case_atm_1042:email)
- **Ticket-link SMS marked delivered**: The SMS provider returned delivered for the order-linked message. Reading is not established. (case_atm_1042:sms)
- **Ticket recovery completed**: An order-linked recovery flow completed. This records account access, not physical event attendance. (case_atm_1042:recovery)
- **Customer asked for help finding tickets**: Fictional customer message: "My payment went through, but I cannot see the tickets for order ATM-1042." (case_atm_1042:support-1)
- **Organizer explained ticket recovery**: Fictional organizer message: "Please open the ticket recovery link for order ATM-1042 and sign in with the purchase address." (case_atm_1042:support-2)
- **Customer acknowledged finding both tickets**: Fictional customer message: "Found both tickets in my account for ATM-1042. Thank you." (case_atm_1042:support-3)

## Missing information and limitations

- Email acceptance does not prove inbox delivery. An SMS delivery status does not prove the message was read.
- This is a fictional conversation for the demo. Acknowledged access does not establish attendance or determine a bank decision.
- No case-linked scan records are available in this fixture. Scanning coverage is unknown; this does not establish nonattendance.
- An immutable purchase-time policy and acceptance record are not available. Current terms cannot establish what this customer saw.
- A provider delivery status does not establish that the message was read by the cardholder.
- Attendance evidence is unavailable.
- Policy evidence is unavailable.

## Source records

### case_atm_1042:payment

Payment captured

A fictional USD 92.00 payment maps to order ATM-1042.

Source: Stripe test fixture / pi_demo_atm_1042
Occurred: 2026-11-02T18:03:00Z
Retrieved: 2026-11-08T00:35:47.509Z

```json
{
  "chargeCaptured": true,
  "refundAmount": 0,
  "disputeStatus": "needs_response",
  "orderRef": "ATM-1042",
  "paymentRef": "pi_demo_atm_1042",
  "amount": 9200,
  "currency": "USD",
  "stripeAccount": "acct_demo_atmsphr",
  "liveMode": false
}
```

### case_atm_1042:dispute

Dispute requires a response

I paid for two tickets but never received them.

Source: Stripe test fixture / dp_demo_atm-1042
Occurred: 2026-11-06T20:15:00Z
Retrieved: 2026-11-08T00:35:47.509Z

```json
{
  "disputeStatus": "needs_response",
  "reason": "product_not_received",
  "evidenceDueAt": "2026-11-14T07:59:00Z",
  "amount": 9200,
  "currency": "USD"
}
```

### case_atm_1042:order

Order confirmed for two tickets

Order ATM-1042 contains two general-admission tickets to After Hours: Fall Session.

Source: ATMSPHR order fixture / order_demo_1042
Occurred: 2026-11-02T18:03:00Z
Retrieved: 2026-11-08T00:35:47.860Z

```json
{
  "orderRef": "ATM-1042",
  "paymentRef": "pi_demo_atm_1042",
  "quantity": 2,
  "subtotal": 8000,
  "fees": 1200,
  "total": 9200,
  "currency": "USD",
  "status": "paid",
  "eventStartsAt": "2026-11-07T05:00:00Z",
  "eventTimezone": "America/Los_Angeles"
}
```

### case_atm_1042:ticket-1

First ticket issued

A ticket was created and linked to order ATM-1042. Issuance alone does not establish delivery.

Source: ATMSPHR ticket fixture / ticket_demo_1042_a
Occurred: 2026-11-02T18:03:04Z
Retrieved: 2026-11-08T00:35:48.212Z

```json
{
  "orderRef": "ATM-1042",
  "ticketStatus": "issued",
  "transferredFrom": null,
  "transferredTo": null,
  "scanRecorded": false
}
```

### case_atm_1042:ticket-2

Second ticket issued

A second ticket was created for the same order.

Source: ATMSPHR ticket fixture / ticket_demo_1042_b
Occurred: 2026-11-02T18:03:04Z
Retrieved: 2026-11-08T00:35:48.212Z

```json
{
  "orderRef": "ATM-1042",
  "ticketStatus": "issued",
  "transferredFrom": null,
  "transferredTo": null,
  "scanRecorded": false
}
```

### case_atm_1042:email

Confirmation email accepted

The email provider accepted the confirmation for processing. Inbox delivery and reading are not recorded.

Source: Resend delivery fixture / email_demo_1042
Occurred: 2026-11-02T18:03:12Z
Retrieved: 2026-11-08T00:35:48.564Z

```json
{
  "channel": "email",
  "providerStatus": "accepted",
  "delivered": null,
  "read": null,
  "errorCode": null,
  "orderRef": "ATM-1042"
}
```

### case_atm_1042:sms

Ticket-link SMS marked delivered

The SMS provider returned delivered for the order-linked message. Reading is not established.

Source: Twilio delivery fixture / sms_demo_1042
Occurred: 2026-11-02T18:04:02Z
Retrieved: 2026-11-08T00:35:48.564Z

```json
{
  "channel": "sms",
  "providerStatus": "delivered",
  "delivered": true,
  "read": null,
  "errorCode": null,
  "orderRef": "ATM-1042"
}
```

### case_atm_1042:recovery

Ticket recovery completed

An order-linked recovery flow completed. This records account access, not physical event attendance.

Source: ATMSPHR recovery fixture / recovery_demo_1042
Occurred: 2026-11-02T18:10:41Z
Retrieved: 2026-11-08T00:35:48.917Z

```json
{
  "orderRef": "ATM-1042",
  "recoveryCompleted": true,
  "recoveredTicketCount": 2
}
```

### case_atm_1042:support-1

Customer asked for help finding tickets

Fictional customer message: "My payment went through, but I cannot see the tickets for order ATM-1042."

Source: Matched support export fixture / thread_demo_1042:message_1
Occurred: 2026-11-02T18:08:10Z
Retrieved: 2026-11-08T00:35:49.269Z

```json
{
  "orderRef": "ATM-1042",
  "messageRole": "customer",
  "customerAcknowledgedReceipt": false,
  "threadMatch": "explicit_order_reference"
}
```

### case_atm_1042:support-2

Organizer explained ticket recovery

Fictional organizer message: "Please open the ticket recovery link for order ATM-1042 and sign in with the purchase address."

Source: Matched support export fixture / thread_demo_1042:message_2
Occurred: 2026-11-02T18:09:20Z
Retrieved: 2026-11-08T00:35:49.269Z

```json
{
  "orderRef": "ATM-1042",
  "messageRole": "organizer",
  "customerAcknowledgedReceipt": false,
  "threadMatch": "explicit_order_reference"
}
```

### case_atm_1042:support-3

Customer acknowledged finding both tickets

Fictional customer message: "Found both tickets in my account for ATM-1042. Thank you."

Source: Matched support export fixture / thread_demo_1042:message_3
Occurred: 2026-11-02T18:12:18Z
Retrieved: 2026-11-08T00:35:49.269Z

```json
{
  "orderRef": "ATM-1042",
  "messageRole": "customer",
  "customerAcknowledgedReceipt": true,
  "threadMatch": "explicit_order_reference"
}
```


## Review note

No additional note.
