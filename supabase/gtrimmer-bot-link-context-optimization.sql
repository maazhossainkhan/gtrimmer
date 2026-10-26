-- Reduce link-conversion latency by reading language preference and access status in one request.
-- Preserve existing lookup precedence: configured Admin override remains in the Edge Function,
-- legacy users precede Mini App users, and Mini App requests precede legacy requests.
create or replace function public.gtrimmer_bot_link_context(p_telegram_id text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  v_language text;
  v_status text;
  v_is_admin boolean;
  v_username text;
  v_request_status text;
begin
  select p.language into v_language
    from public.gtrimmer_bot_user_preferences p
   where p.telegram_id = p_telegram_id limit 1;
  v_language := case when v_language = 'bn' then 'bn' else 'en' end;

  select u.status, u.is_admin, u.username into v_status, v_is_admin, v_username
    from public.gtrimmer_access_users u
   where u.telegram_id = p_telegram_id limit 1;
  if found then
    return jsonb_build_object('language', v_language,
      'access_state', case when v_status = 'active' and coalesce(v_is_admin, false) then 'admin'
                           when v_status = 'active' then 'active' else 'revoked' end,
      'username', v_username);
  end if;

  select u.status, u.is_admin, u.username into v_status, v_is_admin, v_username
    from public.gtrimmer_mini_access_users u
   where u.telegram_id = p_telegram_id limit 1;
  if found then
    return jsonb_build_object('language', v_language,
      'access_state', case when v_status = 'active' and coalesce(v_is_admin, false) then 'admin'
                           when v_status = 'active' then 'active' else 'revoked' end,
      'username', v_username);
  end if;

  select r.status, r.username into v_request_status, v_username
    from public.gtrimmer_mini_access_requests r
   where r.telegram_id = p_telegram_id limit 1;
  if not found then
    select r.status, r.username into v_request_status, v_username
      from public.gtrimmer_access_requests r
     where r.telegram_id = p_telegram_id limit 1;
  end if;

  return jsonb_build_object('language', v_language,
    'access_state', case when v_request_status = 'pending' then 'pending'
                         when v_request_status = 'rejected' then 'rejected'
                         else 'needs_request' end,
    'username', v_username);
end;
$function$;

revoke all on function public.gtrimmer_bot_link_context(text) from public, anon, authenticated;
grant execute on function public.gtrimmer_bot_link_context(text) to service_role;

create index if not exists gtrimmer_access_users_telegram_id_idx
  on public.gtrimmer_access_users (telegram_id);
create index if not exists gtrimmer_access_requests_telegram_id_idx
  on public.gtrimmer_access_requests (telegram_id);
create index if not exists gtrimmer_access_requests_reviewed_by_idx
  on public.gtrimmer_access_requests (reviewed_by);
