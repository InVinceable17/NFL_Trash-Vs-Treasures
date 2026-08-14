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
//                          [--seed <file.json>]
//
// --seed loads a league snapshot from disk instead of fetching the live one.
// Use it to preview states that don't exist live right now — a draft mid-flight,
// an empty league, a finished season.
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
  const SEED_FILE = arg("seed", null);
  if (SEED_FILE) {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
    console.log(`  seed loaded from ${path.basename(SEED_FILE)}`);
    return seed;
  }
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
    // Route through an in-memory PREVIEW object instead of window.location —
    // real navigation can break inside the Artifact sandbox. Starts at home.
    .replace(/window\.location/g, "PREVIEW")
    .replace(/const teamLogo = t => \{[^}]*\};/,
             'const teamLogo = t => null; // logos dropped (Artifact CSP blocks espncdn)')
    .replace('async function computeEspnSync(season, roster, players, windowsCache) {',
             'async function computeEspnSync(season, roster, players, windowsCache) {\n  return null; // offline preview: no live sync')
    .replace('ReactDOM.createRoot(document.getElementById("root")).render(<Root />);',
             '(window.__root = ReactDOM.createRoot(document.getElementById("root"))).render(<Root />);');
}

const TEAMS = ["Philadelphia Eagles","Houston Texans","Pittsburgh Steelers","Seattle Seahawks","Buffalo Bills","Green Bay Packers","Los Angeles Chargers","Cincinnati Bengals","Detroit Lions","New England Patriots","Denver Broncos","Indianapolis Colts","Baltimore Ravens","San Francisco 49ers","Jacksonville Jaguars","Los Angeles Rams","Tennessee Titans","Carolina Panthers","Las Vegas Raiders","Washington Commanders","New Orleans Saints","Miami Dolphins","New York Jets","Atlanta Falcons","New York Giants","Dallas Cowboys","Tampa Bay Buccaneers","Arizona Cardinals","Cleveland Browns","Minnesota Vikings","Chicago Bears","Kansas City Chiefs"];

function bootstrap(seed) {
  return `
(function(){ try{ var k='__t'; localStorage.setItem(k,'1'); localStorage.removeItem(k); }catch(e){ var m={}; try{ Object.defineProperty(window,'localStorage',{value:{getItem:function(k){return k in m?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}}},configurable:true}); }catch(_){} } })();

// In-memory router standing in for window.location, so nav re-renders the app
// client-side instead of doing a real navigation (unreliable in a sandbox).
var PREVIEW = {
  search: "", pathname: "/app", origin: "https://preview.local",
  get href(){ return this.origin + this.pathname + this.search; },
  set href(v){ this.go(String(v)); },
  assign: function(v){ this.go(String(v)); },
  go: function(url){
    url = String(url).replace(this.origin, "");
    var qi = url.indexOf("?");
    if (qi === 0) { this.search = url; }
    else if (qi > 0) { this.pathname = url.slice(0, qi) || "/app"; this.search = url.slice(qi); }
    else { this.pathname = url || "/app"; this.search = ""; }
    if (window.__reboot) window.__reboot();
  }
};
window.PREVIEW = PREVIEW;

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

// Synthetic regular-season calendar, so the Schedule tab can work the same way
// offline as it does live: 18 weeks, first kickoff early September.
var _WK_MS = 7*24*60*60*1000;
var _SEASON_START = Date.parse('2026-09-06T07:00:00Z');
function _calendar(){
  var entries = [];
  for (var w=1; w<=18; w++){
    entries.push({
      value: String(w),
      label: 'Week ' + w,
      startDate: new Date(_SEASON_START + (w-1)*_WK_MS).toISOString(),
      endDate:   new Date(_SEASON_START + w*_WK_MS - 60000).toISOString()
    });
  }
  return [{ value:'2', label:'Regular Season', entries: entries }];
}
// Rotate the pairings per week so consecutive weeks aren't identical.
function _weekEvents(week){
  var rot = _T.slice(); var shift = (week-1) % 16;
  var second = rot.splice(16, 16);
  for (var s=0; s<shift; s++) second.push(second.shift());
  var events = [];
  var kickoff = _SEASON_START + (week-1)*_WK_MS + 3*24*60*60*1000;
  for (var i=0; i<16; i++){
    events.push({
      id: 'wk'+week+'g'+i,
      date: new Date(kickoff + (i%4)*3*60*60*1000).toISOString(),
      competitions: [{
        status: { type: { completed:false, state:'pre', shortDetail:'Scheduled' } },
        competitors: [
          { homeAway:'away', score:'0', team:{ displayName: rot[i] } },
          { homeAway:'home', score:'0', team:{ displayName: second[i] } }
        ]
      }]
    });
  }
  return events;
}

window.fetch = function(url){
  if (typeof url==='string' && url.indexOf('/standings')>-1){
    // Season-aware: 2026 hasn't kicked off, so it returns 0-0 like the real feed.
    // That lets the preview exercise the previous-season fallback on draft boards.
    var sm = /[?&]season=(\\d+)/.exec(url);
    var yr = sm ? Number(sm[1]) : 2026;
    var unplayed = yr >= 2026;
    var entries = _T.map(function(n,i){
      var w = unplayed ? 0 : 3+((i*5)%12), l = unplayed ? 0 : 17-w;
      var diff = unplayed ? 0 : (w-l)*13 - 20;   // rough but signed, so +/- styling is exercised
      // id must match the futures stub's team refs — the app maps ids via standings
      return { team:{ id:String(i+1), displayName:n }, stats:[
        {name:'wins',value:w},{name:'losses',value:l},
        {name:'winPercent',value:(w+l)?w/(w+l):0},
        {name:'pointDifferential',value:diff}
      ] };
    });
    return Promise.resolve({ ok:true, status:200, json:function(){ return Promise.resolve({ children:[{ standings:{ entries: entries } }] }); } });
  }
  // NOTE: /nfl/teams is deliberately NOT stubbed. It sends no CORS header, so
  // the real browser blocks it; stubbing it here would let a call that cannot
  // work in production pass offline. Team ids come from standings instead.
  if (typeof url==='string' && url.indexOf('/powerindex')>-1){
    return Promise.resolve({ ok:true, status:200, json:function(){ return Promise.resolve({
      categories:[{ name:'projections', names:['projectedw','projectedl'] }],
      teams: _T.map(function(n,i){
        var pw = 12 - (i*7)%8;   // spread 5..12 so cards differ
        return { team:{ id:String(i+1), displayName:n },
                 categories:[{ name:'projections', values:[pw, 17-pw] }] };
      })
    }); } });
  }
  if (typeof url==='string' && url.indexOf('/futures')>-1){
    var books = _T.map(function(n,i){ return { team:{ $ref:'.../teams/'+(i+1)+'?lang=en' }, value:'+'+(500+i*250) }; });
    return Promise.resolve({ ok:true, status:200, json:function(){ return Promise.resolve({
      items:[{ name:'NFL - Super Bowl Winner', futures:[{ provider:{name:'demo'}, books: books }] }]
    }); } });
  }
  if (typeof url==='string' && url.indexOf('/scoreboard')>-1){
    var m = /[?&]week=(\\d+)/.exec(url);
    var wk = m ? Number(m[1]) : 1;
    return Promise.resolve({ ok:true, status:200, json:function(){
      return Promise.resolve({ leagues:[{ calendar: _calendar() }], events: _weekEvents(wk) });
    } });
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
<script>
window.__reboot = function(){
  try { if (window.__root) window.__root.unmount(); } catch(e){}
  var old = document.getElementById("root");
  if (old && old.parentNode) { var fresh = document.createElement("div"); fresh.id = "root"; old.parentNode.replaceChild(fresh, old); }
  __bootApp();
};
function __bootApp(){
${compiled}
}
__bootApp();
</script>
`;
}

// Render in jsdom, confirm the home screen mounts, then exercise the router
// (home -> league -> back) to confirm navigation works client-side.
function verify(content) {
  return new Promise((resolve, reject) => {
    const dom = new JSDOM(`<!doctype html><body>${content}</body>`, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://preview.local/" });
    const w = dom.window;
    const errs = [];
    w.addEventListener("error", e => errs.push((e.error && e.error.message) || e.message));
    const root = () => (w.document.getElementById("root") || {}).textContent || "";
    const done = (fn) => { try { fn(); } finally { w.close(); } };
    setTimeout(() => {
      const home = root();
      if (home.length < 100) return done(() => reject(new Error("home did not mount")));
      // Navigate into the league
      w.PREVIEW.go(`?league=${LEAGUE}&admin=1`);
      setTimeout(() => {
        const league = root();
        // Open the Schedule tab — it renders nothing until its fetches resolve,
        // so a plain mount check would miss a broken one.
        const schedTab = [...w.document.querySelectorAll("button.tab")]
          .find(b => /schedule/i.test(b.textContent || ""));
        if (schedTab) schedTab.click();
        setTimeout(() => {
          const sched = root();
          const tutTab = [...w.document.querySelectorAll("button.tab")]
            .find(b => /how it works/i.test(b.textContent || ""));
          if (tutTab) tutTab.click();
          setTimeout(() => {
            const tut = root();
            // Navigate back home
            w.PREVIEW.go("/app");
            setTimeout(() => {
              const back = root();
              done(() => {
                if (errs.length) return reject(new Error("runtime error: " + errs[0]));
                if (!/Standings|Treasures/.test(league)) return reject(new Error("league view did not render after nav"));
                if (!schedTab) return reject(new Error("Schedule tab button not found"));
                if (/Couldn't load/.test(sched)) return reject(new Error("Schedule tab errored: " + sched.slice(0, 160)));
                if (!/Week \d/.test(sched)) return reject(new Error("Schedule tab rendered no weeks: " + sched.slice(0, 160)));
                if (!/@/.test(sched)) return reject(new Error("Schedule tab rendered no matchups"));
                if (!tutTab) return reject(new Error("Tutorial tab button not found"));
                if (!/worked example/i.test(tut)) return reject(new Error("Tutorial tab did not render: " + tut.slice(0, 160)));
                if (back.length < 100) return reject(new Error("home did not render after back-nav"));
                resolve(`home ${home.length} / league ${league.length} / schedule ${sched.length} / tutorial ${tut.length} / back ${back.length}`);
              });
            }, 400);
          }, 400);
        }, 600);
      }, 400);
    }, 400);
  });
}

const seed = await fetchSeed();
const content = assemble(Babel.transform(adapt(src), { presets: [["react", { runtime: "classic" }]] }).code, bootstrap(seed));
const navReport = await verify(content);
fs.writeFileSync(OUT, content);
console.log(`✓ Preview written: ${OUT}`);
console.log(`  league=${LEAGUE} role=${ROLE} seed="${seed.name}" size=${(content.length / 1024).toFixed(0)}KB`);
console.log(`  nav check: ${navReport}`);
process.exit(0);
