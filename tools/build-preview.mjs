// Regenerate a self-contained, offline Artifact preview from index.html.
//
// index.html is the single source of truth — this script only READS it. It
// inlines React, pre-compiles the JSX, stubs Firebase/Auth/ESPN with an
// in-memory layer seeded from the live (public) league snapshot, and writes a
// single HTML file suitable for publishing as an Artifact (no external hosts,
// which the Artifact CSP forbids).
//
// Usage:
//   npm install                 # once, in this tools/ dir
//   node build-preview.mjs [--league <id>] [--role admin|viewer] [--out <path>]
//
// Then publish the output file as an Artifact. To keep the same Artifact URL,
// always publish from the same path (or pass its url when publishing).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Babel from "@babel/standalone";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : def; };

const LEAGUE = arg("league", "61nr62");
const ROLE   = arg("role", "admin");          // admin = all tabs; viewer = dashboard only
const OUT    = arg("out", path.join(__dirname, "preview.html"));

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const css  = html.match(/<style>([\s\S]*?)<\/style>/)[1];
let src    = html.match(/<script type="text\/jsx-source" id="app-source">([\s\S]*?)<\/script>/)[1];

// Pull the public Firebase config + admin uid straight from source so the
// preview stays in sync with the real app.
const grab = k => (html.match(new RegExp(k + '\\s*:\\s*"([^"]+)"')) || [])[1];
const projectId = grab("projectId");
const apiKey    = grab("apiKey");
const ADMIN_UID = (html.match(/const ADMIN_UID = "([^"]+)"/) || [])[1] || "demo-admin";

// A minimal valid league, used if the live fetch is unavailable (offline).
const FALLBACK_SEED = {
  name: "Demo League 2025", season: 2025,
  players: ["Ana", "Ben", "Cid", "Dee"],
  records: {}, roster: Object.fromEntries(["Ana", "Ben", "Cid", "Dee"].map(p => [p,
    { treasures: { active: [], locked: [] }, trash: { active: [], locked: [] } }])),
};

function decodeFields(fields) {
  const dv = v =>
    v.stringValue  !== undefined ? v.stringValue :
    v.integerValue !== undefined ? Number(v.integerValue) :
    v.doubleValue  !== undefined ? v.doubleValue :
    v.booleanValue !== undefined ? v.booleanValue :
    v.nullValue    !== undefined ? null :
    v.arrayValue   !== undefined ? (v.arrayValue.values || []).map(dv) :
    v.mapValue     !== undefined ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dv(x)])) :
    undefined;
  const o = {}; for (const k in fields) o[k] = dv(fields[k]);
  return o;
}

async function fetchSeed() {
  if (!projectId || !apiKey) return FALLBACK_SEED;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/leagues/${LEAGUE}?key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Firestore ${res.status}`);
    const doc = await res.json();
    const seed = decodeFields(doc.fields || {});
    if (!seed.roster) throw new Error("no roster in doc");
    return seed;
  } catch (e) {
    console.warn(`  ! live fetch failed (${e.message}); using fallback seed`);
    return FALLBACK_SEED;
  }
}

// ---- Demo adaptations (source stays untouched; we transform a copy) ----
function adapt(source) {
  return source
    .replace('const LEAGUE_ID = _params.get("league");',
             `const LEAGUE_ID = _params.get("league") || ${JSON.stringify(LEAGUE)};`)
    .replace('const IS_ADMIN  = _params.get("admin") === "1"; // requests admin VIEW; editing also requires sign-in below',
             `const IS_ADMIN  = ${ROLE === "admin"}; // preview role: ${ROLE}`)
    .replace(/const teamLogo = t => \{[^}]*\};/,
             'const teamLogo = t => null; // logos dropped (Artifact CSP blocks espncdn)')
    .replace('async function computeEspnSync(season, roster, players, windowsCache) {',
             'async function computeEspnSync(season, roster, players, windowsCache) {\n  return null; // offline preview: no live sync');
}

const TEAMS = ["Philadelphia Eagles","Houston Texans","Pittsburgh Steelers","Seattle Seahawks","Buffalo Bills","Green Bay Packers","Los Angeles Chargers","Cincinnati Bengals","Detroit Lions","New England Patriots","Denver Broncos","Indianapolis Colts","Baltimore Ravens","San Francisco 49ers","Jacksonville Jaguars","Los Angeles Rams","Tennessee Titans","Carolina Panthers","Las Vegas Raiders","Washington Commanders","New Orleans Saints","Miami Dolphins","New York Jets","Atlanta Falcons","New York Giants","Dallas Cowboys","Tampa Bay Buccaneers","Arizona Cardinals","Cleveland Browns","Minnesota Vikings","Chicago Bears","Kansas City Chiefs"];

function bootstrap(seed) {
  return `
(function(){ try{ var k='__t'; localStorage.setItem(k,'1'); localStorage.removeItem(k); }catch(e){ var m={}; try{ Object.defineProperty(window,'localStorage',{value:{getItem:function(k){return k in m?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}}},configurable:true}); }catch(_){} } })();

var _seed = ${JSON.stringify({ [LEAGUE]: seed })};
var _listeners = {};
function _snap(id){ return { exists: id in _seed, data: function(){ return _seed[id]; } }; }
function _notify(id){ (_listeners[id]||[]).forEach(function(cb){ cb(_snap(id)); }); }
function _doc(id){ return {
  get: function(){ return Promise.resolve(_snap(id)); },
  set: function(v){ _seed[id]=v; _notify(id); return Promise.resolve(); },
  update: function(v){ _seed[id]=Object.assign({},_seed[id],v); _notify(id); return Promise.resolve(); },
  delete: function(){ delete _seed[id]; return Promise.resolve(); },
  onSnapshot: function(cb){ (_listeners[id]=_listeners[id]||[]).push(cb); Promise.resolve().then(function(){ cb(_snap(id)); }); return function(){ _listeners[id]=(_listeners[id]||[]).filter(function(x){return x!==cb;}); }; }
}; }
function _collection(){ return {
  doc: function(id){ return _doc(id); },
  get: function(){ return Promise.resolve({ docs: Object.keys(_seed).map(function(id){ return { id:id, data:function(){return _seed[id];}, ref:_doc(id) }; }) }); }
}; }
window.firebase = {
  firestore: function(){ return { collection: _collection }; },
  auth: (function(){ var ADMIN=${JSON.stringify(ADMIN_UID)}; var user=${ROLE === "admin"}?{uid:ADMIN}:null; var cbs=[];
    function notify(){ cbs.forEach(function(cb){cb(user);}); }
    var fn = function(){ return {
      get currentUser(){ return user; },
      onAuthStateChanged: function(cb){ cbs.push(cb); Promise.resolve().then(function(){cb(user);}); return function(){ cbs=cbs.filter(function(x){return x!==cb;}); }; },
      signInWithPopup: function(){ user={uid:ADMIN}; notify(); return Promise.resolve(); },
      signOut: function(){ user=null; notify(); return Promise.resolve(); }
    }; };
    fn.GoogleAuthProvider = function(){};
    return fn;
  })()
};

var _T = ${JSON.stringify(TEAMS)};
window.fetch = function(url){
  if (typeof url==='string' && url.indexOf('/standings')>-1){
    var entries = _T.map(function(n,i){ var w=3+((i*5)%12), l=17-w; return { team:{displayName:n}, stats:[{name:'wins',value:w},{name:'losses',value:l},{name:'winPercent',value:w/(w+l)}] }; });
    return Promise.resolve({ ok:true, status:200, json:function(){ return Promise.resolve({ children:[{ standings:{ entries: entries } }] }); } });
  }
  return Promise.resolve({ ok:false, status:503, json:function(){ return Promise.resolve({}); } });
};
`;
}

function assemble(compiled, boot) {
  const react    = fs.readFileSync(path.join(__dirname, "node_modules/react/umd/react.production.min.js"), "utf8");
  const reactDom = fs.readFileSync(path.join(__dirname, "node_modules/react-dom/umd/react-dom.production.min.js"), "utf8");
  return `<style>
${css}
  .demo-ribbon { position: fixed; bottom: 10px; right: 12px; z-index: 50; font-size: 11px; color: var(--muted); background: var(--panel-2); border: 1px solid var(--line); border-radius: 20px; padding: 5px 12px; opacity: .9; }
</style>
<div id="root"></div>
<div class="demo-ribbon">Offline preview · data snapshot · edits stay local</div>
<script>${react}</script>
<script>${reactDom}</script>
<script>${boot}</script>
<script>${compiled}</script>
`;
}

// Render the output in jsdom and confirm the app actually mounts.
function verify(content) {
  return new Promise((resolve, reject) => {
    const dom = new JSDOM(`<!doctype html><body>${content}</body>`, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://preview.local/" });
    const errs = [];
    dom.window.addEventListener("error", e => errs.push((e.error && e.error.message) || e.message));
    setTimeout(() => {
      const txt = (dom.window.document.getElementById("root") || {}).textContent || "";
      dom.window.close();
      if (txt.length < 100) return reject(new Error("app did not mount (empty #root)"));
      if (errs.length)      return reject(new Error("runtime error: " + errs[0]));
      resolve(txt.length);
    }, 700);
  });
}

const seed = await fetchSeed();
const content = assemble(Babel.transform(adapt(src), { presets: [["react", { runtime: "classic" }]] }).code, bootstrap(seed));
const rootLen = await verify(content);
fs.writeFileSync(OUT, content);
console.log(`✓ Preview written: ${OUT}`);
console.log(`  league=${LEAGUE} role=${ROLE} seed="${seed.name}" size=${(content.length / 1024).toFixed(0)}KB mount=${rootLen}chars`);
process.exit(0);
