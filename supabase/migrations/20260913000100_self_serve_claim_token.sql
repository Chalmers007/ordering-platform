-- Self-serve claim token issuance.
--
-- issue_claim_token() intentionally gates on is_super_admin(): claim tokens
-- were designed to be handed out only after someone at Vardr has spoken to
-- the business, because a claim token is a bearer credential that hands the
-- whole storefront to whoever redeems it (see the comment on
-- claimCtaHref() in src/lib/storefront/preview.ts, and the
-- "keeps internal identifiers out of rendered banner text and links" /
-- "the CTA points at the sales route" tests this migration's app-code
-- companion changes updated).
--
-- Scott made a deliberate call to trade that vetting step for scale: a
-- prospect who reaches their own restaurant's public preview link can now
-- claim it immediately, with nobody at Vardr in the loop first. This
-- function is the narrow, public-facing door for that trade. It repeats
-- every safety check issue_claim_token() has EXCEPT the operator check, so
-- a legitimate self-serve claim — issued from the Next.js API route using
-- the service role, after that route has validated the request shape — can
-- succeed, while the function itself stays revoked from anon/authenticated
-- so nothing can call it directly over PostgREST and skip the route.
--
-- tenant_id is not treated as a secret here: it already appears in the demo
-- preview's own query string, so the real guardrails are the tenant's own
-- claimed/status state, not obscurity of the id. Reissuing on every call
-- would let a second visitor invalidate a token already shown to the first,
-- so an unexpired token already on the row is returned as-is rather than
-- rotated.
create or replace function public.request_claim_token(
  p_tenant_id uuid,
  p_ttl_days  integer default 14
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
  v_token  uuid;
begin
  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'No such tenant' using errcode = 'no_data_found';
  end if;

  -- A claimed storefront has an owner. Handing out a fresh ownership token
  -- for it would let a stranger take a business off the person running it.
  if v_tenant.claimed_at is not null then
    raise exception 'This tenant has already been claimed'
      using errcode = 'check_violation';
  end if;
  if v_tenant.status not in ('pending', 'pending_claim') then
    raise exception 'Cannot issue a claim token for a % tenant', v_tenant.status
      using errcode = 'check_violation';
  end if;

  if v_tenant.claim_token is not null and v_tenant.claim_token_expires_at > now() then
    return v_tenant.claim_token;
  end if;

  v_token := gen_random_uuid();

  update public.tenants
     set claim_token = v_token,
         claim_token_expires_at = now() + make_interval(days => greatest(1, coalesce(p_ttl_days, 14))),
         status = 'pending_claim',
         updated_at = now()
   where id = p_tenant_id;

  return v_token;
end;
$$;

revoke all on function public.request_claim_token(uuid, integer) from public, anon, authenticated;
