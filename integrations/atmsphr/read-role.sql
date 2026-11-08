-- PROPOSAL ONLY. Run by the merchant database administrator after reviewing RLS.
-- No login, password, RLS bypass, row-policy change, or write privilege is created.
CREATE ROLE atmsphr_evidence_reader NOLOGIN;
GRANT USAGE ON SCHEMA public TO atmsphr_evidence_reader;
GRANT SELECT (id, event_id, order_number, payment_ref, payment_provider, status,
 total_cents, refunded_cents, channel, terms_version, age_ack, created_at, paid_at)
 ON public.orders TO atmsphr_evidence_reader;
GRANT SELECT (id, organizer_id, title, starts_at, ends_at) ON public.events TO atmsphr_evidence_reader;
GRANT SELECT (id, name) ON public.organizers TO atmsphr_evidence_reader;
GRANT SELECT (id, platform) ON public.atmsphr_stripe_objects TO atmsphr_evidence_reader;
GRANT SELECT (order_id) ON public.atmsphr_legacy_fee_orders,
 public.atmsphr_member_redemptions, public.atmsphr_membership_ticket_bundles TO atmsphr_evidence_reader;
GRANT SELECT (id, order_id, qty, unit_price_cents, unit_fee_cents, tier_id)
 ON public.order_items TO atmsphr_evidence_reader;
GRANT SELECT (id, order_id, event_id, status, tier_id, face_value_cents, created_at,
 scanned_at, transferred_from, transferred_to) ON public.tickets TO atmsphr_evidence_reader;
GRANT SELECT (id, ticket_id, event_id, result, created_at) ON public.scans TO atmsphr_evidence_reader;
GRANT SELECT (order_id, state, attempts, first_attempt_at, created_at)
 ON public.order_email_queue TO atmsphr_evidence_reader;
GRANT SELECT (id, order_id, amount_cents, fee_withheld_cents, created_at)
 ON public.refunds TO atmsphr_evidence_reader;
