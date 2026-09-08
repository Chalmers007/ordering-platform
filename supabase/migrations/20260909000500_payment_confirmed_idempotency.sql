-- The enum value is added in the preceding migration. Keep this index in a
-- separate migration because PostgreSQL does not allow a newly-added enum
-- value to be used before the ALTER TYPE transaction commits.
create unique index if not exists webhook_events_payment_confirmed_purchase_uq
  on public.webhook_events (tenant_id, event_type, ((payload->>'purchase_id')))
  where event_type = 'payment_confirmed' and payload ? 'purchase_id';
