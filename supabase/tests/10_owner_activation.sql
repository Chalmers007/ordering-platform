-- Owner publication is separate from claiming and requires reviewed branding.
\set ON_ERROR_STOP on
set client_min_messages = notice;

\set TENANT '0a10ac70-0000-4000-8000-000000000001'
\set OWNER  '0a10ac70-0009-4000-8000-000000000001'

create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
end $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, email_change, email_change_token_new, recovery_token)
values (:'OWNER','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','activation-owner@example.test','x',
        now(),now(),now(),'{}','{}','','','','');

insert into public.tenants (id, slug, name, status, claimed_at)
values (:'TENANT','activation-sequence-test','Activation Sequence Test','pending',now());
update public.user_profiles set role='tenant_owner', tenant_id=:'TENANT' where id=:'OWNER';

select pg_temp.as_user(:'OWNER');
set role authenticated;

do $$ begin
  begin
    perform public.activate_storefront('0a10ac70-0000-4000-8000-000000000001');
    raise exception 'FAIL: storefront activated before menu confirmation';
  exception when check_violation then null;
  end;
end $$;

reset role;
update public.tenants set menu_verified_at=now() where id=:'TENANT';
update public.tenant_settings set logo_url='https://assets.example.test/logo.png' where tenant_id=:'TENANT';
set role authenticated;

do $$ begin
  begin
    perform public.activate_storefront('0a10ac70-0000-4000-8000-000000000001');
    raise exception 'FAIL: storefront activated without a banner';
  exception when check_violation then null;
  end;
end $$;

reset role;
update public.tenant_settings set cover_image_url='https://assets.example.test/banner.jpg' where tenant_id=:'TENANT';
set role authenticated;
select (public.activate_storefront(:'TENANT')).status = 'active' as owner_activated_after_review;
reset role;

do $$ begin
  if (select status <> 'active' from public.tenants where id='0a10ac70-0000-4000-8000-000000000001') then
    raise exception 'FAIL: reviewed storefront did not activate';
  end if;
end $$;

delete from public.webhook_events where tenant_id=:'TENANT';
delete from public.tenants where id=:'TENANT';
delete from auth.users where id=:'OWNER';
select set_config('request.jwt.claims', null, false);

select '10_owner_activation: all assertions passed' as result;
