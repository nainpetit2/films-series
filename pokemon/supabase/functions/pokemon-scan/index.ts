// Mes cartes Pokémon — reconnaissance d'une carte à partir d'une photo.
// La clé Anthropic reste ici, côté serveur (secret ANTHROPIC_API_KEY dans Supabase → Edge Functions → Secrets).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-haiku-5-5"; // modèle rapide et très peu cher ; "claude-sonnet-5-5" si la lecture se trompe trop souvent
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const PROMPT = `Tu regardes la photo d'une carte du jeu de cartes Pokémon (JCC), prise par un enfant : elle peut être de travers, floue ou mal éclairée.
Lis ce qui est imprimé et réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{
 "est_carte": true ou false (false si on ne voit pas de carte Pokémon),
 "nom": "le nom imprimé en haut de la carte, exactement comme écrit (ex. \\"Dracaufeu ex\\", \\"Pikachu\\", \\"Professeur Euphorbe\\")",
 "nom_base": "le nom sans les suffixes ex, EX, V, VMAX, VSTAR, GX, BREAK, Méga, Radieux, etc. (ex. \\"Dracaufeu\\")",
 "langue": "fr", "en", "ja", "de", "es", "it" ou "autre" selon la langue imprimée sur la carte,
 "numero": "le numéro de collection en bas de la carte, partie avant la barre (ex. \\"025\\" pour 025/165, \\"TG05\\", \\"SWSH045\\"), ou null si illisible",
 "total": "la partie après la barre (ex. \\"165\\"), ou null",
 "pv": nombre de PV ou null,
 "categorie": "Pokémon", "Dresseur" ou "Énergie",
 "type": pour un Pokémon, son type en français parmi Plante, Feu, Eau, Électrique, Psy, Combat, Obscurité, Métal, Fée, Dragon, Incolore ; sinon null,
 "authenticite": une note parmi
   "vraie" (très probablement vraie : rien d'anormal),
   "vigilance" (un détail à vérifier, ou photo trop floue pour juger),
   "probable" (probablement fausse : plusieurs signes suspects),
   "fausse" (très probablement fausse : signes nets, ex. fautes d'orthographe, PV absurdes comme 1000, attaques incohérentes, numéro ou symbole d'extension absent, couleurs délavées, mise en page anormale),
 "indices": ["en français, phrases très courtes, ce qui t'a fait douter ; liste vide si vraie"]
}
Ne devine pas un numéro que tu ne lis pas : mets null.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "methode" }, 405);

  // Seuls les comptes autorisés (table pokemon_members) peuvent utiliser la clé
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: membre, error: errMembre } = await sb.rpc("is_pokemon_member");
  if (errMembre || !membre) return json({ error: "acces" }, 403);

  const cle = Deno.env.get("ANTHROPIC_API_KEY");
  if (!cle) return json({ error: "cle_manquante" }, 500);

  let image = "", media = "image/jpeg";
  try {
    const b = await req.json();
    image = String(b.image || "");
    if (/^image\/(jpeg|png|webp)$/.test(b.media_type)) media = b.media_type;
  } catch { return json({ error: "requete" }, 400); }
  if (!image || image.length > 6_000_000) return json({ error: "image" }, 400);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": cle, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: media, data: image } },
        { type: "text", text: PROMPT },
      ] }],
    }),
  });
  if (!r.ok) {
    const detail = await r.text();
    console.error("Anthropic", r.status, detail.slice(0, 500));
    return json({ error: r.status === 401 ? "cle_invalide" : r.status === 400 && /credit/i.test(detail) ? "credit" : "ia", status: r.status }, 502);
  }
  const rep = await r.json();
  const texte = (rep.content || []).map((c: { text?: string }) => c.text || "").join("");
  const m = texte.match(/\{[\s\S]*\}/);
  if (!m) return json({ error: "lecture" }, 502);
  try { return json({ carte: JSON.parse(m[0]) }); }
  catch { return json({ error: "lecture" }, 502); }
});
