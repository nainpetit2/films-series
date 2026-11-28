-- Mes cartes Pokémon : tables Supabase (déjà installées dans ton projet le 28/11/2026 — à garder pour mémoire)
-- Accès : les e-mails de pokemon_members (copiés de cave_members à l'installation).

create table if not exists public.pokemon_members (email text primary key);
insert into public.pokemon_members (email) select lower(email) from public.cave_members on conflict do nothing;
alter table public.pokemon_members enable row level security;
revoke all on public.pokemon_members from anon, authenticated;

create or replace function public.is_pokemon_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pokemon_members where lower(email) = lower(auth.jwt() ->> 'email'));
$$;
revoke execute on function public.is_pokemon_member() from public, anon;
grant execute on function public.is_pokemon_member() to authenticated;

create table if not exists public.pokemon_cards (
  id uuid primary key default gen_random_uuid(),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pokemon_cards enable row level security;
revoke all on public.pokemon_cards from anon;
grant select, insert, update, delete on public.pokemon_cards to authenticated;
create policy "pokemon lecture" on public.pokemon_cards for select to authenticated using (public.is_pokemon_member());
create policy "pokemon ajout" on public.pokemon_cards for insert to authenticated with check (public.is_pokemon_member());
create policy "pokemon modif" on public.pokemon_cards for update to authenticated using (public.is_pokemon_member()) with check (public.is_pokemon_member());
create policy "pokemon suppression" on public.pokemon_cards for delete to authenticated using (public.is_pokemon_member());

do $$ begin alter publication supabase_realtime add table public.pokemon_cards; exception when others then null; end $$;

-- Ajouter un compte (ex. celui de ton fils plus tard) :
-- insert into public.pokemon_members (email) values ('adresse@exemple.fr');

-- Reconnaissance photo : fonction Edge « pokemon-scan » (code dans supabase/functions/pokemon-scan/index.ts, déjà déployée).
-- Elle a besoin du secret ANTHROPIC_API_KEY : Supabase → Edge Functions → Secrets → Add new secret.
