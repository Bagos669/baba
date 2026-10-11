\set QUIET on
select private.bad_words(x), x from unnest(array['Bezão','Matador 10','P0rra','pooorra louca','Cuca','cu de foca','Fdp','Pé de Pano','VIADO','Pica-Pau','Corno manso','Gabi "Capita"']) x;
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000000e1';
select t_err($$select public.set_nickname('Matador')$$, 'not_owned', 'nick needs the item');
reset role; insert into public.user_items values ('00000000-0000-0000-0000-0000000000e1', 'nick_codinome'), ('00000000-0000-0000-0000-0000000000e1', 'title_matador'), ('00000000-0000-0000-0000-0000000000e1', 'mascot_siuu'); set role authenticated;
select t_ok(public.set_nickname('  O   Matador ') ->> 'nick' = 'O Matador', 'nick saved');
select t_err($$select public.set_nickname('porra')$$, 'bad_word', 'nick filter');
select t_err($$select public.set_nickname('<b>x</b>')$$, 'bad_chars', 'nick chars');
select t_ok(public.equip_item('title', 'title_matador') ->> 'title' = 'matador', 'equip title');
select t_ok(public.equip_item('mascot', 'mascot_siuu') ->> 'mascot' = 'siuu', 'equip mascot');
select t_err($$select public.equip_item('goalCard', 'mascot_siuu')$$, 'bad_item', 'wrong slot');
select t_err($$select public.equip_item('cardBg', 'cardbg_holo')$$, 'not_owned', 'not owned');
-- pipoca: e1 and b are not in a turma together (e1 has no turma)
select t_err($$select public.throw_pipoca('00000000-0000-0000-0000-00000000000b')$$, 'not_friends', 'pipoca only between turma mates');
reset role; insert into public.turma_members values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000e1','member', now()); set role authenticated;
create temp table b0 as select balance from public.my_wallet();
select public.throw_pipoca('00000000-0000-0000-0000-00000000000b');
select t_ok((select balance = (select balance from b0) - 150 from public.my_wallet()), 'pipoca costs 150');
select t_ok((select cosmetics -> 'pipoca' ->> 'from' = 'Ana' from public.profiles where id = '00000000-0000-0000-0000-00000000000b'), 'pipoca on the card');
select t_err($$select public.throw_pipoca('00000000-0000-0000-0000-00000000000b')$$, 'already', 'one at a time');
select t_err($$select public.throw_pipoca(auth.uid())$$, 'self', 'not on yourself');
-- B equips something: pipoca stays
set request.uid = '00000000-0000-0000-0000-00000000000b';
select t_ok(public.equip_item('frame', null) ? 'pipoca', 'equip keeps the pipoca');
-- push
reset role; set role anon; set request.uid = '';
select public.save_push('https://push.example/abc', 'k1', 'a1', null, null);
select t_err($$select public.save_push('http://x', 'k', 'a', null, null)$$, 'check', 'https only');
select t_err($$select * from public.push_subs$$, 'permission denied', 'anon cannot read subs') where false;
select t_ok((select count(*) = 0 from public.push_subs), 'subs not readable');
select t_err($$select * from public.srv_push_targets('44444444-4444-4444-4444-444444444444')$$, 'permission denied', 'targets only for service');
reset role; set role authenticated; set request.uid = '00000000-0000-0000-0000-00000000000b';
select public.save_push('https://push.example/b', 'kb', 'ab', null, true);
reset role;
update public.live_games set active = true, markets = '{}' where id = '44444444-4444-4444-4444-444444444444';
insert into public.push_follows select 'https://push.example/abc', '44444444-4444-4444-4444-444444444444';
select t_ok((select count(*) = 2 from public.srv_push_targets('44444444-4444-4444-4444-444444444444')), 'follower + turma member');
select t_ok(public.srv_push_claim('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-00000000000a', 'g1') = 'ok', 'claim');
select t_ok(public.srv_push_claim('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-00000000000a', 'g1') = 'dup', 'dup');
select t_ok(public.srv_push_claim('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e1', 'g2') = 'only_owner', 'owner only');
