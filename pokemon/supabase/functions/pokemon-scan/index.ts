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

const PROMPT = `Voici la photo d'une carte du jeu de cartes Pokémon (JCC), prise par un enfant : elle peut être de travers, floue ou mal éclairée.
Lis ce qui est imprimé sur la carte et remplis l'outil "carte_lue".
- nom : exactement comme imprimé en haut (ex. "Dracaufeu ex").
- nom_base : sans les suffixes ex, EX, V, VMAX, VSTAR, GX, BREAK, Méga, Radieux (ex. "Dracaufeu").
- numero / total : le numéro de collection en bas de la carte, avant et après la barre (ex. 025/165 → "025" et "165"). Ne devine pas : laisse vide si illisible.
- authenticite : "vraie" si rien d'anormal ; "vigilance" si un détail est à vérifier ou si la photo est trop floue pour juger ; "probable" si plusieurs signes suspects ; "fausse" si signes nets (fautes d'orthographe, PV absurdes comme 1000, attaques incohérentes, numéro ou symbole d'extension absent, couleurs délavées, mise en page anormale).
- indices : phrases très courtes en français expliquant le doute (liste vide si vraie).`;

const OUTIL = {
  name: "carte_lue",
  description: "Ce qui est lu sur la carte Pokémon photographiée.",
  input_schema: {
    type: "object",
    properties: {
      est_carte: { type: "boolean", description: "false si on ne voit pas de carte Pokémon" },
      nom: { type: "string" },
      nom_base: { type: "string" },
      langue: { type: "string", enum: ["fr", "en", "ja", "de", "es", "it", "autre"] },
      numero: { type: "string" },
      total: { type: "string" },
      pv: { type: "integer" },
      categorie: { type: "string", enum: ["Pokémon", "Dresseur", "Énergie"] },
      type: { type: "string", enum: ["Plante", "Feu", "Eau", "Électrique", "Psy", "Combat", "Obscurité", "Métal", "Fée", "Dragon", "Incolore", "Aucun"] },
      authenticite: { type: "string", enum: ["vraie", "vigilance", "probable", "fausse"] },
      indices: { type: "array", items: { type: "string" } },
    },
    required: ["est_carte", "nom", "nom_base", "langue", "authenticite", "indices"],
  },
};

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

  let r: Response;
  try { r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": cle, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      tools: [OUTIL],
      tool_choice: { type: "tool", name: "carte_lue" },
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: media, data: image } },
        { type: "text", text: PROMPT },
      ] }],
    }),
  }); } catch (e) { console.error("Appel Anthropic impossible", String(e)); return json({ error: "reseau" }, 502); }
  if (!r.ok) {
    const detail = await r.text();
    if (r.status === 404 || /model/i.test(detail)) console.error("Modèle", MODEL);
    console.error("Anthropic", r.status, detail.slice(0, 500));
    return json({ error: r.status === 401 ? "cle_invalide" : r.status === 400 && /credit/i.test(detail) ? "credit" : "ia", status: r.status }, 502);
  }
  const rep = await r.json();
  const outil = (rep.content || []).find((c: { type?: string }) => c.type === "tool_use");
  if (!outil || !outil.input) {
    console.error("Réponse sans outil", JSON.stringify(rep).slice(0, 800));
    return json({ error: "lecture" }, 502);
  }
  return json({ carte: outil.input });
});
