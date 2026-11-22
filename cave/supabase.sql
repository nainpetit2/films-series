-- Notre cave : tables Supabase (à exécuter UNE fois dans Supabase → SQL Editor → New query → Run)
-- 1) Remplace les deux adresses ci-dessous par vos e-mails de connexion (les mêmes que pour Films & séries).

create table if not exists public.cave_members (email text primary key);
insert into public.cave_members (email) values
  ('TON_EMAIL@exemple.fr'),
  ('EMAIL_DE_TON_EPOUSE@exemple.fr')
on conflict do nothing;
alter table public.cave_members enable row level security;

create or replace function public.is_cave_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cave_members where lower(email) = lower(auth.jwt() ->> 'email'));
$$;
grant execute on function public.is_cave_member() to authenticated;

create table if not exists public.cave_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('vin', 'apero')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.cave_items enable row level security;
grant select, insert, update, delete on public.cave_items to authenticated;
revoke all on public.cave_items from anon;
revoke all on public.cave_members from anon, authenticated;

drop policy if exists "cave lecture" on public.cave_items;
drop policy if exists "cave ajout" on public.cave_items;
drop policy if exists "cave modif" on public.cave_items;
drop policy if exists "cave suppression" on public.cave_items;
create policy "cave lecture" on public.cave_items for select to authenticated using (public.is_cave_member());
create policy "cave ajout" on public.cave_items for insert to authenticated with check (public.is_cave_member());
create policy "cave modif" on public.cave_items for update to authenticated using (public.is_cave_member()) with check (public.is_cave_member());
create policy "cave suppression" on public.cave_items for delete to authenticated using (public.is_cave_member());

-- Mise à jour en direct entre vos deux téléphones
do $$ begin
  alter publication supabase_realtime add table public.cave_items;
exception when others then null;
end $$;

-- 2) Reprise de l'inventaire actuel (ne s'exécute que si la cave est vide)
insert into public.cave_items (kind, data)
select k, d::jsonb from (values
  ('vin', '{"nom": "La Roveria - Amédée", "couleur": "Rosé", "millesime": 2024, "region": "Provence", "emplacement": "Porte-bouteilles", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "Château Blanchis Saint Emilion Grand Agasseaux", "couleur": "Rouge", "millesime": 2020, "region": "Bordeaux", "emplacement": "Garage", "quantite": 6, "conserver": true}'),
  ('vin', '{"nom": "La Pimpante - Les Galloires", "couleur": "Rosé", "millesime": 2021, "region": "Loire", "emplacement": "Porte-bouteilles", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "L''Hortus - Pic Saint Loup", "couleur": "Rouge", "millesime": 2013, "region": "Languedoc-Roussillon", "emplacement": "Garage", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "Morgon", "couleur": "Rouge", "millesime": 2023, "region": "Beaujolais", "emplacement": "Porte-bouteilles", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "Château Margui", "couleur": "Blanc", "millesime": 2024, "region": "Provence", "emplacement": "Porte-bouteilles", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "I Gioielli", "couleur": "Pétillant", "millesime": null, "region": "Italie", "emplacement": "Garage", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "Mouton Cadet", "couleur": "Blanc", "millesime": 2024, "region": "Bordeaux", "emplacement": "Porte-bouteilles", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "Château Pas du cerf - La Londe des Maures", "couleur": "Rouge", "millesime": 2023, "region": "Provence", "emplacement": "Porte-bouteilles", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "La Sanglière - Riva", "couleur": "Rosé", "millesime": 2023, "region": "Provence", "emplacement": "Porte-bouteilles", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "Les crocs blanc - God save the altesse", "couleur": "Blanc", "millesime": 2022, "region": "Jura / Savoie", "emplacement": "Porte-bouteilles", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "Domaine du Mas bleu", "couleur": "Rosé", "millesime": 2023, "region": "Provence", "emplacement": "Porte-bouteilles", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "Vin de Savoie - Aspremont", "couleur": "Blanc", "millesime": 2020, "region": "Jura / Savoie", "emplacement": "Porte-bouteilles", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "Equinoxe bio - Vinsobres", "couleur": "Rouge", "millesime": 2020, "region": "Vallée du Rhône", "emplacement": "Garage", "quantite": 1, "conserver": true}'),
  ('vin', '{"nom": "Château Les tuileries - Lalande de Pomerol", "couleur": "Rouge", "millesime": 2022, "region": "Bordeaux", "emplacement": "Porte-bouteilles", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "Secret de Margui", "couleur": "Pétillant", "millesime": null, "region": "Provence", "emplacement": "Garage", "quantite": 2, "conserver": false}'),
  ('vin', '{"nom": "Lambrusco Emilia", "couleur": "Pétillant", "millesime": null, "region": "Italie", "emplacement": "Garage", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "Montbazillac", "couleur": "Blanc", "millesime": 2019, "region": "Sud-Ouest", "emplacement": "Garage", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "Prosecco", "couleur": "Pétillant", "millesime": null, "region": "Italie", "emplacement": "Placard cuisine", "quantite": 3, "conserver": false}'),
  ('vin', '{"nom": "Colline de la Grangerie", "couleur": "Blanc", "millesime": 2022, "region": "Bourgogne", "emplacement": "Porte-bouteilles", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "Pallière", "couleur": "Blanc", "millesime": 2024, "region": "Provence", "emplacement": "Porte-bouteilles", "quantite": 1, "conserver": false}'),
  ('vin', '{"nom": "Château Fleur Cardinale - Grand cru classé", "couleur": "Rouge", "millesime": 2020, "region": "Bordeaux", "emplacement": "Garage", "quantite": 1, "conserver": true}'),
  ('vin', '{"nom": "Sun up Méditerrannée", "couleur": "Rosé", "millesime": null, "region": "Provence", "emplacement": "Garage", "quantite": 1, "conserver": false}'),
  ('apero', '{"nom": "Get 27", "type": "Digestif", "biere": "", "emplacement": "Garage", "quantite": 1}'),
  ('apero', '{"nom": "Liqueur fleurs de sureau", "type": "Apéritif", "biere": "", "emplacement": "Garage", "quantite": 1}'),
  ('apero', '{"nom": "Mousseux de Slovénie", "type": "Autre", "biere": "", "emplacement": "Placard cuisine", "quantite": 1}'),
  ('apero', '{"nom": "3 Monts", "type": "Bière", "biere": "Blonde", "emplacement": "Placard cuisine", "quantite": 1}'),
  ('apero', '{"nom": "Rhum brun Havana Club", "type": "Apéritif", "biere": "", "emplacement": "Garage", "quantite": 1}'),
  ('apero', '{"nom": "IPA", "type": "Bière", "biere": "IPA", "emplacement": "Placard cuisine", "quantite": 1}'),
  ('apero', '{"nom": "Get 37", "type": "Digestif", "biere": "", "emplacement": "Garage", "quantite": 1}'),
  ('apero', '{"nom": "Anisette", "type": "Apéritif", "biere": "", "emplacement": "Garage", "quantite": 1}'),
  ('apero', '{"nom": "Rhum brun Saint James", "type": "Apéritif", "biere": "", "emplacement": "Garage", "quantite": 1}'),
  ('apero', '{"nom": "Sangria 3L", "type": "Apéritif", "biere": "", "emplacement": "Garage", "quantite": 1}'),
  ('apero', '{"nom": "Cidre de Normandie brut", "type": "Cidre", "biere": "", "emplacement": "Placard cuisine", "quantite": 1}'),
  ('apero', '{"nom": "Goudale", "type": "Bière", "biere": "Ambrée", "emplacement": "Garage", "quantite": 1}'),
  ('apero', '{"nom": "Pastis 51", "type": "Apéritif", "biere": "", "emplacement": "Garage", "quantite": 1}'),
  ('apero', '{"nom": "Goudale", "type": "Bière", "biere": "Blonde", "emplacement": "Garage", "quantite": 1}')
) as v(k, d)
where not exists (select 1 from public.cave_items);
