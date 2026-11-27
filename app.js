/* Mes films & séries — TMDB + Supabase — version 5 */
"use strict";
const PLATFORMS=["Netflix","Prime Video","Disney+","Canal+","Apple TV+","HBO Max","Paramount+","France.tv","Arte","TF1+","M6+","Au cinéma","Location / achat","Pas dispo en streaming","Autre"];
const PICK=["Netflix","Prime Video","Disney+","Canal+","Apple TV+","HBO Max","Paramount+","France.tv","Arte","TF1+","M6+","Au cinéma","Autre"];
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
let tab="serie", filter="encours", query="", plat="", dashType="serie";
let openId=null, mode=null, confirmDel=false;
const timers={}, chains={}, dirty=new Set(), openSeasons={}, refreshing=new Set();

function setKeyed(el,entries){
  const old=new Map();[...el.children].forEach(n=>{if(n.dataset&&n.dataset.key)old.set(n.dataset.key,n)});
  entries.forEach(({key,html},i)=>{
    let n=old.get(key);
    if(!n||n._h!==html){const t=document.createElement("template");t.innerHTML=html.trim();n=t.content.firstElementChild;n.dataset.key=key;n._h=html}
    else old.delete(key);
    const cur=el.children[i]; if(cur!==n) el.insertBefore(n,cur||null);
  });
  while(el.children.length>entries.length) el.lastElementChild.remove();
}
function setHTML(el,html){if(el._h!==html){el.innerHTML=html;el._h=html;return true}return false}
const SPLASH_MIN=2000;
function hideSplash(){const sp=document.getElementById("splash");if(!sp||sp._closing)return;sp._closing=true;const wait=Math.max(0,SPLASH_MIN-performance.now());setTimeout(()=>{sp.classList.add("hide");setTimeout(()=>sp.remove(),600)},wait)}
setTimeout(hideSplash,4500);
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
function cleanTok(t){t=String(t||"").replace(/[\s"'«»“”‘’`<>]/g,"");if(/^eyj/i.test(t))t="eyJ"+t.slice(3);return t}
async function tm(path,params={}){
  const t=cleanTok(prefs.tmdb); if(!t) throw {code:"notoken"};
  const q=new URLSearchParams({language:"fr-FR",...params});
  const h={accept:"application/json"};
  if(t.startsWith("eyJ")) h.Authorization="Bearer "+t; else q.set("api_key",t);
  if(t.startsWith("eyJ")&&t.split(".").length!==3) throw {code:"badtoken"};
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
    let d; try{ d=await tm(`/movie/${tmdbId}`,{append_to_response:"credits,release_dates,keywords"}); }catch(e){ if(e?.code!=="http") throw e; d=await tm(`/movie/${tmdbId}`); }
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
      runtime:d.runtime||null,
      theatrical:!(d.genres||[]).some(g=>g.id===10770)&&(d.release_dates?.results||[]).some(r=>(r.release_dates||[]).some(x=>x.type===3||(x.type===2&&r.iso_3166_1==="FR"))),
      keywords:(d.keywords?.keywords||[]).map(k=>k.name).slice(0,20),tmdbVote:d.vote_count>20?Math.round(d.vote_average*10)/10:null,imdbId:d.imdb_id||null,
      providers:pv.list,providersLink:pv.link,autoPlatform:platform,providersDate:Date.now()};
  } else {
    let d; try{ d=await tm(`/tv/${tmdbId}`,{append_to_response:"external_ids,keywords"}); }catch(e){ if(e?.code!=="http") throw e; d=await tm(`/tv/${tmdbId}`); }
    const pv=mapProviders(await tm(`/tv/${tmdbId}/watch/providers`,{}).catch(()=>null));
    return {type:"serie",mediaType:"tv",tmdbId,title:d.name,originalTitle:d.original_name,year:d.first_air_date?+d.first_air_date.slice(0,4):null,
      poster:d.poster_path,backdrop:d.backdrop_path,genres:(d.genres||[]).map(g=>g.name).slice(0,3),synopsis:d.overview||"",
      director:(d.created_by||[]).map(c=>c.name).slice(0,2).join(", "),
      keywords:(d.keywords?.results||[]).map(k=>k.name).slice(0,20),
      tmdbVote:d.vote_count>20?Math.round(d.vote_average*10)/10:null,imdbId:d.external_ids?.imdb_id||null,
      epV:2,
      tmdbSeasons:(()=>{const today=new Date().toISOString().slice(0,10), nx=d.next_episode_to_air, la=d.last_episode_to_air;
        if(la&&la.season_number>0&&la.air_date&&la.air_date<=today){
          return (d.seasons||[]).filter(s=>s.season_number>0&&s.episode_count>0&&s.season_number<=la.season_number)
            .map(s=>({n:s.season_number,eps:s.season_number===la.season_number?Math.min(s.episode_count,la.episode_number):s.episode_count}));
        }
        return (d.seasons||[]).filter(s=>s.season_number>0&&s.episode_count>0&&(s.air_date?s.air_date<=today:!d.in_production))
          .map(s=>({n:s.season_number,eps:nx&&nx.season_number===s.season_number&&nx.episode_number>1?Math.min(s.episode_count,nx.episode_number-1):s.episode_count}))
          .filter(s=>!(nx&&nx.season_number===s.n&&nx.episode_number===1));})(),
      ongoing:d.in_production??(d.status==="Returning Series"),
      epRuntime:(d.episode_run_time||[]).find(x=>x>0)||d.last_episode_to_air?.runtime||d.next_episode_to_air?.runtime||null,
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
    if(d.tmdbSeasons){const before=seriesStats(it);f.seasons=mergeSeasons(it.seasons,d.tmdbSeasons);
      const after=seriesStats({seasons:f.seasons});
      if(before.tot>0&&before.seen>=before.tot&&after.tot>before.tot){f.newEpAt=Date.now();toast(`Nouvel épisode de ${it.title} !`)}
      const oldMax=Math.max(0,...(it.seasons||[]).map(x=>x.n)), newMax=Math.max(0,...d.tmdbSeasons.map(x=>x.n));
      if(it.seasons?.length&&newMax>oldMax) toast(`Nouvelle saison de ${it.title} disponible !`);}
    delete f.tmdbSeasons;
    if(it.titleManual) delete f.title;
    patch(id,f,0);
    if(manual) toast("Fiche à jour");
  }catch(e){ if(manual) toast(tmErr(e)); }
  finally{refreshing.delete(id); render()}
}
function tmErr(e){return e?.code==="notoken"?"Ajoute ta clé TMDB dans les réglages.":e?.code==="badtoken"?`Clé TMDB refusée : elle semble incomplète (${cleanTok(prefs.tmdb).length} caractères au lieu de 239 environ). Recopie-la en entier.`:(e?.status?`TMDB a refusé la demande (erreur ${e.status}).`:"TMDB ne répond pas : "+(e?.message||"réseau"))}

/* ================= helpers ================= */
function seriesStats(it){let tot=0,seen=0;(it.seasons||[]).forEach(s=>{tot+=s.eps||0;seen+=Math.min((s.w||[]).length,s.eps||0)});return {tot,seen,pct:tot?seen/tot:0}}
function statusOf(it){
  if(it.type==="film") return it.status==="vu"?"vu":"avoir";
  if(it.sState==="pause") return "pause";
  if(it.sState==="arrete") return "arrete";
  const {tot,seen}=seriesStats(it);
  if(!tot||!seen) return "avoir";
  if(seen<tot) return "encours";
  return it.ongoing===true||(it.nextAir&&it.nextAir.date>=new Date().toISOString().slice(0,10))?"ajour":"vu";
}
function platformOf(it){if(it.platform!==undefined)return it.platform||"";return it.platformManual||(["Location / achat","Pas dispo en streaming"].includes(it.autoPlatform)?"":it.autoPlatform)||""}
function isNewEp(it){return !!it.newEpAt&&statusOf(it)==="encours"&&Date.now()-it.newEpAt<60*864e5}
function ongKey(it){return isNewEp(it)?1e14+it.newEpAt:(it.updatedAt||it.createdAt||0)}
function nextEp(it){for(const s of (it.seasons||[])){const w=new Set(s.w||[]);for(let e=1;e<=(s.eps||0);e++)if(!w.has(e))return {n:s.n,e}}return null}
function hashCol(s){let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))>>>0;const hues=[352,20,200,160,260,30,330,210];const hu=hues[h%hues.length];return `linear-gradient(160deg,hsl(${hu} 45% 38%),hsl(${(hu+30)%360} 50% 18%))`}
function posterHTML(it,size="w342"){
  return it.poster?`<img src="${IMG}${size}${esc(it.poster)}" alt="" loading="lazy">`:`<div class="ph" style="background:${hashCol(it.title)}"><small>${it.type==="serie"?"Série":"Film"}${it.year?" · "+it.year:""}</small>${esc(it.title)}</div>`;
}
function dateFr(d){try{return new Date(d).toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}catch(e){return d}}
const FILTERS={film:[["avoir","À voir"],["vu","Vus"],["tous","Tous"]],serie:[["encours","En cours"],["ajour","À jour"],["avoir","À voir"],["pause","En pause"],["arrete","Arrêtées"],["vu","Terminées"],["tous","Toutes"]]};
const STLABEL={avoir:"À voir",encours:"En cours",ajour:"À jour",pause:"En pause",arrete:"Arrêtée",vu:"Terminée"};
const CHECK=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

/* ================= list ================= */
function ratesHTML(it){
  const parts=[];
  if(it.tmdbVote!=null) parts.push(`<span><i class="dotT"></i>${fmt(it.tmdbVote)}</span>`);
  const r=it.rtCritics??it.rtCriticsAuto; if(r!=null) parts.push(`<span><i class="dotR"></i>${Math.round(r)}%</span>`);
  else if(it.imdbRating!=null) parts.push(`<span><i class="dotI"></i>${fmt(it.imdbRating)}</span>`);
  return parts.length?`<div class="rates">${parts.slice(0,2).join("")}</div>`:"";
}
function epMin(it){return it.epRuntime||45}
function hm(min){min=Math.round(min);const h=Math.floor(min/60),m=min%60;if(h>=100)return `${h} h`;return h?`${h} h${m?String(m).padStart(2,"0"):""}`:`${m} min`}
function seriesTime(it){const s=seriesStats(it);return {seen:s.seen*epMin(it),left:(s.tot-s.seen)*epMin(it)}}
/* ---- recommandation ---- */
let RECO=new Map(), RECOINFO={};
function norm(x){return String(x||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").trim()}
function feats(it){return {g:new Set((it.genres||[]).map(norm)),k:new Set((it.keywords||[]).map(norm)),p:new Set(String(it.director||"").split(",").map(norm).filter(Boolean))}}
function jac(a,b){if(!a.size||!b.size)return 0;let n=0;a.forEach(x=>{if(b.has(x))n++});return n/(a.size+b.size-n)}
function simil(fa,fb){let p=0;fa.p.forEach(x=>{if(fb.p.has(x))p=1});return .35*jac(fa.g,fb.g)+.5*jac(fa.k,fb.k)+.15*p}
let RATED={};
function predictFor(c,type){
  const R=RATED[type]; if(!R) return null;
  const fc=feats(c); let num=0,den=0; const nb=[];
  R.rated.forEach(x=>{const sm=simil(fc,x.f);if(sm>0){num+=sm*(x.r-R.mean);den+=sm;nb.push({t:x.it.title,r:x.r,sm})}});
  const k=den/(den+.6), personal=Math.max(.5,Math.min(5,R.mean+(den?num/den:0)*k));
  const pubSrc=c.imdbRating!=null?"IMDb":c.tmdbVote!=null?"TMDB":null, pub=c.imdbRating??c.tmdbVote;
  let score=pub!=null?.65*personal+.35*(pub/2):personal;
  score=Math.max(.5,Math.min(5,Math.round(score*10)/10));
  nb.sort((a,b)=>b.sm-a.sm);
  return {score,personal,mean:R.mean,pub,pubSrc,near:nb.filter(n=>n.sm>=.08).slice(0,4),weak:den<.3};
}
function computeReco(){
  RECO=new Map(); RECOINFO={}; RATED={};
  for(const type of ["film","serie"]){
    const rated=items.filter(i=>i.type===type&&(i.myRating!=null||(i.sState==="arrete"))).map(i=>({it:i,r:i.myRating??2,f:feats(i)}));
    RECOINFO[type]=rated.length;
    if(rated.length<2) continue;
    RATED[type]={rated,mean:rated.reduce((a,x)=>a+x.r,0)/rated.length};
    items.filter(i=>i.type===type&&statusOf(i)==="avoir"&&i.myRating==null).forEach(c=>RECO.set(c.id,predictFor(c,type)));
  }
}
function recoBlock(it,given){
  if(!given&&(statusOf(it)!=="avoir"||it.myRating!=null)) return "";
  const r=given||RECO.get(it.id), word=it.type==="film"?"films":"séries";
  if(!r) return (RECOINFO[it.type]||0)<2?`<div class="reco off">Note au moins 2 ${word} vu${it.type==="film"?"s":"es"} pour obtenir une recommandation personnalisée.</div>`:"";
  const pct=x=>Math.round(x*100)+" %";
  const near=r.near.length?`<div class="rn">${r.near.map(n=>`<div class="rnl"><span class="rnt">${esc(n.t)}</span><span class="rnr ${n.r>=r.mean?"up":"down"}">${fmt(n.r)}★</span><span class="rnb"><i style="width:${Math.min(100,n.sm*160)}%"></i></span><span class="rnp">${pct(n.sm)}</span></div>`).join("")}</div>`:"";
  return `<div class="reco"><div class="rtop"><div class="rs"><small>Pour toi</small><b>${fmt(r.score)}</b><span>/5</span></div>
    <div class="rcalc">
      <div><span>Ton goût</span><b>${fmt(r.personal)}</b><em>× 65 %</em></div>
      ${r.pub!=null?`<div><span>Public (${r.pubSrc} ${fmt(r.pub)}/10)</span><b>${fmt(r.pub/2)}</b><em>× 35 %</em></div>`:`<div><span>Pas de note du public</span><b>–</b><em></em></div>`}
    </div></div>
    <div class="rw">${r.near.length?`<b>Ton goût</b> part de ta moyenne (${fmt(r.mean)}★) et s'ajuste selon tes ${word} les plus ressemblantes (genres, thèmes, créateurs) :`:`<b>Ton goût</b> = ta moyenne (${fmt(r.mean)}★) : aucune de tes ${word} notées ne ressemble vraiment à celle-ci.`}</div>
    ${near}
    ${r.weak&&r.near.length?`<div class="rw dim">Ressemblances faibles : estimation peu fiable, proche de ta moyenne.</div>`:""}
  </div>`;
}
/* ---- suggestions ---- */
let SUG=(()=>{try{return JSON.parse(LS.get("sugg_v3")||"{}")}catch(e){return {}}})();
const sugBusy={}, sugProg={};
function sugDismissed(){try{return new Set(JSON.parse(LS.get("sugg_dismissed")||"[]"))}catch(e){return new Set()}}
function saveSug(){LS.set("sugg_v3",JSON.stringify(SUG));LS.set("sugg_v2",null);LS.set("sugg_v1",null)}
function ratingsHash(type){return items.filter(i=>i.type===type&&i.myRating!=null).map(i=>i.tmdbId+":"+i.myRating).sort().join(",")}
async function pool(arr,n,fn){let i=0;const run=async()=>{while(i<arr.length){const k=i++;await fn(arr[k],k)}};await Promise.all(Array.from({length:Math.min(n,arr.length)},run))}
const SUGRULE={film:{minYear:1990,minVotes:1500},serie:{minYear:2000,minVotes:400}};
async function buildSug(type){
  if(sugBusy[type]) return; computeReco();
  const mt=type==="film"?"movie":"tv";
  const rated=items.filter(i=>i.type===type&&i.myRating!=null&&i.tmdbId).sort((a,b)=>b.myRating-a.myRating);
  if(rated.length<2||!RATED[type]){SUG[type]={date:Date.now(),hash:ratingsHash(type),list:[],need:true};saveSug();render();return}
  const mean=RATED[type].mean;
  let seeds=rated.filter(i=>i.myRating>=Math.max(4,mean)).slice(0,10); if(seeds.length<2) seeds=rated.slice(0,5);
  sugBusy[type]=true; sugProg[type]="Je regarde ce qu'aiment les fans de tes coups de cœur…"; render();
  try{
    const own=new Set(items.filter(i=>i.type===type&&i.tmdbId).map(i=>i.tmdbId)), dis=sugDismissed(), cand=new Map();
    await pool(seeds,4,async sd=>{
      for(const page of [1,2]){
        let d; try{d=await tm(`/${mt}/${sd.tmdbId}/recommendations`,{page:String(page)})}catch(e){return}
        (d.results||[]).forEach((r,pos)=>{
          if(own.has(r.id)||dis.has(type+":"+r.id)||r.adult||(r.genre_ids||[]).includes(10770)) return;
          const yr=+String(r.release_date||r.first_air_date||"").slice(0,4);
          if(!yr||yr<SUGRULE[type].minYear||(r.vote_count||0)<SUGRULE[type].minVotes) return;
          const c=cand.get(r.id)||{id:r.id,w:0,seeds:[],vote:r.vote_average||0,cnt:r.vote_count||0,g:r.genre_ids||[]};
          c.w+=(sd.myRating-2.5)*(1-pos/40); c.seeds.push({t:sd.title,r:sd.myRating}); cand.set(r.id,c);
        });
      }
    });
    // complément : titres populaires et bien notés dans tes genres favoris, dispo en streaming en France
    const gw={}; [...cand.values()].forEach(c=>c.g.forEach(g=>gw[g]=(gw[g]||0)+c.w));
    const topG=Object.entries(gw).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]);
    sugProg[type]="Je cherche aussi parmi les titres populaires de tes genres préférés…"; if(tab==="sugg") renderSugg();
    for(const g of topG){
      const dateKey=type==="film"?"primary_release_date.gte":"first_air_date.gte";
      let d; try{d=await tm(`/discover/${mt}`,{with_genres:g,sort_by:"vote_average.desc","vote_count.gte":String(SUGRULE[type].minVotes*2),[dateKey]:SUGRULE[type].minYear+"-01-01",watch_region:"FR",with_watch_monetization_types:"flatrate",page:"1"})}catch(e){continue}
      (d.results||[]).forEach((r,pos)=>{
        if(own.has(r.id)||dis.has(type+":"+r.id)||(r.genre_ids||[]).includes(10770)) return;
        const c=cand.get(r.id)||{id:r.id,w:0,seeds:[],vote:r.vote_average||0,cnt:r.vote_count||0,g:r.genre_ids||[]};
        c.w+=0.6*(1-pos/30); cand.set(r.id,c);
      });
    }
    const pop=c=>Math.log10(Math.max(10,c.cnt));
    const pre=[...cand.values()].sort((a,b)=>(b.w+b.vote/4+pop(b)*.4)-(a.w+a.vote/4+pop(a)*.4)).slice(0,type==="film"?40:32);
    let done=0; const out=[];
    await pool(pre,4,async c=>{
      try{
        const d=await fetchDetails(mt,c.id);
        if(PICK.includes(d.autoPlatform)&&d.autoPlatform!=="Au cinéma"&&d.poster&&(type!=="film"||d.theatrical)){
          const r=predictFor(d,type);
          if(r){const seen=new Set();const because=c.seeds.sort((a,b)=>b.r-a.r).filter(x=>!seen.has(x.t)&&seen.add(x.t)).slice(0,2);
            out.push({...d,_r:r,_because:because,_rank:r.score+Math.min(3,c.seeds.length)*.12+(pop(c)-3)*.1})}
        }
      }catch(e){}
      sugProg[type]=`J'analyse les candidats… ${++done}/${pre.length}`; if(tab==="sugg") renderSugg();
    });
    out.sort((a,b)=>b._rank-a._rank);
    SUG[type]={date:Date.now(),hash:ratingsHash(type),list:out.slice(0,16)}; saveSug();
  }catch(e){toast(tmErr(e))}
  finally{sugBusy[type]=false; sugProg[type]=""; render()}
}
function sugStale(type){const S=SUG[type];return !S||Date.now()-S.date>3*864e5||S.hash!==ratingsHash(type)}
function renderSugg(){
  const sec=(type)=>{
    const S=SUG[type], word=type==="film"?"films":"séries", busy=sugBusy[type];
    const own=new Set(items.filter(i=>i.type===type).map(i=>i.tmdbId)), dis=sugDismissed();
    const list=(S?.list||[]).filter(c=>!own.has(c.tmdbId)&&!dis.has(type+":"+c.tmdbId)).slice(0,10);
    let body;
    if(busy) body=`<div class="sugwait"><span class="sp2"></span>${esc(sugProg[type]||"Recherche…")}</div>`;
    else if(S?.need) body=`<div class="reco off">Note au moins 2 ${word} pour recevoir des suggestions.</div>`;
    else if(!list.length) body=`<div class="reco off">${S?"Plus de suggestions pour l'instant : touche Actualiser.":"Prépare-toi…"}</div>`;
    else body=`<div class="grid sgrid">${list.map(c=>`<button class="card" data-sg="${type}:${c.tmdbId}"><div class="poster">${posterHTML(c)}<span class="badge" style="background:${PCOL[c.autoPlatform]||"rgba(20,18,16,.7)"}">${esc(c.autoPlatform)}</span><span class="rec">Pour toi ${fmt(c._r.score)}★</span></div><div class="meta"><div class="t">${esc(c.title)}</div><div class="y">${[c.year,c.genres?.[0]?esc(c.genres[0]):""].filter(Boolean).join(" · ")}</div>${c._because?.length?`<div class="why">Car tu as aimé ${c._because.map(b=>esc(b.t)).join(" et ")}</div>`:""}</div></button>`).join("")}</div>`;
    return `<div class="sugsec"><div class="sugh"><b>${type==="serie"?"Séries":"Films"} pour toi</b>${!busy&&S&&!S.need?`<button class="lnk2" data-sgr="${type}">Actualiser</button>`:""}</div>${body}</div>`;
  };
  setHTML($("#sugg"),`<div class="rnote" style="margin:0 0 6px">Titres populaires disponibles en streaming en France (films sortis au cinéma depuis 1990, séries depuis 2000), choisis à partir de tes meilleures notes. Touche une affiche pour l'ajouter ou l'écarter.</div>${sec("serie")}${sec("film")}`);
}
function findSug(key){const [type,id]=key.split(":");return (SUG[type]?.list||[]).find(c=>String(c.tmdbId)===id)}
function openSugg(key){
  const c=findSug(key); if(!c) return;
  mode="sugg"; openId=null; $("#sheetBody")._h=null; $("#sheetBody").dataset.bd=""; setBackdrop(c);
  const isS=c.type==="serie";
  setHTML($("#sheetBody"),`<div class="hero"><div class="poster">${posterHTML(c)}</div><div class="info"><div class="tt">${esc(c.title)}</div>
    <div class="ot">${[c.originalTitle&&c.originalTitle!==c.title?esc(c.originalTitle):"",c.year,c.runtime?`${Math.floor(c.runtime/60)}h${String(c.runtime%60).padStart(2,"0")}`:"",isS&&c.tmdbSeasons?.length?`${c.tmdbSeasons.length} saison${c.tmdbSeasons.length>1?"s":""}`:""].filter(Boolean).join(" · ")}</div>
    ${c.director?`<div class="ot">${isS?"Créée par":"De"} ${esc(c.director)}</div>`:""}${c.genres?.length?`<div class="ot">${esc(c.genres.join(", "))}</div>`:""}
    <span class="status" style="background:${PCOL[c.autoPlatform]||"var(--card2)"};color:#fff">${esc(c.autoPlatform)}</span></div></div>
    ${c.synopsis?`<div class="syn">${esc(c.synopsis)}</div>`:""}
    ${c._because?.length?`<div class="why big">Suggéré car tu as aimé ${c._because.map(b=>`<b>${esc(b.t)}</b> (${fmt(b.r)}★)`).join(" et ")}.</div>`:""}
    ${recoBlock(c,c._r)}
    <div style="height:16px"></div>
    <div class="row"><button class="btn sec" id="sgNo">Pas pour moi</button><button class="btn red" id="sgAdd">+ Ajouter à ma liste</button></div>`);
  $("#sgNo").onclick=()=>{const d=sugDismissed();d.add(key);LS.set("sugg_dismissed",JSON.stringify([...d]));closeSheet();render();toast("Écarté")};
  $("#sgAdd").onclick=async()=>{const b=$("#sgAdd");b.disabled=true;try{
    const now=Date.now();const {_r,_because,_rank,tmdbSeasons,...d}=c;
    const data={...d,status:"avoir",createdAt:now,updatedAt:now,platform:PICK.includes(c.autoPlatform)?c.autoPlatform:""};
    if(tmdbSeasons) data.seasons=tmdbSeasons.map(x=>({...x,w:[]}));
    const it=await createItem(data); closeSheet(); render(); toast(`${it.title} ajouté à ta liste`);
  }catch(e){b.disabled=false;toast("Ajout impossible : "+(e.message||"erreur"))}};
  openSheet();
}
function renderStats(){
  const nF=items.filter(i=>i.type==="film"&&statusOf(i)==="avoir").length, nS=items.filter(i=>i.type==="serie"&&statusOf(i)==="encours").length, nV=items.filter(i=>statusOf(i)==="vu").length;
  $("#stats").innerHTML=loaded?`<div class="stat"><b>${nF}</b>film${nF>1?"s":""} à voir</div><div class="stat"><b>${nS}</b>série${nS>1?"s":""} en cours</div><div class="stat"><b>${nV}</b>vu${nV>1?"s":""}</div>`:`<div class="stat"><b>…</b>chargement</div>`;
}
const LEVELS=[5,4.5,4,3.5,3,2.5,2,1.5,1,.5];
function miniStars(v){let h="";for(let i=0;i<5;i++){const f=Math.max(0,Math.min(1,v-i));h+=`<i class="ms" style="--f:${f*100}%"></i>`}return `<span class="msw">${h}</span>`}
function renderDash(){
  const isF=dashType==="film";
  const all=items.filter(i=>i.type===dashType);
  const seen=all.filter(i=>isF?statusOf(i)==="vu":(seriesStats(i).seen>0||i.myRating!=null));
  const rated=all.filter(i=>i.myRating!=null);
  const avg=rated.length?rated.reduce((a,i)=>a+i.myRating,0)/rated.length:null;
  let k4;
  if(isF){const mins=seen.reduce((a,i)=>a+(i.runtime||0),0);k4=`<div class="kpi"><b>${Math.round(mins/60)}<small> h</small></b><span>de films</span></div>`}
  else{const ep=all.reduce((a,i)=>a+seriesStats(i).seen,0);const tSeen=all.reduce((a,i)=>a+seriesTime(i).seen,0);const tLeft=all.filter(i=>statusOf(i)==="encours").reduce((a,i)=>a+seriesTime(i).left,0);
    k4=`<div class="kpi"><b>${ep}</b><span>épisodes vus</span></div></div><div class="kpis k2"><div class="kpi wide"><b>${hm(tSeen)}</b><span>passées devant des séries${tSeen>=1440?` · soit ${fmt(tSeen/1440)} jours`:""}</span></div><div class="kpi wide"><b>${hm(tLeft)}</b><span>restantes sur tes séries en cours</span></div>`}
  const counts=LEVELS.map(l=>rated.filter(i=>i.myRating===l).length); const mx=Math.max(1,...counts);
  const groups=LEVELS.map(l=>({l,list:rated.filter(i=>i.myRating===l).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))})).filter(g=>g.list.length);
  const unrated=seen.filter(i=>i.myRating==null);
  const tile=it=>`<button class="dt" data-id="${it.id}"><div class="poster">${posterHTML(it,"w185")}</div><div class="dtt">${esc(it.title)}</div></button>`;
  const word=isF?"film":"série";
  setHTML($("#dash"),`
  <div class="seg dseg"><button data-d="film" class="${isF?"on":""}">Films</button><button data-d="serie" class="${!isF?"on":""}">Séries</button></div>
  <div class="kpis">
    <div class="kpi"><b>${seen.length}</b><span>${isF?"films vus":"séries commencées"}</span></div>
    <div class="kpi"><b>${rated.length}</b><span>noté${rated.length>1?"s":""}</span></div>
    <div class="kpi"><b>${avg==null?"–":fmt(avg)}<small> ★</small></b><span>note moyenne</span></div>
    ${k4}
  </div>
  ${rated.length?`<div class="dcard"><div class="dh">Répartition de mes notes</div>
    ${LEVELS.map((l,ix)=>`<div class="dist"><span class="dl">${fmt(l)}</span>${miniStars(l)}<div class="dbar"><i style="width:${counts[ix]/mx*100}%"></i></div><span class="dc">${counts[ix]||""}</span></div>`).join("")}</div>`:""}
  ${groups.map(g=>`<div class="dsec"><div class="dsh">${miniStars(g.l)}<b>${fmt(g.l)}</b><span>${g.list.length} ${word}${g.list.length>1?"s":""}</span></div><div class="hs"><div class="drow">${g.list.map(tile).join("")}</div><button class="ha l" aria-label="Précédent">‹</button><button class="ha r" aria-label="Suivant">›</button></div></div>`).join("")}
  ${unrated.length?`<div class="dsec"><div class="dsh"><b>À noter</b><span>${unrated.length} ${isF?"vu":"commencée"}${unrated.length>1?"s":""} sans note</span></div><div class="hs"><div class="drow">${unrated.map(tile).join("")}</div><button class="ha l" aria-label="Précédent">‹</button><button class="ha r" aria-label="Suivant">›</button></div></div>`:""}
  ${!rated.length&&!unrated.length?`<div class="empty"><b>Rien à classer pour l'instant</b>Marque des ${word}s comme vus et donne-leur des étoiles : ton classement apparaîtra ici.</div>`:""}`);
}
function railRates(it){
  const p=[];
  if(it.myRating!=null) p.push(`<span class="mine">★ ${fmt(it.myRating)}</span>`);
  if(it.tmdbVote!=null) p.push(`<span><i class="dotT"></i>${fmt(it.tmdbVote)}</span>`);
  const r=it.rtCritics??it.rtCriticsAuto;
  if(r!=null) p.push(`<span><i class="dotR"></i>${Math.round(r)}%</span>`); else if(it.imdbRating!=null) p.push(`<span><i class="dotI"></i>${fmt(it.imdbRating)}</span>`);
  return p.length?`<span class="rr">${p.join("")}</span>`:"";
}
function render(){ renderInner(); requestAnimationFrame(refreshArrows) }
function renderInner(){
  computeReco();
  const isDash=tab==="bilan", isSug=tab==="sugg";
  ["#filters","#plats","#grid"].forEach(sel=>$(sel).classList.toggle("hidden",isDash||isSug));
  $("#dash").classList.toggle("hidden",!isDash);
  $("#sugg").classList.toggle("hidden",!isSug);
  if(isSug){ ["#searchWrap","#empty","#resume"].forEach(x=>$(x).classList.add("hidden")); renderStats(); renderSugg();
    if(prefs.tmdb&&loaded&&user) ["serie","film"].forEach(t=>{if(sugStale(t)&&!sugBusy[t]) setTimeout(()=>buildSug(t),0)});
    return; }
  if(isDash){ $("#searchWrap").classList.add("hidden"); $("#empty").classList.add("hidden"); $("#resume").classList.add("hidden"); renderStats(); renderDash(); if(openId&&mode==="detail") renderDetail(); return; }
  const ofTab=items.filter(i=>i.type===tab);
  renderStats();
  const ong=items.filter(i=>i.type==="serie"&&statusOf(i)==="encours").sort((a,b)=>ongKey(b)-ongKey(a));
  $("#resume").classList.toggle("hidden",!ong.length||tab!=="serie");
  const railEl=$("#rail"), firstKey=ong[0]?.id||"";
  if(railEl._first!==firstKey){railEl._first=firstKey;requestAnimationFrame(()=>{railEl.scrollLeft=0;updArrows(railEl)})}
  setKeyed($("#rail"),ong.map(it=>{const s=seriesStats(it),nx=nextEp(it);return {key:it.id,html:`<div class="rc" data-id="${it.id}"><div class="poster">${posterHTML(it,"w154")}</div><div class="i">${isNewEp(it)?`<span class="newep">Nouvel épisode</span>`:""}<div class="t">${esc(it.title)}</div><div class="nx">${nx?`Prochain : <b>S${nx.n} · É${nx.e}</b>`:it.nextAir?`À jour · <b>S${it.nextAir.s}É${it.nextAir.e} le ${esc(dateFr(it.nextAir.date))}</b>`:""}${platformOf(it)?` · ${esc(platformOf(it))}`:""}</div><div class="prog"><i style="width:${Math.round(s.pct*100)}%"></i></div><div class="pl rl"><span>${s.seen}/${s.tot} ép.</span>${railRates(it)}</div>${nx?`<button class="go" data-next="${it.id}">✓ S${nx.n}É${nx.e} vu</button>`:""}</div></div>`}}));
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
  list.sort((a,b)=>{if(filter==="avoir"&&RECO.size){const d=(RECO.get(b.id)?.score||0)-(RECO.get(a.id)?.score||0);if(d)return d}
    if(tab==="serie"&&filter==="tous"){const o={encours:0,ajour:1,pause:2,avoir:3,arrete:4,vu:5};const d=o[statusOf(a)]-o[statusOf(b)];if(d)return d}return ongKey(b)-ongKey(a)});
  setKeyed($("#grid"),list.map(it=>{
    const st=statusOf(it), s=it.type==="serie"?seriesStats(it):null, p=platformOf(it);
    return {key:it.id,html:`<button class="card" data-id="${it.id}"><div class="poster">${posterHTML(it)}${p?`<span class="badge" style="background:${PCOL[p]||"rgba(20,18,16,.7)"}">${esc(p)}</span>`:""}${it.myRating!=null?`<span class="my">★ ${fmt(it.myRating)}</span>`:st==="avoir"&&RECO.get(it.id)?`<span class="rec">Pour toi ${fmt(RECO.get(it.id).score)}★</span>`:""}${st==="vu"?`<span class="seen">${CHECK}</span>`:st==="pause"?`<span class="seen st"><svg width="10" height="10" viewBox="0 0 10 10" style="vertical-align:-1px"><rect x="1.5" y="1" width="2.4" height="8" rx=".6" fill="currentColor"/><rect x="6.1" y="1" width="2.4" height="8" rx=".6" fill="currentColor"/></svg></span>`:st==="arrete"?`<span class="seen st">✕</span>`:""}</div>
      <div class="meta">${isNewEp(it)?`<span class="newep">Nouvel épisode</span>`:""}${st==="ajour"&&it.nextAir?`<span class="newep soon">S${it.nextAir.s}É${it.nextAir.e} le ${esc(dateFr(it.nextAir.date))}</span>`:""}<div class="t">${esc(it.title)}</div><div class="y">${[it.year,it.genres?.[0]?esc(it.genres[0]):"",it.type==="serie"&&it.seasons?.length?`${it.seasons.length} saison${it.seasons.length>1?"s":""}`:""].filter(Boolean).join(" · ")}</div>
      ${ratesHTML(it)}${s&&s.tot&&st!=="avoir"?`<div class="prog ${s.seen>=s.tot?"done":""}"><i style="width:${Math.round(s.pct*100)}%"></i></div><div class="pl">${s.seen}/${s.tot} épisodes</div>`:""}</div></button>`}}));
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
(()=>{const sh=$("#sheet");let y0=null,dy=0,drag=false;
  sh.addEventListener("touchstart",e=>{if(sh.scrollTop>2||e.touches.length>1){y0=null;return}y0=e.touches[0].clientY;dy=0;drag=false},{passive:true});
  sh.addEventListener("touchmove",e=>{if(y0==null)return;dy=e.touches[0].clientY-y0;if(dy>8&&sh.scrollTop<=0){drag=true;sh.style.transition="none";sh.style.transform=`translateY(${dy}px)`;if(e.cancelable)e.preventDefault()}},{passive:false});
  sh.addEventListener("touchend",()=>{if(y0==null)return;sh.style.transition="";sh.style.transform="";if(drag&&dy>110)closeSheet();y0=null;drag=false});
})();

/* ---- add (search) ---- */
let searchCtl=null, searchT=null;
function openAdd(){
  $("#sheetBody")._h=null; mode="add"; openId=null; setBackdrop(null);
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
    const data={...d,...om,status:"avoir",createdAt:now,updatedAt:now,platform:PICK.includes(d.autoPlatform)?d.autoPlatform:""};
    if(d.tmdbSeasons){data.seasons=d.tmdbSeasons.map(s=>({...s,w:[]}))} delete data.tmdbSeasons;
    const it=await createItem(data);
    tab=it.type; filter="avoir"; plat=""; syncTabs(); render();
    openDetail(it.id); toast(`${it.title} ajouté`);
  }catch(e){btn.disabled=false;btn.style.opacity=1;toast(["notoken","badtoken","http"].includes(e?.code)?tmErr(e):"Ajout impossible : "+(e?.message||"erreur"))}
}
async function addManual(title){
  const now=Date.now(), type=tab;
  try{const it=await createItem({type,title,status:"avoir",seasons:type==="serie"?[]:undefined,createdAt:now,updatedAt:now});openDetail(it.id)}
  catch(e){toast("Ajout impossible : "+(e.message||"erreur"))}
}

/* ---- detail ---- */
function openDetail(id){$("#sheetBody")._h=null;openId=id;mode="detail";confirmDel=false;$("#sheetBody").dataset.bd="";renderDetail();openSheet();
  const it=getItem(id); if(it&&it.tmdbId&&(!it.providersDate||Date.now()-it.providersDate>3*864e5)) refreshItem(id,false);
}
const STAR='<path d="M12 2.6l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" stroke-linejoin="round"/>';
function starsHTML(v){let h='<div class="stars">';for(let i=0;i<5;i++){const f=v==null?0:Math.max(0,Math.min(1,v-i));h+=`<button class="star" data-star="${i}" aria-label="${i+1} étoiles"><svg class="bg" viewBox="0 0 24 24" stroke-width="1">${STAR}</svg><svg class="fg" style="--f:${f*100}%" viewBox="0 0 24 24" fill="#F5B83D" stroke="#E0A42A" stroke-width="1">${STAR}</svg></button>`}return h+`<span class="val">${v==null?'<small>Touche pour noter</small>':fmt(v)+' <small>/5</small>'}</span></div>`}
function rbox(it,key,label,dot,unit,max,auto){const v=it[key]??(auto?it[auto]:null);return `<div class="rbox"><small><i class="${dot}"></i>${label}</small><div style="display:flex;align-items:baseline;gap:4px"><input inputmode="decimal" data-r="${key}" data-max="${max}" value="${v==null?"":String(v).replace(".",",")}" placeholder="–"><span class="u">${unit}</span></div></div>`}
function renderDetail(){
  const it=getItem(openId); if(!it){closeSheet();return}
  const body=$("#sheetBody"), a=document.activeElement;
  if(a&&body.contains(a)&&a.matches("input,textarea,select")) return;
  if(body.dataset.bd!==(it.backdrop||it.poster||"x")){body.dataset.bd=it.backdrop||it.poster||"x";setBackdrop(it)}
  const st=statusOf(it), isS=it.type==="serie", s=isS?seriesStats(it):null, p=platformOf(it);
  const qfr=encodeURIComponent(it.title), qo=encodeURIComponent(it.originalTitle||it.title);
  const busy=refreshing.has(it.id);
  const html=`
  <div class="hero"><div class="poster">${posterHTML(it)}</div><div class="info">
    <div class="tt">${esc(it.title)}</div>
    <div class="ot">${[it.originalTitle&&it.originalTitle!==it.title?esc(it.originalTitle):"",it.year,it.runtime?`${Math.floor(it.runtime/60)}h${String(it.runtime%60).padStart(2,"0")}`:""].filter(Boolean).join(" · ")}</div>
    ${it.director?`<div class="ot">${isS?"Créée par":"De"} ${esc(it.director)}</div>`:""}
    ${it.genres?.length?`<div class="ot">${esc(it.genres.join(", "))}</div>`:""}
    ${isS?`<span class="status ${st==="vu"?"ok":st==="pause"||st==="arrete"?"mute":""}">${STLABEL[st]}</span>`:`<button class="status ${st==="vu"?"ok":""}" id="togFilm">${st==="vu"?"✓ Vu":"À voir — marquer vu"}</button>`}
  </div></div>
  ${isS&&it.nextAir?`<span class="nextair">Prochain épisode S${it.nextAir.s}É${it.nextAir.e} le ${esc(dateFr(it.nextAir.date))}</span>`:""}
  ${it.synopsis?`<div class="syn">${esc(it.synopsis)}</div>`:""}
  ${isS?`<div class="sstate"><button data-sst="" class="${!it.sState?"on":""}">${st==="avoir"?"À voir":st==="vu"?"Terminée":st==="ajour"?"À jour":"Je regarde"}</button><button data-sst="pause" class="${it.sState==="pause"?"on":""}"><svg width="10" height="10" viewBox="0 0 10 10" style="vertical-align:-1px"><rect x="1.5" y="1" width="2.4" height="8" rx=".6" fill="currentColor"/><rect x="6.1" y="1" width="2.4" height="8" rx=".6" fill="currentColor"/></svg> En pause</button><button data-sst="arrete" class="${it.sState==="arrete"?"on":""}">✕ Arrêtée</button></div>`:""}
  ${recoBlock(it)}
  ${st!=="avoir"||it.myRating!=null?`<label class="f">Ma note</label>${starsHTML(it.myRating)}`:""}

  <label class="f">Plateforme</label>
  <div class="pchips">${PICK.map(x=>`<button class="pc ${p===x?"on":""}" data-plat="${esc(x)}" style="--pc:${PCOL[x]||"#1A1520"}">${esc(x)}</button>`).join("")}</div>

  ${(()=>{const rt=it.rtCritics??it.rtCriticsAuto;const cells=[];
    if(it.tmdbVote!=null)cells.push(`<div class="nb"><small><i class="dotT"></i>TMDB</small><b>${fmt(it.tmdbVote)}</b><span>/10</span></div>`);
    if(rt!=null)cells.push(`<div class="nb"><small><i class="dotR"></i>Rotten Tomatoes</small><b>${Math.round(rt)}</b><span>%</span></div>`);
    if(it.imdbRating!=null)cells.push(`<div class="nb"><small><i class="dotI"></i>IMDb</small><b>${fmt(it.imdbRating)}</b><span>/10</span></div>`);
    return cells.length?`<label class="f">Notes</label><div class="nrow">${cells.join("")}</div>${!prefs.omdb?`<div class="rnote">Ajoute une clé OMDb dans les réglages pour avoir Rotten Tomatoes et IMDb.</div>`:rt==null&&it.imdbId?`<div class="rnote">Pas de note Rotten Tomatoes disponible pour ce titre.</div>`:""}`:"";})()}

  ${isS?seasonsHTML(it,s):""}

  <label class="f">Mes notes</label>
  <textarea class="in" data-k="notes" rows="2" placeholder="Recommandé par…, à voir avec…">${esc(it.notes||"")}</textarea>
  ${it.tmdbId?"":`<label class="f">Titre</label><input class="in" data-k="title" value="${esc(it.title)}">`}
  <div style="height:14px"></div>
  ${it.tmdbId?`<button class="btn ghost" id="refresh" ${busy?"disabled":""}>${busy?"Mise à jour…":"Actualiser la fiche (notes, saisons)"}</button>`:""}
  <div style="height:8px"></div><button class="btn sec" id="swapType">${isS?"Mal classé ? C'est un film":"Mal classé ? C'est une série"}</button>
  <div id="swapBox"></div>
  ${confirmDel?`<div class="confirm">Supprimer « ${esc(it.title)} » ? <div class="row" style="margin-top:10px"><button class="btn sec" id="noDel">Annuler</button><button class="btn red" id="yesDel">Supprimer</button></div></div>`:`<button class="danger" id="del">Supprimer</button>`}`;
  setHTML(body,html);
  bindDetail(it);
}
function seasonsHTML(it,s){
  const ss=it.seasons||[];
  return `<label class="f">Progression</label>
  <div class="bigprog"><div class="l"><span>${s.seen} / ${s.tot} épisodes</span><span>${Math.round(s.pct*100)} %</span></div>
  ${s.tot?`<div class="mini" style="margin-top:4px">${hm(seriesTime(it).seen)} regardées · ${hm(seriesTime(it).left)} restantes${it.epRuntime?"":" (durée estimée)"}</div>`:""}<div class="prog ${s.tot&&s.seen>=s.tot?"done":""}"><i style="width:${Math.round(s.pct*100)}%"></i></div>
  ${s.tot?`<div class="row" style="margin-top:10px"><button class="btn sec" data-all="1" style="padding:9px">Tout cocher</button><button class="btn sec" data-all="0" style="padding:9px">Tout décocher</button></div>`:""}</div>
  ${ss.map((se,i)=>{const w=new Set(se.w||[]),n=se.eps||0,c=[...w].filter(x=>x<=n).length,full=n&&c>=n,part=c>0&&!full;const open=openSeasons[it.id+"_"+i]??(!full&&c>0);
    return `<div class="season"><div class="shd"><button class="ck ${full?"on":part?"part":""}" data-season="${i}" aria-label="Cocher la saison">${full?CHECK:part?`<span style="width:10px;height:3px;background:var(--ok);border-radius:2px"></span>`:""}</button><span class="nm">Saison ${se.n}</span><span class="cnt">${c}/${n}</span><button class="tog" data-open="${i}" aria-label="Épisodes"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="transform:rotate(${open?180:0}deg);transition:.2s"><path d="m6 9 6 6 6-6"/></svg></button></div>
    ${open?`<div class="eps">${Array.from({length:n},(_,k)=>`<button class="ep ${w.has(k+1)?"on":""}" data-ep="${i}:${k+1}">${k+1}</button>`).join("")}</div>${it.tmdbId?"":`<div class="sedit">Épisodes <input inputmode="numeric" data-eps="${i}" value="${n}"><button data-rmseason="${i}">Retirer la saison</button></div>`}`:""}</div>`}).join("")}
  ${it.tmdbId?"":`<div style="height:10px"></div><button class="btn sec" id="addSeason">+ Ajouter une saison</button>`}`;
}
function setSeasons(id,fn){const it=getItem(id);const ss=(it.seasons||[]).map(s=>({...s,w:[...(s.w||[])]}));fn(ss);const f={seasons:ss,updatedAt:Date.now()};if(it.sState){f.sState=null;toast(`${it.title} : reprise ▶`)}patch(id,f,800)}
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
  body.querySelectorAll("[data-sst]").forEach(b=>b.onclick=()=>{const v=b.dataset.sst||null;if((it.sState||null)!==v)patch(id,{sState:v,updatedAt:Date.now()},0)});
  body.querySelectorAll("[data-plat]").forEach(b=>b.onclick=()=>{const v=b.dataset.plat;patch(id,{platform:platformOf(it)===v?"":v,updatedAt:Date.now()},0)});
  const sw=$("#swapType"); if(sw) sw.onclick=()=>swapSearch(id);
  const rf=$("#refresh"); if(rf) rf.onclick=()=>refreshItem(id,true);
  const d=$("#del"); if(d) d.onclick=()=>{confirmDel=true;renderDetail()};
  const nd=$("#noDel"); if(nd) nd.onclick=()=>{confirmDel=false;renderDetail()};
  const yd=$("#yesDel"); if(yd) yd.onclick=async()=>{yd.disabled=true;try{await deleteItem(id);closeSheet();render();toast("Supprimé")}catch(e){yd.disabled=false;toast("Suppression impossible.")}};
}

/* ---- theme ---- */
const FONTSPEC={"Plus Jakarta Sans":"Plus+Jakarta+Sans:wght@500;600;700;800","Inter":"Inter:wght@400;500;600;700;800","DM Serif Display":"DM+Serif+Display","Space Grotesk":"Space+Grotesk:wght@400;500;600;700","Manrope":"Manrope:wght@400;500;600;700;800","Fraunces":"Fraunces:wght@500;600;700;800","Playfair Display":"Playfair+Display:wght@600;700;800","Source Serif 4":"Source+Serif+4:wght@400;600;700","Nunito":"Nunito:wght@400;600;700;800","Outfit":"Outfit:wght@400;500;600;700;800","JetBrains Mono":"JetBrains+Mono:wght@400;500;700;800","Bebas Neue":"Bebas+Neue","Work Sans":"Work+Sans:wght@400;500;600;700"};
const THEMES=[
 {id:"nuit",name:"Nuit",mode:"dark",fh:"Plus Jakarta Sans",fb:"Inter",v:{bg:"#0B0B0F",card:"#15151C",card2:"#1D1D26",ink:"#F3F3F6",muted:"#8E8E9C",line:"#262631",accent:"#E5484D",accent2:"#FF7A59",gold:"#F5B83D",ok:"#3DD68C",sheet:"#101016",glow:"rgba(229,72,77,.22)",onink:"#0B0B0F",onaccent:"#fff"}},
 {id:"clair",name:"Clair",mode:"light",fh:"Plus Jakarta Sans",fb:"Inter",v:{bg:"#F5F5F7",card:"#FFFFFF",card2:"#EEEEF2",ink:"#111116",muted:"#6E6E7A",line:"#E3E3E9",accent:"#E0383E",accent2:"#FF7A59",gold:"#E39B12",ok:"#1E9E5A",sheet:"#FFFFFF",glow:"rgba(224,56,62,.12)",onink:"#FFFFFF",onaccent:"#fff"}},
 {id:"retro",name:"Cinéma rétro",mode:"dark",fh:"DM Serif Display",fb:"Inter",v:{bg:"#1A1210",card:"#241914",card2:"#2E211A",ink:"#F6EBDD",muted:"#A8957F",line:"#3A2B22",accent:"#C8322F",accent2:"#E2A93B",gold:"#E2A93B",ok:"#86C47F",sheet:"#1E1511",glow:"rgba(226,169,59,.2)",onink:"#1A1210",onaccent:"#fff"}},
 {id:"neon",name:"Néon",mode:"dark",fh:"Space Grotesk",fb:"Space Grotesk",v:{bg:"#07060D",card:"#110F1C",card2:"#19162A",ink:"#F2F0FF",muted:"#8C87AE",line:"#241F3D",accent:"#FF2E97",accent2:"#00E5FF",gold:"#FFD23F",ok:"#2EF2A0",sheet:"#0B0A15",glow:"rgba(255,46,151,.3)",onink:"#07060D",onaccent:"#fff"}},
 {id:"ocean",name:"Océan",mode:"dark",fh:"Manrope",fb:"Manrope",v:{bg:"#071521",card:"#0E2233",card2:"#132C41",ink:"#E8F4FB",muted:"#7FA0B5",line:"#1B3A52",accent:"#2EC4B6",accent2:"#4CC9F0",gold:"#FFC857",ok:"#7BE495",sheet:"#0A1B29",glow:"rgba(46,196,182,.24)",onink:"#071521",onaccent:"#04201D"}},
 {id:"foret",name:"Forêt",mode:"dark",fh:"Fraunces",fb:"Inter",v:{bg:"#0F1A14",card:"#16251C",card2:"#1D3025",ink:"#EEF3EA",muted:"#8FA595",line:"#24392C",accent:"#E9A23B",accent2:"#F2C46D",gold:"#F2C46D",ok:"#8BD17C",sheet:"#122019",glow:"rgba(233,162,59,.2)",onink:"#0F1A14",onaccent:"#1F1404"}},
 {id:"sunset",name:"Coucher de soleil",mode:"dark",fh:"Outfit",fb:"Outfit",v:{bg:"#1B0F24",card:"#26162F",card2:"#311D3C",ink:"#FFF1E8",muted:"#B79AB0",line:"#3D2549",accent:"#FF6B35",accent2:"#F7B801",gold:"#F7B801",ok:"#6BE3A4",sheet:"#200F2A",glow:"rgba(255,107,53,.3)",onink:"#1B0F24",onaccent:"#fff"}},
 {id:"blockbuster",name:"Blockbuster",mode:"dark",fh:"Bebas Neue",fb:"Work Sans",v:{bg:"#0D0D0D",card:"#171717",card2:"#202020",ink:"#FFFFFF",muted:"#9A9A9A",line:"#2A2A2A",accent:"#FFC400",accent2:"#FF8A00",gold:"#FFC400",ok:"#4ADE80",sheet:"#121212",glow:"rgba(255,196,0,.16)",onink:"#0D0D0D",onaccent:"#0D0D0D"}},
 {id:"terminal",name:"Terminal",mode:"dark",fh:"JetBrains Mono",fb:"JetBrains Mono",v:{bg:"#050805",card:"#0B120B",card2:"#111B11",ink:"#C8FACC",muted:"#5E8F62",line:"#163016",accent:"#39FF14",accent2:"#00C853",gold:"#FFE66D",ok:"#39FF14",sheet:"#070B07",glow:"rgba(57,255,20,.14)",onink:"#050805",onaccent:"#050805"}},
 {id:"papier",name:"Journal",mode:"light",fh:"Playfair Display",fb:"Source Serif 4",v:{bg:"#FAFAF8",card:"#FFFFFF",card2:"#F0F0EC",ink:"#151515",muted:"#6B6B6B",line:"#E2E2DC",accent:"#1F4FD8",accent2:"#5B8CFF",gold:"#D99A1E",ok:"#2E7D4F",sheet:"#FFFFFF",glow:"rgba(31,79,216,.08)",onink:"#FFFFFF",onaccent:"#fff"}},
 {id:"pastel",name:"Pastel",mode:"light",fh:"Nunito",fb:"Nunito",v:{bg:"#F6F3FF",card:"#FFFFFF",card2:"#EEE9FB",ink:"#2B2540",muted:"#7C7596",line:"#E4DDF5",accent:"#F06292",accent2:"#B388FF",gold:"#FFA726",ok:"#26A69A",sheet:"#FFFFFF",glow:"rgba(179,136,255,.28)",onink:"#FFFFFF",onaccent:"#fff"}},
 {id:"minimal",name:"Minimal",mode:"light",fh:"Inter",fb:"Inter",v:{bg:"#FFFFFF",card:"#FFFFFF",card2:"#F2F2F2",ink:"#000000",muted:"#737373",line:"#E5E5E5",accent:"#111111",accent2:"#555555",gold:"#F5A623",ok:"#16A34A",sheet:"#FFFFFF",glow:"rgba(0,0,0,0)",onink:"#FFFFFF",onaccent:"#fff"}}
];
function themeId(){const t=LS.get("theme")||"nuit";return t==="dark"?"nuit":t==="light"?"clair":t}
function loadFonts(list){const fams=[...new Set(list)].filter(f=>FONTSPEC[f]);if(!fams.length)return;const href="https://fonts.googleapis.com/css2?"+fams.map(f=>"family="+FONTSPEC[f]).join("&")+"&display=swap";if(document.querySelector(`link[href="${href}"]`))return;const l=document.createElement("link");l.rel="stylesheet";l.href=href;document.head.appendChild(l)}
function themeCSS(T){const v=T.v;return Object.entries(v).map(([k,x])=>`--${k}:${x}`).join(";")+`;--fh:"${T.fh}";--fb:"${T.fb}";--accent-soft:color-mix(in srgb,${v.accent} 15%,transparent);--ok-soft:color-mix(in srgb,${v.ok} 14%,transparent);--starbg:${v.line};--starline:${v.line};--night:${T.mode==="dark"?v.bg:"#111116"}`}
function applyTheme(){
  let id=themeId(); if(id==="auto") id=(window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches)?"clair":"nuit";
  const T=THEMES.find(t=>t.id===id)||THEMES[0];
  const de=document.documentElement; de.dataset.theme=T.mode; de.dataset.skin=T.id; de.style.cssText=themeCSS(T);
  loadFonts([T.fh,T.fb]);
  LS.set("theme_css",JSON.stringify({mode:T.mode,skin:T.id,css:themeCSS(T)}));
  const m=document.querySelector('meta[name="theme-color"]'); if(m) m.content=T.v.bg;
}
try{matchMedia("(prefers-color-scheme: light)").addEventListener("change",()=>{if(themeId()==="auto")applyTheme()})}catch(e){}
/* ---- corriger film <-> série ---- */
async function swapSearch(id){
  const it=getItem(id); if(!it) return;
  const toTv=it.type==="film", mt=toTv?"tv":"movie", box=$("#swapBox");
  box.innerHTML=`<div class="mini" style="margin-top:10px">Je cherche « ${esc(it.title)} » parmi les ${toTv?"séries":"films"}…</div>`;
  let res=[];
  try{
    const q=(it.originalTitle&&it.originalTitle!==it.title)?[it.title,it.originalTitle]:[it.title];
    for(const t of q){const d=await tm(`/search/${mt}`,{query:t});(d.results||[]).forEach(r=>{if(!res.find(x=>x.id===r.id))res.push(r)})}
  }catch(e){box.innerHTML=`<div class="ai">${esc(tmErr(e))}</div>`;return}
  res=res.slice(0,6);
  box.innerHTML=`<label class="f">Choisis ${toTv?"la bonne série":"le bon film"}</label><div class="res">${res.map(r=>{const t=toTv?r.name:r.title,y=String(toTv?r.first_air_date:r.release_date||"").slice(0,4);
    return `<button class="ri" data-sw="${r.id}">${r.poster_path?`<img src="${IMG}w92${esc(r.poster_path)}" alt="">`:`<div class="noimg"></div>`}<div style="min-width:0"><div class="t">${esc(t)}</div><div class="y">${y}</div></div><span class="tag ${toTv?"tv":""}">${toTv?"Série":"Film"}</span></button>`}).join("")||`<div class="mini">Aucun résultat.</div>`}</div>`;
  box.querySelectorAll("[data-sw]").forEach(b=>b.onclick=async()=>{
    b.disabled=true;b.style.opacity=.6;
    try{
      const d=await fetchDetails(mt,+b.dataset.sw); const om=await fetchOmdb(d.imdbId);
      const keep={id:it.id,myRating:it.myRating,notes:it.notes,createdAt:it.createdAt,platform:it.platform};
      Object.keys(it).forEach(k=>delete it[k]);
      Object.assign(it,d,om,keep,{updatedAt:Date.now(),status:"avoir"});
      if(d.tmdbSeasons){it.seasons=d.tmdbSeasons.map(x=>({...x,w:[]}))} delete it.tmdbSeasons;
      if(!it.platform) it.platform=PICK.includes(d.autoPlatform)?d.autoPlatform:"";
      dirty.add(it.id); flush(it.id);
      tab=it.type; filter=it.type==="serie"?"avoir":"avoir"; syncTabs();
      $("#sheetBody")._h=null; $("#sheetBody").dataset.bd=""; render(); toast(`Reclassé en ${it.type==="serie"?"série":"film"} ✓`);
    }catch(e){b.disabled=false;b.style.opacity=1;toast(e?.code?tmErr(e):"Correction impossible")}
  });
}
/* ---- settings ---- */
function openSettings(){
  $("#sheetBody")._h=null; mode="settings"; openId=null; setBackdrop(null);
  const th=themeId(); loadFonts(THEMES.flatMap(t=>[t.fh,t.fb]));
  $("#sheetBody").innerHTML=`<h2>Réglages</h2>
  <label class="f">Thème</label>
  <div class="themes" id="stTheme">${[{id:"auto",name:"Auto",auto:true},...THEMES].map(t=>{const T=t.auto?null:t;return `<button class="th ${th===t.id?"on":""}" data-th="${t.id}" style="${T?`background:${T.v.bg};color:${T.v.ink};border-color:${th===t.id?T.v.accent:T.v.line}`:""}">
    ${T?`<span class="thA" style="font-family:'${T.fh}'">Aa</span><span class="thd"><i style="background:${T.v.accent}"></i><i style="background:${T.v.accent2}"></i><i style="background:${T.v.gold}"></i></span>`:`<span class="thA">◐</span><span class="thd auto"><i style="background:#0B0B0F"></i><i style="background:#F5F5F7"></i></span>`}
    <span class="thn" style="${T?`font-family:'${T.fb}'`:""}">${t.name}</span></button>`}).join("")}</div>
  <div class="rnote">Auto : Nuit ou Clair selon le réglage de ton iPhone.</div>
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
  <label class="f">Mot de passe</label>
  <input class="in" id="stPw" type="password" autocomplete="new-password" placeholder="Nouveau mot de passe (6 caractères min.)">
  <div class="rnote">Nécessaire pour te connecter dans l'app installée sur l'écran d'accueil.</div>
  <div style="height:8px"></div><button class="btn sec" id="stPwGo">Enregistrer le mot de passe</button>
  <div style="height:10px"></div><button class="btn sec" id="stOut">Se déconnecter</button>
  <div class="tmdb"><svg width="34" height="14" viewBox="0 0 34 14"><rect width="34" height="14" rx="3" fill="#0D253F"/><text x="17" y="10.5" text-anchor="middle" font-size="9" font-weight="700" fill="#01B4E4" font-family="Arial">TMDB</text></svg>Cette appli utilise l'API TMDB mais n'est ni approuvée ni certifiée par TMDB. Disponibilités : JustWatch.</div>`;
  $("#stTheme").onclick=e=>{const b=e.target.closest("[data-th]");if(!b)return;const st=$("#sheet").scrollTop;LS.set("theme",b.dataset.th);applyTheme();openSettings();$("#sheet").scrollTop=st;};
  $("#stSave").onclick=async()=>{prefs.tmdb=cleanTok($("#stTmdb").value);prefs.omdb=$("#stOmdb").value.trim();
    try{if(prefs.tmdb)await tm("/configuration",{});}catch(e){toast(tmErr(e));return}
    await savePrefs();toast("Réglages enregistrés");closeSheet()};
  const sr=$("#stRefresh"); if(sr) sr.onclick=async()=>{sr.disabled=true;const ids=items.filter(i=>i.tmdbId).map(i=>i.id);let k=0;for(const id of ids){sr.textContent=`Actualisation… ${++k}/${ids.length}`;await refreshItem(id,false)}sr.textContent="Fiches à jour ✓"};
  $("#stPwGo").onclick=async()=>{const p=$("#stPw").value;if(p.length<6){toast("6 caractères minimum");return}const {error}=await sb.auth.updateUser({password:p});if(error)toast(sbErr(error.message));else{$("#stPw").value="";toast("Mot de passe enregistré ✓")}};
  $("#stOut").onclick=async()=>{await sb.auth.signOut();LS.set("cache_items",null);location.reload()};
  openSheet();
}

/* ================= gate (setup + login) ================= */
function showGate(html){hideSplash();$("#gate").classList.remove("hidden");$("#gateBox").innerHTML=html}
function hideGate(){$("#gate").classList.add("hidden")}
function gateSetup(){
  showGate(`<div class="kicker">Configuration</div><h1>Films <span style="color:var(--gold);font-style:italic">&amp;</span> séries</h1>
  <p>Colle les deux valeurs de ton projet Supabase (Project Settings → API).</p>
  <label>Project URL</label><input class="in" id="gUrl" placeholder="https://xxxx.supabase.co" autocapitalize="off" spellcheck="false">
  <label>Clé publique (anon / publishable)</label><input class="in" id="gKey" placeholder="eyJ… ou sb_publishable_…" autocapitalize="off" spellcheck="false">
  <div class="err" id="gErr"></div><button class="btn" id="gGo">Continuer</button>`);
  $("#gGo").onclick=()=>{const u=normUrl($("#gUrl").value),k=$("#gKey").value.trim();if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(u)){$("#gErr").textContent="L'URL doit ressembler à https://xxxx.supabase.co";return}if(k.length<20||/service_role|sb_secret/.test(k)){$("#gErr").textContent="Colle la clé publique (anon ou publishable).";return}SB_URL=u;SB_KEY=k;LS.set("sb_url",u);LS.set("sb_key",k);location.reload()};
}
const isStandalone=()=>window.navigator.standalone===true||(window.matchMedia&&matchMedia("(display-mode: standalone)").matches);
function sbErr(m){return /JSON|fetch|Failed/i.test(m)?"Supabase ne répond pas : vérifie l'URL du projet.":/rate|limit|seconds/i.test(m)?"Trop d'e-mails envoyés : réessaie dans quelques minutes.":/Invalid login/i.test(m)?"E-mail ou mot de passe incorrect.":/not confirmed/i.test(m)?"Confirme d'abord ton e-mail (lien reçu), puis reviens te connecter ici.":/at least|weak|short/i.test(m)?"Mot de passe trop court (6 caractères minimum).":/already registered/i.test(m)?"Ce compte existe déjà : connecte-toi, ou « Mot de passe oublié » si tu n'en as jamais créé.":m}
function gateLogin(modeL){
  modeL=modeL||"login";
  const last=LS.get("last_email")||"";
  const T={login:["Connexion","Se connecter"],signup:["Créer mon compte","Créer mon compte"],forgot:["Mot de passe","Recevoir le lien"],link:["Lien par e-mail","Recevoir le lien"]}[modeL];
  showGate(`<div class="kicker">Ma watchlist</div><h1>Films <span style="color:var(--accent)">&amp;</span> séries</h1>
  <p>${modeL==="login"?"Connecte-toi avec ton e-mail et ton mot de passe.":modeL==="signup"?"Première fois ? Choisis un mot de passe : tu recevras un e-mail de confirmation.":modeL==="forgot"?"Pas encore de mot de passe, ou oublié ? Tu reçois un lien pour en choisir un. Ouvre-le, choisis ton mot de passe, puis reviens ici."+(isStandalone()?"":""):"Tu reçois un lien de connexion. Il s'ouvre dans Safari (pas dans l'app installée)."}</p>
  <label>E-mail</label><input class="in" id="gMail" type="email" value="${esc(last)}" placeholder="toi@exemple.fr" autocomplete="email" autocapitalize="off">
  ${modeL==="login"||modeL==="signup"?`<label>Mot de passe</label><input class="in" id="gPass" type="password" autocomplete="${modeL==="signup"?"new-password":"current-password"}" placeholder="6 caractères minimum">`:""}
  <div class="err" id="gErr"></div><button class="btn" id="gGo">${T[1]}</button>
  ${modeL!=="login"?`<button class="lnk" data-gm="login">J'ai un mot de passe : me connecter</button>`:""}
  ${modeL!=="signup"?`<button class="lnk" data-gm="signup">Première fois ? Créer un compte</button>`:""}
  ${modeL!=="forgot"?`<button class="lnk" data-gm="forgot">Mot de passe oublié / jamais créé</button>`:""}
  ${modeL!=="link"&&!isStandalone()?`<button class="lnk" data-gm="link">Me connecter par lien e-mail</button>`:""}
  ${CFG.supabaseUrl?"":`<button class="lnk" id="gReset">Modifier l'URL / la clé Supabase</button>`}`);
  document.querySelectorAll("[data-gm]").forEach(b=>b.onclick=()=>gateLogin(b.dataset.gm));
  const gr=$("#gReset"); if(gr) gr.onclick=()=>{LS.set("sb_url",null);LS.set("sb_key",null);location.reload()};
  const pw=$("#gPass"); if(pw) pw.onkeydown=e=>{if(e.key==="Enter")$("#gGo").click()};
  $("#gGo").onclick=async()=>{
    const em=$("#gMail").value.trim(), err=$("#gErr"), btn=$("#gGo");
    if(!/.+@.+\..+/.test(em)){err.textContent="E-mail invalide.";return}
    LS.set("last_email",em); btn.disabled=true; err.textContent="";
    const redirectTo=location.origin+location.pathname;
    let r;
    if(modeL==="login"){const p=$("#gPass").value;if(!p){btn.disabled=false;err.textContent="Saisis ton mot de passe.";return}r=await sb.auth.signInWithPassword({email:em,password:p})}
    else if(modeL==="signup"){const p=$("#gPass").value;if(p.length<6){btn.disabled=false;err.textContent="6 caractères minimum.";return}
      r=await sb.auth.signUp({email:em,password:p,options:{emailRedirectTo:redirectTo}});
      if(!r.error&&!r.data?.session){showGate(`<div class="kicker">Presque fini</div><h1>Confirme ton e-mail</h1><p>Un e-mail a été envoyé à <b>${esc(em)}</b>. Touche le lien de confirmation, puis reviens ici et connecte-toi avec ton mot de passe.</p><button class="btn" id="gBack">Me connecter</button>`);$("#gBack").onclick=()=>gateLogin("login");return}}
    else if(modeL==="forgot"){r=await sb.auth.resetPasswordForEmail(em,{redirectTo});
      if(!r.error){showGate(`<div class="kicker">E-mail envoyé</div><h1>Regarde tes e-mails</h1><p>Touche le lien reçu sur <b>${esc(em)}</b> : une page s'ouvre pour choisir ton mot de passe. Ensuite, reviens ici et connecte-toi.</p><button class="btn" id="gBack">Me connecter</button>`);$("#gBack").onclick=()=>gateLogin("login");return}}
    else {r=await sb.auth.signInWithOtp({email:em,options:{emailRedirectTo:redirectTo}}); if(!r.error){gateCode(em);return}}
    btn.disabled=false; if(r.error) err.textContent=sbErr(r.error.message);
  };
}
function gateNewPassword(){
  showGate(`<div class="kicker">Mot de passe</div><h1>Choisis ton mot de passe</h1><p>Tu l'utiliseras pour te connecter dans l'app installée sur l'écran d'accueil.</p>
  <label>Nouveau mot de passe</label><input class="in" id="gNp" type="password" autocomplete="new-password" placeholder="6 caractères minimum">
  <div class="err" id="gErr"></div><button class="btn" id="gGo">Enregistrer</button>`);
  $("#gGo").onclick=async()=>{const p=$("#gNp").value;if(p.length<6){$("#gErr").textContent="6 caractères minimum.";return}
    $("#gGo").disabled=true;const {error}=await sb.auth.updateUser({password:p});
    if(error){$("#gGo").disabled=false;$("#gErr").textContent=sbErr(error.message);return}
    hideGate();toast("Mot de passe enregistré ✓");};
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
  $("#gOk").onclick=async()=>{prefs.tmdb=cleanTok($("#gTok").value);$("#gOk").disabled=true;
    try{await tm("/configuration",{});await savePrefs();hideGate();toast("C'est prêt !")}catch(e){$("#gOk").disabled=false;$("#gErr").textContent=tmErr(e)}};
}

/* ================= events & boot ================= */
function syncTabs(){document.querySelectorAll("#tabs button").forEach(b=>b.classList.toggle("on",b.dataset.t===tab))}
$("#tabs").onclick=e=>{const b=e.target.closest("button");if(!b)return;tab=b.dataset.t;plat="";window.scrollTo({top:0});filter=tab==="serie"?"encours":"avoir";syncTabs();render()};
$("#filters").onclick=e=>{const b=e.target.closest("button");if(b){filter=b.dataset.f;render()}};
$("#plats").onclick=e=>{const b=e.target.closest("button");if(b){plat=b.dataset.p;render()}};
$("#grid").onclick=e=>{const c=e.target.closest(".card");if(c)openDetail(c.dataset.id)};
$("#rail").onclick=e=>{const g=e.target.closest("[data-next]");
  if(g){const id=g.dataset.next,it=getItem(id),nx=it&&nextEp(it);if(nx){setSeasons(id,ss=>{const s=ss.find(x=>x.n===nx.n);s.w=[...s.w,nx.e].sort((a,b)=>a-b)});toast(`${it.title} · S${nx.n}É${nx.e} vu ✓`)}return}
  const c=e.target.closest(".rc");if(c)openDetail(c.dataset.id)};
$("#q").oninput=e=>{query=e.target.value;render()};
$("#sugg").onclick=e=>{const r=e.target.closest("[data-sgr]");if(r){buildSug(r.dataset.sgr);return}const c=e.target.closest("[data-sg]");if(c)openSugg(c.dataset.sg)};
$("#dash").onclick=e=>{const d=e.target.closest("[data-d]");if(d){dashType=d.dataset.d;render();return}const t=e.target.closest(".dt");if(t)openDetail(t.dataset.id)};
$("#fab").onclick=openAdd; $("#gear").onclick=openSettings;

async function onSignedIn(u){
  user=u; hideGate();
  try{await loadPrefs()}catch(e){}
  try{await loadAll();hideSplash()}catch(e){hideSplash();$("#banner").textContent="Impossible de charger ta liste : "+(e.message||"erreur");$("#banner").classList.remove("hidden");loaded=true;render()}
  if(!prefs.tmdb) gateToken();
  else { // refresh stale ongoing series quietly
    const stale=items.filter(i=>i.tmdbId&&(i.keywords===undefined||(i.type==="serie"&&i.ongoing!==false&&i.epV!==2)||(i.type==="serie"&&(i.epRuntime===undefined||((i.ongoing!==false||statusOf(i)!=="vu")&&(!i.providersDate||Date.now()-i.providersDate>2*864e5))))))
      .sort((a,b)=>(a.keywords===undefined?0:1)-(b.keywords===undefined?0:1)||(a.providersDate||0)-(b.providersDate||0)).slice(0,25);
    for(const it of stale) await refreshItem(it.id,false);
  }
}
/* ---- carrousels sur ordinateur ---- */
function updArrows(row){const w=row.parentElement;if(!w||!w.classList.contains("hs"))return;const max=row.scrollWidth-row.clientWidth;w.classList.toggle("can-l",row.scrollLeft>4);w.classList.toggle("can-r",row.scrollLeft<max-4)}
function refreshArrows(){document.querySelectorAll(".hs > .drow, .hs > .rail").forEach(updArrows)}
document.addEventListener("click",e=>{const b=e.target.closest(".ha");if(!b)return;e.stopPropagation();const row=b.parentElement.querySelector(".drow,.rail");row.scrollBy({left:(b.classList.contains("l")?-1:1)*row.clientWidth*.8,behavior:"smooth"})},true);
document.addEventListener("scroll",e=>{const t=e.target;if(t&&t.classList&&(t.classList.contains("drow")||t.classList.contains("rail")))updArrows(t)},true);
let drag=null;
document.addEventListener("mousedown",e=>{const row=e.target.closest(".drow,.rail");if(!row||e.button!==0||e.target.closest(".ha,.go"))return;drag={row,x:e.clientX,sl:row.scrollLeft,moved:false}});
document.addEventListener("mousemove",e=>{if(!drag)return;const dx=e.clientX-drag.x;if(Math.abs(dx)>5){drag.moved=true;drag.row.classList.add("dragging")}if(drag.moved){drag.row.scrollLeft=drag.sl-dx;e.preventDefault()}});
document.addEventListener("mouseup",()=>{if(!drag)return;const d=drag;drag=null;d.row.classList.remove("dragging");if(d.moved){const block=ev=>{ev.stopPropagation();ev.preventDefault()};document.addEventListener("click",block,{capture:true,once:true});setTimeout(()=>document.removeEventListener("click",block,true),50)}});
window.addEventListener("resize",refreshArrows);
applyTheme();
syncTabs();
(async function boot(){
  try{const c=JSON.parse(LS.get("cache_items")||"null");if(Array.isArray(c)){items=c;loaded=true}}catch(e){}
  render();
  if(!initSb()){ if(!window.supabase) {$("#banner").textContent="Chargement impossible : vérifie ta connexion.";$("#banner").classList.remove("hidden")} else gateSetup(); return }
  let started=false;
  sb.auth.onAuthStateChange((ev,session)=>{
    if(ev==="PASSWORD_RECOVERY"){setTimeout(gateNewPassword,300)}
    if(session?.user&&(!user||user.id!==session.user.id)){started=true;onSignedIn(session.user)}
    if(ev==="SIGNED_OUT"){user=null;gateLogin()}
  });
  const {data}=await sb.auth.getSession();
  if(data.session?.user){ if(!started){started=true;onSignedIn(data.session.user)} }
  else gateLogin();
})();
