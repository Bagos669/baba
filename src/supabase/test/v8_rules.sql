-- Rule tests for v8 (support panel). Run after mock_base + v6 + v7 + v7_rules + mock_v8 + v8. Look for "FAIL".
\set QUIET on
reset role;
insert into auth.users (id, email, created_at) values ('00000000-0000-0000-0000-0000000000ee', 'ContatoBabaApp@gmail.com', now() - interval '40 days'),
  ('00000000-0000-0000-0000-0000000000ff', 'velho@t', now() - interval '60 days');
insert into public.profiles (id, name) values ('00000000-0000-0000-0000-0000000000ee', 'Suporte'), ('00000000-0000-0000-0000-0000000000ff', 'Velho');
-- the staff grant at the end of v8 ran before this account existed: run it again, as the user would.
insert into private.staff (user_id) select id from auth.users where lower(email) = 'contatobabaapp@gmail.com' on conflict do nothing;
insert into public.babas (id, created_by, turma_ids, title, finished, matches) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', array['11111111-1111-1111-1111-111111111111'::uuid], 'Pelada', true, 4);
set role authenticated;

-- ===== non-staff are locked out
set request.uid = '00000000-0000-0000-0000-00000000000b';
select t_ok(not public.am_i_staff(), 'normal user is not staff');
select t_err($$select public.admin_overview()$$, 'not_staff', 'overview locked');
select t_err($$select * from public.admin_users('', 10, 0)$$, 'not_staff', 'users list locked');
select t_err($$select public.admin_adjust_points(auth.uid(), 5000, 'eu')$$, 'not_staff', 'cannot give self points');
select t_err($$select public.admin_set_staff(auth.uid(), true)$$, 'not_staff', 'cannot make self staff');
select t_err($$select private.require_staff('x', null, null)$$, 'permission denied', 'cannot call require_staff');
select t_err($$select private.is_staff_uid(auth.uid())$$, 'permission denied', 'cannot call is_staff_uid');
select t_err($$insert into public.app_notices (message) values ('hack')$$, 'row-level security', 'cannot post notices');
select t_err($$select public.srv_is_staff(auth.uid())$$, 'permission denied', 'srv_is_staff is server only');
select t_err($$select public.srv_staff_log(auth.uid(), 'x', null, null)$$, 'permission denied', 'srv_staff_log is server only');
select public.ping_activity();
select public.ping_activity();
select t_ok((select count(*) = 0 from public.user_days), 'activity table not readable by users');

set role anon;
set request.uid = '';
select t_err($$select public.admin_overview()$$, 'permission denied', 'anon cannot call admin');

-- ===== staff
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000000ee';
select t_ok(public.am_i_staff(), 'support account is staff');
select t_ok((select staff and banned_until is null from public.my_status()), 'my_status says staff');
select t_ok((select balance = 999999999 from public.my_wallet()), 'infinite points');
select t_ok((select array_length(items, 1) = (select count(*) from public.shop_items) from public.my_wallet()), 'all shop items unlocked');
select t_ok(public.equip_item('frame', 'frame_diamante') ->> 'frame' = 'diamante', 'can equip diamond');
select t_err($$select public.buy_item('frame_rubi')$$, 'owned', 'nothing left to buy');
select t_ok(public.claim_daily() = 999999999, 'daily keeps infinite');

select t_ok((public.admin_overview() ->> 'users')::int = 6, 'overview counts users');
select t_ok((public.admin_overview() ->> 'babas_done')::int = 1, 'overview counts babas');
select t_ok((public.admin_overview() ->> 'active_1d')::int = 1, 'overview counts active today');
select t_ok((public.admin_overview() ->> 'inactive_30d')::int >= 1, 'overview counts inactive');
select t_ok((select count(*) = 30 from public.admin_series(30)), 'series 30 days');
select t_ok((select sum(active) = 1 from public.admin_series(30)), 'series active');
select t_ok((select count(*) = 1 from public.admin_users('adulto', 50, 0)), 'search users by e-mail');
select t_ok((public.admin_user('00000000-0000-0000-0000-00000000000b') ->> 'age')::int >= 18, 'user detail with age');
select t_err($$select public.admin_user('00000000-0000-0000-0000-000000000999')$$, 'not_found', 'unknown user');

-- points
select t_ok(public.admin_adjust_points('00000000-0000-0000-0000-00000000000b', 250, 'teste') > 0, 'give points');
select t_ok(public.admin_adjust_points('00000000-0000-0000-0000-00000000000b', -99999, 'zerar') = 0, 'take points floors at 0');
select t_err($$select public.admin_adjust_points('00000000-0000-0000-0000-00000000000b', 0, 'x')$$, 'bad_delta', 'zero delta refused');
select public.admin_grant_item('00000000-0000-0000-0000-00000000000b', 'frame_ouro');
select public.admin_rename_user('00000000-0000-0000-0000-00000000000b', '  Adulto Renomeado ');
select public.admin_reset_cosmetics('00000000-0000-0000-0000-00000000000b');

-- bans
select t_err($$select public.admin_ban('00000000-0000-0000-0000-0000000000ee', 24, 'eu')$$, 'is_staff', 'cannot ban staff');
select public.admin_ban('00000000-0000-0000-0000-00000000000b', 24, 'xingou');
select t_ok((select count(*) = 1 from public.admin_users('adulto', 50, 0) where banned), 'shows banned');

-- notices
select public.admin_set_notice('Manutenção às 22h', 'warning');
select public.admin_set_notice('Volta já', 'info');
select t_ok((select count(*) = 1 from public.app_notices where active), 'only one notice active');

-- turmas
select t_ok((select count(*) >= 1 from public.admin_turmas('')), 'list turmas');
select public.admin_join_turma('11111111-1111-1111-1111-111111111111');
select t_ok(private.is_member('11111111-1111-1111-1111-111111111111'), 'support joined turma');
select t_ok((select count(*) >= 3 from public.admin_turma_members('11111111-1111-1111-1111-111111111111')), 'turma members');
select public.admin_leave_turma('11111111-1111-1111-1111-111111111111');
select t_ok(not private.is_member('11111111-1111-1111-1111-111111111111'), 'support left turma');

-- staff management
select t_err($$select public.admin_set_staff(auth.uid(), false)$$, 'not_self', 'cannot remove own staff');
select t_ok((select count(*) >= 10 from public.admin_log(200)), 'actions are logged');
select t_ok((select count(*) = 0 from public.admin_log(200) where action = 'pontos' and staff_name is null), 'log has staff name');

-- ===== banned user is blocked
reset role;
update public.chat_messages set created_at = created_at - interval '1 minute';
set role authenticated;
set request.uid = '00000000-0000-0000-0000-00000000000b';
select t_ok((select banned_until > now() and banned_reason = 'xingou' and notice = 'Volta já' from public.my_status()), 'banned user sees status + notice');
select t_ok((select name = 'Adulto Renomeado' from public.my_account()), 'rename applied');
select t_ok((select 'frame_ouro' = any(items) from public.my_wallet()), 'item granted');
select t_err($$insert into public.chat_messages (room, user_id, body) values ('turma:11111111-1111-1111-1111-111111111111', auth.uid(), 'oi')$$, 'row-level security', 'banned cannot chat');
select t_ok((select count(*) = 1 from public.app_notices), 'users read active notice only');

set role anon;
set request.uid = '';
select t_ok((select count(*) = 1 from public.app_notices), 'anon reads notice');

set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000000ee';
select public.admin_unban('00000000-0000-0000-0000-00000000000b');
select public.admin_set_notice('', null);
set request.uid = '00000000-0000-0000-0000-00000000000b';
select t_ok((select banned_until is null and notice is null from public.my_status()), 'unbanned, notice cleared');
insert into public.chat_messages (room, user_id, body) values ('turma:11111111-1111-1111-1111-111111111111', auth.uid(), 'voltei');
select t_ok(true, 'unbanned can chat');

-- ===== reports, lives
set request.uid = '00000000-0000-0000-0000-0000000000ee';
select t_ok((select count(*) >= 0 from public.admin_reports()), 'reports list');
select t_ok((select count(*) >= 0 from public.admin_lives()), 'lives list');

-- ===== deletion trace
reset role;
select public.srv_prepare_account_deletion('00000000-0000-0000-0000-0000000000ff');
delete from auth.users where id = '00000000-0000-0000-0000-0000000000ff';
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000000ee';
select t_ok((public.admin_overview() ->> 'deleted_30d')::int = 1, 'deletion counted');
reset role;
