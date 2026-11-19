/* Mes films & séries — TMDB + Supabase */
"use strict";
const PLATFORMS=["Netflix","Prime Video","Disney+","Canal+","Apple TV+","HBO Max","Paramount+","France.tv","Arte","TF1+","M6+","Au cinéma","Location / achat","Pas dispo en streaming","Autre"];
const PCOL={"Netflix":"#E50914","Prime Video":"#1399FF","Disney+":"#1A3FC4","Canal+":"#1A1A1A","Apple TV+":"#3A3A3C","HBO Max":"#5B2BC0","Paramount+":"#0064FF","France.tv":"#2B59F2","Arte":"#E8571E","TF1+":"#0B3BA8","M6+":"#2E2E8F","Au cinéma":"#C8322F","Location / achat":"#6B5E50","Pas dispo en streaming":"#9A8F84","Autre":"#7A7067"};
const PROV_RX=[[/netflix/i,"Netflix"],[/disney/i,"Disney+"],[/canal/i,"Canal+"],[/apple tv/i,"Apple TV+"],[/hbo|^max\b/i,"HBO Max"],[/paramount/i,"Paramount+"],[/france ?tv|france\.tv/i,"France.tv"],[/^arte/i,"Arte"],[/tf1/i,"TF1+"],[/^m6/i,"M6+"],[/amazon|prime video/i,"Prime Video"]];
const IMG="https://image.tmdb.org/t/p/";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=(v,d=1)=>v==null||v===""?"–":Number(v).toLocaleString("fr-FR",{minimumFractionDigits:d,maximumFractionDigits:d});
const LS={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}};

const CFG=window.APP_CONFIG||{};
function normUrl(u){
  u=String(u||"").trim();
  let m=u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{10,})/i); if(m) return `https://${m[1].toLowerCase()}.supabase.co`;
  m=u.match(/^(?:https?:\/\/)?([a-z0-9]{10,})\.supabase\.co/i); if(m) return `https://${m[1].toLowerCase()}.supabase.co`;
  if(/^[a-z0-9]{15,30}$/i.test(u)) return `https://${u.toLowerCase()}.supabase.co`;
  return u.replace(/\/(rest|auth)\/v1.*$/,"").replace(/\/+$/,"");
}
let SB_URL=normUrl(CFG.supabaseUrl||LS.get("sb_url")||""), SB_KEY=(CFG.supabaseKey||LS.get("sb_key")||"").trim();
let sb=null, user=null, prefs={tmdb:LS.get("tmdb")||"",omdb:LS.get("omdb")||""};
let items=[], loaded=false;
let tab="film", filter="avoir", query="", plat="";
let openId=null, mode=null, confirmDel=false;
const timers={}, chains={}, dirty=new Set(), openSeasons={}, refreshing=new Set();

function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("on");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("on"),2600)}
function getItem(id){return items.find(i=>i.id===id)||null}
function cacheLocal(){LS.set("cache_items",JSON.stringify(items.map(i=>({...i}))))}

/* ================= Supabase ================= */
function initSb(){
  if(!SB_URL||!SB_KEY||!window.supabase) return false;
  sb=window.supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  return true;
}
async function loadAll(){
  const {data,error}=await sb.from("items").select("id,data").order("created_at",{ascending:false});
  if(error) throw error;
  const fresh=data.map(r=>({...r.data,id:r.id}));
  // keep local unsaved edits
  items=fresh.map(f=>dirty.has(f.id)?(getItem(f.id)||f):f);
  loaded=true; cacheLocal(); render();
}
async function loadPrefs(){
  const {data}=await sb.from("prefs").select("tmdb_token,omdb_key").maybeSingle();
  if(data){ if(data.tmdb_token){prefs.tmdb=data.tmdb_token;LS.set("tmdb",prefs.tmdb)} if(data.omdb_key){prefs.omdb=data.omdb_key;LS.set("omdb",prefs.omdb)} }
}
async function savePrefs(){
  LS.set("tmdb",prefs.tmdb||null); LS.set("omdb",prefs.omdb||null);
  if(!sb||!user) return;
  const {error}=await sb.from("prefs").upsert({user_id:user.id,tmdb_token:prefs.tmdb||null,omdb_key:prefs.omdb||null,updated_at:new Date().toISOString()});
  if(error) toast("Réglages non synchronisés : "+error.message);
}
function patch(id,f,delay=600){
  const it=getItem(id); if(!it) return;
  Object.assign(it,f); dirty.add(id);
  clearTimeout(timers[id]); timers[id]=setTimeout(()=>flush(id),delay);
  render();
}
function flush(id){
  if(!dirty.has(id)) return; dirty.delete(id);
  const it=getItem(id); if(!it) return;
  const {id:_,...data}=it;
  chains[id]=(chains[id]||Promise.resolve()).then(async()=>{
    const {error}=await sb.from("items").update({data,updated_at:new Date().toISOString()}).eq("id",id);
    if(error){dirty.add(id);toast("Enregistrement impossible, je réessaierai.");clearTimeout(timers[id]);timers[id]=setTimeout(()=>flush(id),8000)}
    else cacheLocal();
  });
}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"){for(const id of [...dirty])flush(id)}else if(sb&&user&&!openId){loadAll().catch(()=>{})}});
async function createItem(data){
  const {data:row,error}=await sb.from("items").insert({data}).select("id").single();
  if(error) throw error;
  const it={...data,id:row.id}; items.unshift(it); cacheLocal(); render(); return it;
}
async function deleteItem(id){
  clearTimeout(timers[id]); dirty.delete(id);
  await (chains[id]||Promise.resolve());
  const {error}=await sb.from("items").delete().eq("id",id);
  if(error) throw error;
  items=items.filter(i=>i.id!==id); cacheLocal();
}

/* ================= TMDB ================= */
async function tm(path,params={}){
  const t=(prefs.tmdb||"").trim(); if(!t) throw {code:"notoken"};
  const q=new URLSearchParams({language:"fr-FR",...params});
  const h={accept:"application/json"};
  if(t.startsWith("eyJ")) h.Authorization="Bearer "+t; else q.set("api_key",t);
  const qs=q.toString().replace(/%2C/gi,",").replace(/%2F/gi,"/");
  const r=await fetch(`https://api.themoviedb.org/3${path}?${qs}`,{headers:h});
  if(r.status===401) throw {code:"badtoken"};
  if(!r.ok) throw {code:"http",status:r.status};
  return r.json();
}
function mapProviders(wp){
  const fr=wp?.results?.FR; if(!fr) return {list:[],platform:null,link:null};
  const seen=new Set(), list=[];
  const add=(arr,kind)=>(arr||[]).forEach(p=>{const k=p.provider_name;if(seen.has(k))return;seen.add(k);list.push({name:k,logo:p.logo_path,kind,prio:p.display_priority??99})});
  add(fr.flatrate,"abonnement"); add(fr.free,"gratuit"); add(fr.ads,"avec pub"); add(fr.rent,"location"); add(fr.buy,"achat");
  let platform=null;
  for(const p of list.filter(p=>p.kind!=="location"&&p.kind!=="achat").sort((a,b)=>a.prio-b.prio)){const m=PROV_RX.find(([rx])=>rx.test(p.name));if(m){platform=m[1];break}}
  if(!platform&&list.some(p=>p.kind==="abonnement"||p.kind==="gratuit"||p.kind==="avec pub")) platform="Autre";
  if(!platform&&list.length) platform="Location / achat";
  return {list:list.slice(0,8),platform,link:fr.link||null};
}
async function fetchDetails(mediaType,tmdbId){
  if(mediaType==="movie"){
    let d; try{ d=await tm(`/movie/${tmdbId}`,{append_to_response:"credits,release_dates"}); }catch(e){ if(e?.code!=="http") throw e; d=await tm(`/movie/${tmdbId}`); }
    const pv=mapProviders(await tm(`/movie/${tmdbId}/watch/providers`,{}).catch(()=>null));
    let platform=pv.platform;
    if(!platform){ // still in theaters in France?
      const fr=(d.release_dates?.results||[]).find(r=>r.iso_3166_1==="FR");
      const th=fr?.release_dates?.find(x=>x.type===3)?.release_date||d.release_date;
      if(th){const days=(Date.now()-new Date(th))/864e5; if(days>-60&&days<120) platform="Au cinéma"; else platform="Pas dispo en streaming"}
    }
    return {type:"film",mediaType:"movie",tmdbId,title:d.title,originalTitle:d.original_title,year:d.release_date?+d.release_date.slice(0,4):null,
      poster:d.poster_path,backdrop:d.backdrop_path,genres:(d.genres||[]).map(g=>g.name).slice(0,3),synopsis:d.overview||"",
      director:(d.credits?.crew||[]).filter(c=>c.job==="Director").map(c=>c.name).slice(0,2).join(", "),
      runtime:d.runtime||null,tmdbVote:d.vote_count>20?Math.round(d.vote_average*10)/10:null,imdbId:d.imdb_id||null,
      providers:pv.list,providersLink:pv.link,autoPlatform:platform,providersDate:Date.now()};
  } else {
    let d; try{ d=await tm(`/tv/${tmdbId}`,{append_to_response:"external_ids"}); }catch(e){ if(e?.code!=="http") throw e; d=await tm(`/tv/${tmdbId}`); }
    const pv=mapProviders(await tm(`/tv/${tmdbId}/watch/providers`,{}).catch(()=>null));
    return {type:"serie",mediaType:"tv",tmdbId,title:d.name,originalTitle:d.original_name,year:d.first_air_date?+d.first_air_date.slice(0,4):null,
      poster:d.poster_path,backdrop:d.backdrop_path,genres:(d.genres||[]).map(g=>g.name).slice(0,3),synopsis:d.overview||"",
      director:(d.created_by||[]).map(c=>c.name).slice(0,2).join(", "),
      tmdbVote:d.vote_count>20?Math.round(d.vote_average*10)/10:null,imdbId:d.external_ids?.imdb_id||null,
      tmdbSeasons:(d.seasons||[]).filter(s=>s.season_number>0&&s.episode_count>0).map(s=>({n:s.season_number,eps:s.episode_count})),
      ongoing:d.in_production??(d.status==="Returning Series"),
      nextAir:d.next_episode_to_air?{date:d.next_episode_to_air.air_date,s:d.next_episode_to_air.season_number,e:d.next_episode_to_air.episode_number}:null,
      providers:pv.list,providersLink:pv.link,autoPlatform:pv.platform||(d.in_production?null:"Pas dispo en streaming"),providersDate:Date.now()};
  }
}
async function fetchOmdb(imdbId){
  if(!prefs.omdb||!imdbId) return {};
  try{
    const r=await fetch(`https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(prefs.omdb)}`);
    const d=await r.json(); if(d.Response!=="True") return {};
    const rt=(d.Ratings||[]).find(x=>x.Source==="Rotten Tomatoes");
    return {imdbRating:d.imdbRating&&d.imdbRating!=="N/A"?+d.imdbRating:null,rtCriticsAuto:rt?parseInt(rt.Value):null};
  }catch(e){return {}}
}
function mergeSeasons(old,fresh){
  old=old||[]; const out=fresh.map(f=>{const o=old.find(x=>x.n===f.n);return {n:f.n,eps:f.eps,w:(o?.w||[]).filter(e=>e<=f.eps)}});
  old.forEach(o=>{if(!out.find(x=>x.n===o.n))out.push(o)});
  return out.sort((a,b)=>a.n-b.n);
}
async function refreshItem(id,manual){
  const it=getItem(id); if(!it||!it.tmdbId||refreshing.has(id)) return;
  refreshing.add(id); if(manual) render();
  try{
    const d=await fetchDetails(it.mediaType,it.tmdbId);
    const om=await fetchOmdb(d.imdbId);
    const f={...d,...om}; delete f.type;
    if(d.tmdbSeasons){f.seasons=mergeSeasons(it.seasons,d.tmdbSeasons)}
    delete f.tmdbSeasons;
    if(it.titleManual) delete f.title;
    patch(id,f,0);
    if(manual) toast("Fiche à jour");
  }catch(e){ if(manual) toast(tmErr(e)); }
  finally{refreshing.delete(id); render()}
}
function tmErr(e){return e?.code==="notoken"?"Ajoute ta clé TMDB dans les réglages.":e?.code==="badtoken"?"Clé TMDB refusée : vérifie-la dans les réglages.":(e?.status?`TMDB a refusé la demande (erreur ${e.status}).`:"TMDB ne répond pas : "+(e?.message||"réseau"))}

/* ================= helpers ================= */
function seriesStats(it){let tot=0,seen=0;(it.seasons||[]).forEach(s=>{tot+=s.eps||0;seen+=Math.min((s.w||[]).length,s.eps||0)});return {tot,seen,pct:tot?seen/tot:0}}
function statusOf(it){
  if(it.type==="film") return it.status==="vu"?"vu":"avoir";
  const {tot,seen}=seriesStats(it);
  if(!tot||!seen) return "avoir";
  return seen>=tot?"vu":"encours";
}
function platformOf(it){return it.platformManual||it.autoPlatform||""}
function nextEp(it){for(const s of (it.seasons||[])){const w=new Set(s.w||[]);for(let e=1;e<=(s.eps||0);e++)if(!w.has(e))return {n:s.n,e}}return null}
function hashCol(s){let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))>>>0;const hues=[352,20,200,160,260,30,330,210];const hu=hues[h%hues.length];return `linear-gradient(160deg,hsl(${hu} 45% 38%),hsl(${(hu+30)%360} 50% 18%))`}
function posterHTML(it,size="w342"){
  return it.poster?`<img src="${IMG}${size}${esc(it.poster)}" alt="" loading="lazy">`:`<div class="ph" style="background:${hashCol(it.title)}"><small>${it.type==="serie"?"Série":"Film"}${it.year?" · "+it.year:""}</small>${esc(it.title)}</div>`;
}
function dateFr(d){try{return new Date(d).toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}catch(e){return d}}
const FILTERS={film:[["avoir","À voir"],["vu","Vus"],["tous","Tous"]],serie:[["avoir","À voir"],["encours","En cours"],["vu","Terminées"],["tous","Toutes"]]};
const CHECK=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

/* ================= list ================= */
function ratesHTML(it){
  const parts=[];
  if(it.tmdbVote!=null) parts.push(`<span><i class="dotT"></i>${fmt(it.tmdbVote)}</span>`);
  const a=it.allocineSpect??it.allocinePresse; if(a!=null) parts.push(`<span><i class="dotA"></i>${fmt(a)}</span>`);
  const r=it.rtCritics??it.rtCriticsAuto; if(r!=null) parts.push(`<span><i class="dotR"></i>${Math.round(r)}%</span>`);
  return parts.length?`<div class="rates">${parts.slice(0,2).join("")}</div>`:"";
}
function render(){
  const ofTab=items.filter(i=>i.type===tab);
  const nF=items.filter(i=>i.type==="film"&&statusOf(i)==="avoir").length, nS=items.filter(i=>i.type==="serie"&&statusOf(i)==="encours").length, nV=items.filter(i=>statusOf(i)==="vu").length;
  $("#stats").innerHTML=loaded?`<div class="stat"><b>${nF}</b>film${nF>1?"s":""} à voir</div><div class="stat"><b>${nS}</b>série${nS>1?"s":""} en cours</div><div class="stat"><b>${nV}</b>vu${nV>1?"s":""}</div>`:`<div class="stat"><b>…</b>chargement</div>`;
  const ong=items.filter(i=>i.type==="serie"&&statusOf(i)==="encours").sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  $("#resume").classList.toggle("hidden",!ong.length);
  $("#rail").innerHTML=ong.map(it=>{const s=seriesStats(it),nx=nextEp(it);return `<div class="rc" data-id="${it.id}"><div class="poster">${posterHTML(it,"w154")}</div><div class="i"><div class="t">${esc(it.title)}</div><div class="nx">${nx?`Prochain : <b>S${nx.n} · É${nx.e}</b>`:""}${platformOf(it)?` · ${esc(platformOf(it))}`:""}</div><div class="prog"><i style="width:${Math.round(s.pct*100)}%"></i></div><div class="pl">${s.seen}/${s.tot} épisodes</div>${nx?`<button class="go" data-next="${it.id}">✓ S${nx.n}É${nx.e} vu</button>`:""}</div></div>`}).join("");
  const inPlat=ofTab.filter(i=>!plat||(plat==="__none"?!platformOf(i):platformOf(i)===plat));
  const counts={}; inPlat.forEach(i=>{const s=statusOf(i);counts[s]=(counts[s]||0)+1});counts.tous=inPlat.length;
  $("#filters").innerHTML=FILTERS[tab].map(([k,l])=>`<button class="chip ${filter===k?"on":""}" data-f="${k}">${l}<span class="n">${counts[k]||0}</span></button>`).join("");
  const inStat=ofTab.filter(i=>filter==="tous"||statusOf(i)===filter);
  const pc={}; ofTab.forEach(i=>{const p=platformOf(i);if(p)pc[p]=0}); inStat.forEach(i=>{const p=platformOf(i);if(p)pc[p]++});
  const noP=inStat.filter(i=>!platformOf(i)).length;
  const plist=PLATFORMS.filter(p=>p in pc);
  if(plat&&plat!=="__none"&&!(plat in pc)) plat="";
  $("#plats").classList.toggle("hidden",!plist.length);
  $("#plats").innerHTML=`<button class="chip ${!plat?"on":""}" data-p="">Toutes plateformes</button>`+plist.map(p=>`<button class="chip ${plat===p?"on":""}" data-p="${esc(p)}" style="--pc:${PCOL[p]||"#1A1520"}"><i class="pd" style="background:${PCOL[p]||"#999"}"></i>${esc(p)}<span class="n">${pc[p]}</span></button>`).join("")+(noP&&plist.length?`<button class="chip ${plat==="__none"?"on":""}" data-p="__none">Sans plateforme<span class="n">${noP}</span></button>`:"");
  $("#searchWrap").classList.toggle("hidden",ofTab.length<8);
  const q=query.trim().toLowerCase();
  const list=inStat.filter(i=>!plat||(plat==="__none"?!platformOf(i):platformOf(i)===plat)).filter(i=>!q||(i.title+" "+(i.originalTitle||"")+" "+platformOf(i)).toLowerCase().includes(q));
  list.sort((a,b)=>{if(tab==="serie"&&filter==="tous"){const o={encours:0,avoir:1,vu:2};const d=o[statusOf(a)]-o[statusOf(b)];if(d)return d}return (b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0)});
  $("#grid").innerHTML=list.map(it=>{
    const st=statusOf(it), s=it.type==="serie"?seriesStats(it):null, p=platformOf(it);
    return `<button class="card" data-id="${it.id}"><div class="poster">${posterHTML(it)}${p?`<span class="badge" style="background:${PCOL[p]||"rgba(20,18,16,.7)"}">${esc(p)}</span>`:""}${it.myRating!=null?`<span class="my">★ ${fmt(it.myRating)}</span>`:""}${st==="vu"?`<span class="seen">${CHECK}</span>`:""}</div>
      <div class="meta"><div class="t">${esc(it.title)}</div><div class="y">${[it.year,it.genres?.[0]?esc(it.genres[0]):"",it.type==="serie"&&it.seasons?.length?`${it.seasons.length} saison${it.seasons.length>1?"s":""}`:""].filter(Boolean).join(" · ")}</div>
      ${ratesHTML(it)}${s&&s.tot&&st!=="avoir"?`<div class="prog ${s.seen>=s.tot?"done":""}"><i style="width:${Math.round(s.pct*100)}%"></i></div><div class="pl">${s.seen}/${s.tot} épisodes</div>`:""}</div></button>`}).join("");
  const em=$("#empty");
  if(loaded&&!list.length){em.classList.remove("hidden");em.innerHTML=ofTab.length?`<b>Rien ici</b>Aucun titre avec ces filtres.`:`<b>${tab==="film"?"Aucun film":"Aucune série"} pour l'instant</b>Touche « Ajouter » et cherche un titre : affiche, plateformes et saisons arrivent toutes seules.`}
  else em.classList.add("hidden");
  if(openId&&mode==="detail") renderDetail();
}

/* ================= sheet ================= */
function setBackdrop(it){
  const b=$("#backdrop"), sh=$("#sheetBody");
  if(it&&it.backdrop){b.className="backdrop real";b.innerHTML=`<div style="background-image:url(&quot;${IMG}w780${esc(it.backdrop)}&quot;)"></div>`;sh.classList.add("hasbd")}
  else if(it&&it.poster){b.className="backdrop";b.innerHTML=`<div style="background-image:url(&quot;${IMG}w342${esc(it.poster)}&quot;)"></div>`;sh.classList.remove("hasbd")}
  else {b.className="backdrop";b.innerHTML=it?`<div style="background:${hashCol(it.title)}"></div>`:"";sh.classList.remove("hasbd")}
}
function openSheet(){$("#scrim").classList.add("on");$("#sheet").classList.add("on");$("#sheet").scrollTop=0}
function closeSheet(){if(openId)flush(openId);openId=null;mode=null;confirmDel=false;$("#scrim").classList.remove("on");$("#sheet").classList.remove("on");setTimeout(()=>{if(!mode){setBackdrop(null);$("#sheetBody").dataset.bd=""}},300)}
$("#scrim").onclick=closeSheet; $("#close").onclick=closeSheet;

/* ---- add (search) ---- */
let searchCtl=null, searchT=null;
function openAdd(){
  mode="add"; openId=null; setBackdrop(null);
  $("#sheetBody").innerHTML=`<h2>Ajouter</h2>
  <input class="in" id="sq" placeholder="Titre d'un film ou d'une série…" autocomplete="off" enterkeyhint="search">
  <div class="res" id="sres"></div>`;
  const inp=$("#sq");
  inp.oninput=()=>{clearTimeout(searchT);searchT=setTimeout(()=>doSearch(inp.value),350)};
  openSheet(); setTimeout(()=>inp.focus(),250);
  if(!prefs.tmdb) $("#sres").innerHTML=`<div class="ai">Ajoute d'abord ta clé TMDB dans les réglages (roue crantée).</div>`;
}
async function doSearch(q){
  const box=$("#sres"); if(!box) return;
  q=q.trim(); if(q.length<2){box.innerHTML="";return}
  box.innerHTML=`<div class="mini">Recherche…</div>`;
  try{
    const d=await tm("/search/multi",{query:q,include_adult:"false"});
    if(mode!=="add"||$("#sq").value.trim()!==q) return;
    const res=(d.results||[]).filter(r=>r.media_type==="movie"||r.media_type==="tv").slice(0,12);
    if(!res.length){box.innerHTML=`<div class="mini">Aucun résultat.</div>`;return}
    box.innerHTML=res.map(r=>{
      const tv=r.media_type==="tv", t=tv?r.name:r.title, ot=tv?r.original_name:r.original_title, y=(tv?r.first_air_date:r.release_date||"").slice(0,4);
      const has=items.some(i=>i.tmdbId===r.id&&i.mediaType===r.media_type);
      return `<button class="ri ${has?"has":""}" data-mt="${r.media_type}" data-tid="${r.id}">${r.poster_path?`<img src="${IMG}w92${esc(r.poster_path)}" alt="">`:`<div class="noimg"></div>`}<div style="min-width:0"><div class="t">${esc(t)}</div><div class="y">${[y,ot&&ot!==t?esc(ot):""].filter(Boolean).join(" · ")}${has?" · déjà dans ta liste":""}</div></div><span class="tag ${tv?"tv":""}">${tv?"Série":"Film"}</span></button>`}).join("")
      +`<button class="btn sec" id="manualAdd" style="margin-top:6px">Introuvable ? Ajouter « ${esc(q)} » à la main</button>`;
    box.querySelectorAll(".ri").forEach(b=>b.onclick=()=>addFromTmdb(b.dataset.mt,+b.dataset.tid,b));
    $("#manualAdd").onclick=()=>addManual(q);
  }catch(e){box.innerHTML=`<div class="ai">${esc(tmErr(e))}</div>`}
}
async function addFromTmdb(mt,tid,btn){
  const ex=items.find(i=>i.tmdbId===tid&&i.mediaType===mt); if(ex){openDetail(ex.id);return}
  btn.disabled=true; btn.style.opacity=.6;
  try{
    const d=await fetchDetails(mt,tid);
    const om=await fetchOmdb(d.imdbId);
    const now=Date.now();
    const data={...d,...om,status:"avoir",createdAt:now,updatedAt:now};
    if(d.tmdbSeasons){data.seasons=d.tmdbSeasons.map(s=>({...s,w:[]}))} delete data.tmdbSeasons;
    const it=await createItem(data);
    tab=it.type; filter="avoir"; plat=""; syncTabs(); render();
    openDetail(it.id); toast(`${it.title} ajouté`);
  }catch(e){btn.disabled=false;btn.style.opacity=1;toast(e?.code?tmErr(e):"Ajout impossible : "+(e.message||"erreur"))}
}
async function addManual(title){
  const now=Date.now(), type=tab;
  try{const it=await createItem({type,title,status:"avoir",seasons:type==="serie"?[]:undefined,createdAt:now,updatedAt:now});openDetail(it.id)}
  catch(e){toast("Ajout impossible : "+(e.message||"erreur"))}
}

/* ---- detail ---- */
function openDetail(id){openId=id;mode="detail";confirmDel=false;$("#sheetBody").dataset.bd="";renderDetail();openSheet();
  const it=getItem(id); if(it&&it.tmdbId&&(!it.providersDate||Date.now()-it.providersDate>3*864e5)) refreshItem(id,false);
}
const STAR='<path d="M12 2.6l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" stroke-linejoin="round"/>';
function starsHTML(v){let h='<div class="stars">';for(let i=0;i<5;i++){const f=v==null?0:Math.max(0,Math.min(1,v-i));h+=`<button class="star" data-star="${i}" aria-label="${i+1} étoiles"><svg viewBox="0 0 24 24" fill="#E8E2D8" stroke="#D5CEC3" stroke-width="1">${STAR}</svg><svg class="fg" style="--f:${f*100}%" viewBox="0 0 24 24" fill="#E8A317" stroke="#D08F0C" stroke-width="1">${STAR}</svg></button>`}return h+`<span class="val">${v==null?'<small>Touche pour noter</small>':fmt(v)+' <small>/5</small>'}</span></div>`}
function rbox(it,key,label,dot,unit,max,auto){const v=it[key]??(auto?it[auto]:null);return `<div class="rbox"><small><i class="${dot}"></i>${label}</small><div style="display:flex;align-items:baseline;gap:4px"><input inputmode="decimal" data-r="${key}" data-max="${max}" value="${v==null?"":String(v).replace(".",",")}" placeholder="–"><span class="u">${unit}</span></div></div>`}
function renderDetail(){
  const it=getItem(openId); if(!it){closeSheet();return}
  const body=$("#sheetBody"), a=document.activeElement;
  if(a&&body.contains(a)&&a.matches("input,textarea,select")) return;
  if(body.dataset.bd!==(it.backdrop||it.poster||"x")){body.dataset.bd=it.backdrop||it.poster||"x";setBackdrop(it)}
  const st=statusOf(it), isS=it.type==="serie", s=isS?seriesStats(it):null, p=platformOf(it);
  const qfr=encodeURIComponent(it.title), qo=encodeURIComponent(it.originalTitle||it.title);
  const busy=refreshing.has(it.id);
  body.innerHTML=`
  <div class="hero"><div class="poster">${posterHTML(it)}</div><div class="info">
    <div class="tt">${esc(it.title)}</div>
    <div class="ot">${[it.originalTitle&&it.originalTitle!==it.title?esc(it.originalTitle):"",it.year,it.runtime?`${Math.floor(it.runtime/60)}h${String(it.runtime%60).padStart(2,"0")}`:""].filter(Boolean).join(" · ")}</div>
    ${it.director?`<div class="ot">${isS?"Créée par":"De"} ${esc(it.director)}</div>`:""}
    ${it.genres?.length?`<div class="ot">${esc(it.genres.join(", "))}</div>`:""}
    ${isS?(s.tot?`<span class="status ${st==="vu"?"ok":""}">${st==="vu"?"Terminée":st==="encours"?"En cours":"À voir"}</span>`:""):`<button class="status ${st==="vu"?"ok":""}" id="togFilm">${st==="vu"?"✓ Vu":"À voir — marquer vu"}</button>`}
  </div></div>
  ${isS&&it.nextAir?`<span class="nextair">Prochain épisode S${it.nextAir.s}É${it.nextAir.e} le ${esc(dateFr(it.nextAir.date))}</span>`:""}
  ${it.synopsis?`<div class="syn">${esc(it.synopsis)}</div>`:""}
  ${st!=="avoir"||it.myRating!=null?`<label class="f">Ma note</label>${starsHTML(it.myRating)}`:""}

  <label class="f">Où le regarder</label>
  ${it.providers?.length?`<div class="prov">${it.providers.map(x=>`<div class="p">${x.logo?`<img src="${IMG}w92${esc(x.logo)}" alt="">`:""}<span>${esc(x.name)}<br><small>${esc(x.kind)}</small></span></div>`).join("")}</div><div class="jw">Disponibilités en France fournies par JustWatch${it.providersDate?` · mises à jour le ${dateFr(it.providersDate)}`:""}</div>`:`<div class="mini">${it.tmdbId?(busy?"Recherche des plateformes…":"Aucune plateforme en France pour l'instant."):"Fiche ajoutée à la main."}</div>`}
  <select class="in" data-k="platformManual" style="margin-top:10px"><option value="">${it.autoPlatform?`Auto : ${esc(it.autoPlatform)}`:"Plateforme : automatique"}</option>${PLATFORMS.map(x=>`<option ${it.platformManual===x?"selected":""}>${x}</option>`).join("")}</select>
  <div class="links">${it.providersLink?`<a href="${esc(it.providersLink)}" target="_blank" rel="noopener">Voir sur JustWatch</a>`:`<a href="https://www.justwatch.com/fr/recherche?q=${qfr}" target="_blank" rel="noopener">JustWatch</a>`}</div>

  <label class="f">Notes</label>
  <div class="rgrid">
    <div class="rbox"><small><i class="dotT"></i>TMDB</small><div style="font-size:22px;font-weight:800;padding-top:2px">${fmt(it.tmdbVote)} <span class="u">/10</span></div></div>
    ${prefs.omdb||it.imdbRating!=null?`<div class="rbox"><small><i class="dotI"></i>IMDb</small><div style="font-size:22px;font-weight:800;padding-top:2px">${fmt(it.imdbRating)} <span class="u">/10</span></div></div>`:rbox(it,"rtAudience","RT public","dotR","%",100)}
    ${rbox(it,"rtCritics","Rotten Tomatoes","dotR","%",100,"rtCriticsAuto")}
    ${rbox(it,"allocineSpect","AlloCiné spect.","dotA","/5",5)}
  </div>
  <div class="rnote">AlloCiné n'a pas d'accès public : saisis la note si elle t'intéresse.${prefs.omdb?"":" Rotten Tomatoes et IMDb se remplissent seuls avec une clé OMDb (réglages)."}</div>
  <div class="links"><a href="https://www.allocine.fr/rechercher/?q=${qfr}" target="_blank" rel="noopener">AlloCiné</a><a href="https://www.rottentomatoes.com/search?search=${qo}" target="_blank" rel="noopener">Rotten Tomatoes</a>${it.tmdbId?`<a href="https://www.themoviedb.org/${it.mediaType}/${it.tmdbId}" target="_blank" rel="noopener">TMDB</a>`:""}</div>

  ${isS?seasonsHTML(it,s):""}

  <label class="f">Mes notes</label>
  <textarea class="in" data-k="notes" rows="2" placeholder="Recommandé par…, à voir avec…">${esc(it.notes||"")}</textarea>
  ${it.tmdbId?"":`<label class="f">Titre</label><input class="in" data-k="title" value="${esc(it.title)}">`}
  <div style="height:14px"></div>
  ${it.tmdbId?`<button class="btn ghost" id="refresh" ${busy?"disabled":""}>${busy?"Mise à jour…":"Actualiser la fiche (plateformes, saisons)"}</button>`:""}
  ${confirmDel?`<div class="confirm">Supprimer « ${esc(it.title)} » ? <div class="row" style="margin-top:10px"><button class="btn sec" id="noDel">Annuler</button><button class="btn red" id="yesDel">Supprimer</button></div></div>`:`<button class="danger" id="del">Supprimer</button>`}`;
  bindDetail(it);
}
function seasonsHTML(it,s){
  const ss=it.seasons||[];
  return `<label class="f">Progression</label>
  <div class="bigprog"><div class="l"><span>${s.seen} / ${s.tot} épisodes</span><span>${Math.round(s.pct*100)} %</span></div><div class="prog ${s.tot&&s.seen>=s.tot?"done":""}"><i style="width:${Math.round(s.pct*100)}%"></i></div>
  ${s.tot?`<div class="row" style="margin-top:10px"><button class="btn sec" data-all="1" style="padding:9px">Tout cocher</button><button class="btn sec" data-all="0" style="padding:9px">Tout décocher</button></div>`:""}</div>
  ${ss.map((se,i)=>{const w=new Set(se.w||[]),n=se.eps||0,c=[...w].filter(x=>x<=n).length,full=n&&c>=n,part=c>0&&!full;const open=openSeasons[it.id+"_"+i]??(!full&&c>0);
    return `<div class="season"><div class="shd"><button class="ck ${full?"on":part?"part":""}" data-season="${i}" aria-label="Cocher la saison">${full?CHECK:part?`<span style="width:10px;height:3px;background:var(--ok);border-radius:2px"></span>`:""}</button><span class="nm">Saison ${se.n}</span><span class="cnt">${c}/${n}</span><button class="tog" data-open="${i}" aria-label="Épisodes"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="transform:rotate(${open?180:0}deg);transition:.2s"><path d="m6 9 6 6 6-6"/></svg></button></div>
    ${open?`<div class="eps">${Array.from({length:n},(_,k)=>`<button class="ep ${w.has(k+1)?"on":""}" data-ep="${i}:${k+1}">${k+1}</button>`).join("")}</div>${it.tmdbId?"":`<div class="sedit">Épisodes <input inputmode="numeric" data-eps="${i}" value="${n}"><button data-rmseason="${i}">Retirer la saison</button></div>`}`:""}</div>`}).join("")}
  ${it.tmdbId?"":`<div style="height:10px"></div><button class="btn sec" id="addSeason">+ Ajouter une saison</button>`}`;
}
function setSeasons(id,fn){const it=getItem(id);const ss=(it.seasons||[]).map(s=>({...s,w:[...(s.w||[])]}));fn(ss);patch(id,{seasons:ss,updatedAt:Date.now()},800)}
function bindDetail(it){
  const id=it.id, body=$("#sheetBody");
  const tf=$("#togFilm"); if(tf) tf.onclick=()=>patch(id,{status:it.status==="vu"?"avoir":"vu",updatedAt:Date.now()},0);
  body.querySelectorAll("[data-k]").forEach(el=>{const k=el.dataset.k;const save=()=>{let v=el.value;if(k==="title"){v=v.trim();if(!v){el.value=it.title;return}}if((it[k]||"")!==v)patch(id,{[k]:v||null,...(k==="title"?{titleManual:true}:{}),updatedAt:Date.now()},0)};
    if(el.tagName==="SELECT")el.onchange=()=>{save();el.blur()};else el.onblur=()=>{save();setTimeout(renderDetail,0)}});
  body.querySelectorAll("[data-r]").forEach(el=>{el.onblur=()=>{const k=el.dataset.r,max=+el.dataset.max;const t=el.value.replace(",",".").replace("%","").trim();let v=t===""?null:Number(t);if(v!=null&&(isNaN(v)||v<0))v=it[k]??null;if(v!=null)v=Math.min(v,max);if(v!==(it[k]??null))patch(id,{[k]:v},0);setTimeout(renderDetail,0)};el.onkeydown=e=>{if(e.key==="Enter")el.blur()}});
  body.querySelectorAll("[data-star]").forEach(b=>b.onclick=e=>{const r=b.getBoundingClientRect(),i=+b.dataset.star;const v=i+((e.clientX-r.left)<r.width/2?.5:1);patch(id,{myRating:it.myRating===v?null:v,updatedAt:Date.now()},0)});
  body.querySelectorAll("[data-season]").forEach(b=>b.onclick=()=>setSeasons(id,ss=>{const s=ss[+b.dataset.season],n=s.eps||0;s.w=s.w.filter(x=>x<=n).length>=n?[]:Array.from({length:n},(_,k)=>k+1)}));
  body.querySelectorAll("[data-ep]").forEach(b=>b.onclick=()=>{const [i,e]=b.dataset.ep.split(":").map(Number);setSeasons(id,ss=>{const s=ss[i];s.w=s.w.includes(e)?s.w.filter(x=>x!==e):[...s.w,e].sort((a,b)=>a-b)})});
  body.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>{const k=id+"_"+b.dataset.open;openSeasons[k]=!body.querySelector(`[data-ep^="${b.dataset.open}:"]`);renderDetail()});
  body.querySelectorAll("[data-all]").forEach(b=>b.onclick=()=>setSeasons(id,ss=>ss.forEach(s=>s.w=b.dataset.all==="1"?Array.from({length:s.eps||0},(_,k)=>k+1):[])));
  body.querySelectorAll("[data-eps]").forEach(el=>{el.onblur=()=>{const i=+el.dataset.eps,v=Math.max(0,Math.min(99,parseInt(el.value)||0));setSeasons(id,ss=>{ss[i].eps=v;ss[i].w=ss[i].w.filter(x=>x<=v)});setTimeout(renderDetail,0)};el.onkeydown=e=>{if(e.key==="Enter")el.blur()}});
  body.querySelectorAll("[data-rmseason]").forEach(b=>b.onclick=()=>setSeasons(id,ss=>{ss.splice(+b.dataset.rmseason,1)}));
  const as=$("#addSeason"); if(as) as.onclick=()=>setSeasons(id,ss=>{const n=ss.length?Math.max(...ss.map(s=>s.n))+1:1;ss.push({n,eps:ss.length?ss[ss.length-1].eps||10:10,w:[]});openSeasons[id+"_"+(ss.length-1)]=true});
  const rf=$("#refresh"); if(rf) rf.onclick=()=>refreshItem(id,true);
  const d=$("#del"); if(d) d.onclick=()=>{confirmDel=true;renderDetail()};
  const nd=$("#noDel"); if(nd) nd.onclick=()=>{confirmDel=false;renderDetail()};
  const yd=$("#yesDel"); if(yd) yd.onclick=async()=>{yd.disabled=true;try{await deleteItem(id);closeSheet();render();toast("Supprimé")}catch(e){yd.disabled=false;toast("Suppression impossible.")}};
}

/* ---- settings ---- */
function openSettings(){
  mode="settings"; openId=null; setBackdrop(null);
  $("#sheetBody").innerHTML=`<h2>Réglages</h2>
  <label class="f">Jeton TMDB (lecture)</label>
  <input class="in" id="stTmdb" value="${esc(prefs.tmdb)}" placeholder="eyJhbGciOi…" autocomplete="off" autocapitalize="off" spellcheck="false">
  <div class="rnote">themoviedb.org → Paramètres → API → « Jeton d'accès en lecture à l'API ».</div>
  <label class="f">Clé OMDb (facultatif)</label>
  <input class="in" id="stOmdb" value="${esc(prefs.omdb)}" placeholder="pour Rotten Tomatoes et IMDb" autocomplete="off" autocapitalize="off" spellcheck="false">
  <div class="rnote">Gratuite sur omdbapi.com (« API Key »). Remplit automatiquement Rotten Tomatoes et IMDb.</div>
  <div style="height:14px"></div><button class="btn" id="stSave">Enregistrer</button>
  ${items.some(i=>i.tmdbId)?`<div style="height:10px"></div><button class="btn sec" id="stRefresh">Actualiser toutes les fiches</button>`:""}
  <label class="f">Compte</label>
  <div class="mini">Connecté : ${esc(user?.email||"")}</div>
  <div style="height:10px"></div><button class="btn sec" id="stOut">Se déconnecter</button>
  <div class="tmdb"><svg width="34" height="14" viewBox="0 0 34 14"><rect width="34" height="14" rx="3" fill="#0D253F"/><text x="17" y="10.5" text-anchor="middle" font-size="9" font-weight="700" fill="#01B4E4" font-family="Arial">TMDB</text></svg>Cette appli utilise l'API TMDB mais n'est ni approuvée ni certifiée par TMDB. Disponibilités : JustWatch.</div>`;
  $("#stSave").onclick=async()=>{prefs.tmdb=$("#stTmdb").value.trim();prefs.omdb=$("#stOmdb").value.trim();
    try{if(prefs.tmdb)await tm("/configuration",{});}catch(e){toast(tmErr(e));return}
    await savePrefs();toast("Réglages enregistrés");closeSheet()};
  const sr=$("#stRefresh"); if(sr) sr.onclick=async()=>{sr.disabled=true;const ids=items.filter(i=>i.tmdbId).map(i=>i.id);let k=0;for(const id of ids){sr.textContent=`Actualisation… ${++k}/${ids.length}`;await refreshItem(id,false)}sr.textContent="Fiches à jour ✓"};
  $("#stOut").onclick=async()=>{await sb.auth.signOut();LS.set("cache_items",null);location.reload()};
  openSheet();
}

/* ================= gate (setup + login) ================= */
function showGate(html){$("#gate").classList.remove("hidden");$("#gateBox").innerHTML=html}
function hideGate(){$("#gate").classList.add("hidden")}
function gateSetup(){
  showGate(`<div class="kicker">Configuration</div><h1>Films <span style="color:var(--gold);font-style:italic">&amp;</span> séries</h1>
  <p>Colle les deux valeurs de ton projet Supabase (Project Settings → API).</p>
  <label>Project URL</label><input class="in" id="gUrl" placeholder="https://xxxx.supabase.co" autocapitalize="off" spellcheck="false">
  <label>Clé publique (anon / publishable)</label><input class="in" id="gKey" placeholder="eyJ… ou sb_publishable_…" autocapitalize="off" spellcheck="false">
  <div class="err" id="gErr"></div><button class="btn" id="gGo">Continuer</button>`);
  $("#gGo").onclick=()=>{const u=normUrl($("#gUrl").value),k=$("#gKey").value.trim();if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(u)){$("#gErr").textContent="L'URL doit ressembler à https://xxxx.supabase.co";return}if(k.length<20||/service_role|sb_secret/.test(k)){$("#gErr").textContent="Colle la clé publique (anon ou publishable).";return}SB_URL=u;SB_KEY=k;LS.set("sb_url",u);LS.set("sb_key",k);location.reload()};
}
function gateLogin(){
  const last=LS.get("last_email")||"";
  showGate(`<div class="kicker">Ma watchlist</div><h1>Films <span style="color:var(--gold);font-style:italic">&amp;</span> séries</h1>
  <p>Connecte-toi avec ton e-mail : tu reçois un lien de connexion. Une seule fois par appareil.</p>
  <label>E-mail</label><input class="in" id="gMail" type="email" value="${esc(last)}" placeholder="toi@exemple.fr" autocomplete="email">
  <div class="err" id="gErr"></div><button class="btn" id="gSend">Recevoir le lien</button>${CFG.supabaseUrl?"":`<button class="lnk" id="gReset">Modifier l'URL / la clé Supabase</button>`}`);
  const gr=$("#gReset"); if(gr) gr.onclick=()=>{LS.set("sb_url",null);LS.set("sb_key",null);location.reload()};
  $("#gSend").onclick=async()=>{const em=$("#gMail").value.trim();if(!/.+@.+\..+/.test(em)){$("#gErr").textContent="E-mail invalide.";return}
    $("#gSend").disabled=true;LS.set("last_email",em);
    const {error}=await sb.auth.signInWithOtp({email:em,options:{emailRedirectTo:location.origin+location.pathname}});
    if(error){$("#gSend").disabled=false;$("#gErr").textContent=/JSON|fetch|Failed/i.test(error.message)?"Supabase ne répond pas à cette adresse : vérifie l'URL du projet (lien ci-dessous).":/rate|limit/i.test(error.message)?"Trop d'e-mails envoyés : réessaie dans quelques minutes.":error.message;return}
    gateCode(em)};
}
function gateCode(em){
  showGate(`<div class="kicker">Vérification</div><h1>Regarde tes e-mails</h1>
  <p>Envoyé à <b>${esc(em)}</b>. Ouvre l'e-mail sur cet appareil et touche « Sign in » : l'appli s'ouvre connectée. L'e-mail peut mettre une minute à arriver (pense aux spams).</p>
  <label>Code (seulement si ton e-mail en contient un)</label><input class="in code" id="gCode" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="••••••">
  <div class="err" id="gErr"></div><button class="btn" id="gOk">Valider</button><button class="lnk" id="gBack">Changer d'e-mail</button>`);
  $("#gBack").onclick=gateLogin;
  $("#gOk").onclick=async()=>{const c=$("#gCode").value.replace(/\D/g,"");if(c.length<6){$("#gErr").textContent="Code à 6 chiffres.";return}
    $("#gOk").disabled=true;const {error}=await sb.auth.verifyOtp({email:em,token:c,type:"email"});
    if(error){$("#gOk").disabled=false;$("#gErr").textContent="Code invalide ou expiré."}};
}
function gateToken(){
  showGate(`<div class="kicker">Dernière étape</div><h1>Clé TMDB</h1>
  <p>Colle ton « Jeton d'accès en lecture à l'API » (themoviedb.org → Paramètres → API). Il est enregistré sur ton compte : tu ne le saisis qu'une fois.</p>
  <label>Jeton TMDB</label><input class="in" id="gTok" placeholder="eyJhbGciOi…" autocapitalize="off" spellcheck="false" autocomplete="off">
  <div class="err" id="gErr"></div><button class="btn" id="gOk">Valider</button><button class="lnk" id="gSkip">Plus tard</button>`);
  $("#gSkip").onclick=hideGate;
  $("#gOk").onclick=async()=>{prefs.tmdb=$("#gTok").value.trim();$("#gOk").disabled=true;
    try{await tm("/configuration",{});await savePrefs();hideGate();toast("C'est prêt !")}catch(e){$("#gOk").disabled=false;$("#gErr").textContent=tmErr(e)}};
}

/* ================= events & boot ================= */
function syncTabs(){document.querySelectorAll("#tabs button").forEach(b=>b.classList.toggle("on",b.dataset.t===tab))}
$("#tabs").onclick=e=>{const b=e.target.closest("button");if(!b)return;tab=b.dataset.t;plat="";filter=tab==="serie"&&items.some(i=>i.type==="serie"&&statusOf(i)==="encours")?"encours":"avoir";syncTabs();render()};
$("#filters").onclick=e=>{const b=e.target.closest("button");if(b){filter=b.dataset.f;render()}};
$("#plats").onclick=e=>{const b=e.target.closest("button");if(b){plat=b.dataset.p;render()}};
$("#grid").onclick=e=>{const c=e.target.closest(".card");if(c)openDetail(c.dataset.id)};
$("#rail").onclick=e=>{const g=e.target.closest("[data-next]");
  if(g){const id=g.dataset.next,it=getItem(id),nx=it&&nextEp(it);if(nx){setSeasons(id,ss=>{const s=ss.find(x=>x.n===nx.n);s.w=[...s.w,nx.e].sort((a,b)=>a-b)});toast(`${it.title} · S${nx.n}É${nx.e} vu ✓`)}return}
  const c=e.target.closest(".rc");if(c)openDetail(c.dataset.id)};
$("#q").oninput=e=>{query=e.target.value;render()};
$("#fab").onclick=openAdd; $("#gear").onclick=openSettings;

async function onSignedIn(u){
  user=u; hideGate();
  try{await loadPrefs()}catch(e){}
  try{await loadAll()}catch(e){$("#banner").textContent="Impossible de charger ta liste : "+(e.message||"erreur");$("#banner").classList.remove("hidden");loaded=true;render()}
  if(!prefs.tmdb) gateToken();
  else { // refresh stale ongoing series quietly
    const stale=items.filter(i=>i.tmdbId&&i.type==="serie"&&statusOf(i)!=="vu"&&(!i.providersDate||Date.now()-i.providersDate>7*864e5)).slice(0,6);
    for(const it of stale) await refreshItem(it.id,false);
  }
}
(async function boot(){
  try{const c=JSON.parse(LS.get("cache_items")||"null");if(Array.isArray(c)){items=c;loaded=true}}catch(e){}
  render();
  if(!initSb()){ if(!window.supabase) {$("#banner").textContent="Chargement impossible : vérifie ta connexion.";$("#banner").classList.remove("hidden")} else gateSetup(); return }
  let started=false;
  sb.auth.onAuthStateChange((ev,session)=>{
    if(session?.user&&(!user||user.id!==session.user.id)){started=true;onSignedIn(session.user)}
    if(ev==="SIGNED_OUT"){user=null;gateLogin()}
  });
  const {data}=await sb.auth.getSession();
  if(data.session?.user){ if(!started){started=true;onSignedIn(data.session.user)} }
  else gateLogin();
})();
