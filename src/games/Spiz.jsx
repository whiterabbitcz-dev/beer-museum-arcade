import { useState, useEffect, useRef, useCallback } from "react";

/*
  SLÁDKOVA SPÍŽ — match-3 pro Czech Beer Museum (samostatná hra)
  Spojuj 3+ stejných surovin (voda, slad, chmel, kvasnice, med). Spojené padají do
  kotle (roste "várka"). Kaskády dávají komba "ČISTÁ VÁRKA". Edukace: pivo stojí na
  pár čistých surovinách (Reinheitsgebot 1516).

  Tok: attract → instrukce → countdown → hra (75 s) → výsledek
  Stejná rodina jako Mistr Sládek (Sfx, intro, countdown, result), teplá paleta.
*/

const C = {
  bg: "#241405", bg2: "#34200C", panel: "#3E2810",
  brass: "#E0A745", gold: "#F5C542", beer: "#E8A23E", beerDeep: "#B5701C",
  foam: "#F5EFE0", cream: "#EFE3CE", ink: "#1A0E03", green: "#7FB04A", wrong: "#A8432E",
  line: "rgba(245,239,224,0.14)",
};

// 5 surovin
const TILES = [
  { id: "voda", emoji: "💧", col: "#2E6E8E" },
  { id: "slad", emoji: "🌾", col: "#9A6B23" },
  { id: "chmel", emoji: "🌿", col: "#4C7A28" },
  { id: "kvasnice", emoji: "🫧", col: "#7A5AA8" },
  { id: "med", emoji: "🍯", col: "#D9A521" },
];
const TYPES = TILES.length;
const COLS = 7, ROWS = 8, GAME_SECONDS = 75;

let _uid = 1;
const nid = () => _uid++;

function makeBoard() {
  const b = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    let t;
    do { t = (Math.random() * TYPES) | 0; }
    while ((c >= 2 && b[r][c - 1].t === t && b[r][c - 2].t === t) || (r >= 2 && b[r - 1][c].t === t && b[r - 2][c].t === t));
    b[r][c] = { id: nid(), t };
  }
  return b;
}
function findMatches(b) {
  const m = new Set();
  for (let r = 0; r < ROWS; r++) { let run = 1; for (let c = 1; c <= COLS; c++) { const same = c < COLS && b[r][c] && b[r][c - 1] && b[r][c].t === b[r][c - 1].t; if (same) run++; else { if (run >= 3) for (let k = c - run; k < c; k++) m.add(r + "," + k); run = 1; } } }
  for (let c = 0; c < COLS; c++) { let run = 1; for (let r = 1; r <= ROWS; r++) { const same = r < ROWS && b[r][c] && b[r - 1][c] && b[r][c].t === b[r - 1][c].t; if (same) run++; else { if (run >= 3) for (let k = r - run; k < r; k++) m.add(k + "," + c); run = 1; } } }
  return m;
}
function collapse(b) {
  for (let c = 0; c < COLS; c++) {
    const col = [];
    for (let r = ROWS - 1; r >= 0; r--) if (b[r][c]) col.push(b[r][c]);
    for (let r = ROWS - 1; r >= 0; r--) b[r][c] = col[ROWS - 1 - r] || { id: nid(), t: (Math.random() * TYPES) | 0 };
  }
}

// ---------- Web Audio ----------
const Sfx = (() => {
  let ctx = null, master = null, enabled = true;
  const ensure = () => { if (typeof window === "undefined") return; if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.32; master.connect(ctx.destination); } if (ctx.state === "suspended") ctx.resume(); };
  const tone = (f, dur, type = "sine", vol = 0.3, slide) => { if (!enabled || !ctx) return; const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, ctx.currentTime); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(1, slide), ctx.currentTime + dur); g.gain.setValueAtTime(vol, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur); o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur); };
  return {
    resume: ensure, setEnabled: (v) => { enabled = v; }, isEnabled: () => enabled,
    click: () => tone(660, 0.06, "square", 0.16),
    beep: (hi) => tone(hi ? 820 : 540, 0.12, "square", 0.25),
    tick: () => tone(560, 0.05, "sine", 0.14),
    swap: () => tone(480, 0.07, "triangle", 0.18, 600),
    nope: () => tone(200, 0.18, "sawtooth", 0.2, 120),
    match: (mult) => { const base = 480 + mult * 90; [0, 1, 2].forEach((i) => setTimeout(() => tone(base + i * 120, 0.12, "triangle", 0.24), i * 45)); },
    fail: () => tone(190, 0.3, "sawtooth", 0.22, 80),
    win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.24, "triangle", 0.28), i * 95)),
  };
})();

// ===================================================================
export default function Spiz() {
  const [phase, setPhase] = useState("attract");
  const [muted, setMuted] = useState(false);
  const [final, setFinal] = useState({ score: 0, quality: 0, combos: 0 });

  useEffect(() => {
    const l = document.createElement("link"); l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Inter:wght@600;700;900&display=swap";
    document.head.appendChild(l); return () => { try { document.head.removeChild(l); } catch (e) {} };
  }, []);
  useEffect(() => {
    if (phase === "attract") return;
    let last = Date.now(); const bump = () => (last = Date.now());
    window.addEventListener("pointerdown", bump, true);
    const iv = setInterval(() => { if (Date.now() - last > 30000) setPhase("attract"); }, 1000);
    return () => { window.removeEventListener("pointerdown", bump, true); clearInterval(iv); };
  }, [phase]);
  const toggleMute = () => setMuted((m) => { const nm = !m; Sfx.setEnabled(!nm); if (!nm) Sfx.resume(); return nm; });

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", height: "100%", minHeight: 560, width: "100%", background: `radial-gradient(120% 90% at 50% -10%, ${C.bg2}, ${C.bg} 62%)`, color: C.cream, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
      <GlobalCSS />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: `1px solid ${C.line}`, zIndex: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 20 }}>🧺</span>
          <span style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 17, color: C.gold }}>Sládkova spíž</span>
        </div>
        <button onPointerUp={toggleMute} style={{ fontSize: 16, background: "rgba(0,0,0,0.25)", border: `1px solid ${C.line}`, borderRadius: 20, padding: "5px 10px", cursor: "pointer", touchAction: "manipulation", lineHeight: 1 }}>{muted ? "🔇" : "🔊"}</button>
      </div>

      <div style={{ flex: 1, position: "relative", display: "flex", minHeight: 0, zIndex: 2 }}>
        {phase === "attract" && <Attract onStart={() => { Sfx.resume(); Sfx.click(); setPhase("intro"); }} />}
        {phase === "intro" && <Intro onBegin={() => { Sfx.click(); setPhase("countdown"); }} />}
        {phase === "countdown" && <Countdown onGo={() => setPhase("play")} />}
        {phase === "play" && <Game onEnd={(f) => { setFinal(f); setPhase("result"); }} />}
        {phase === "result" && <Result final={final} onAgain={() => setPhase("attract")} />}
      </div>
    </div>
  );
}

function GlobalCSS() {
  return <style>{`
    @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
    @keyframes pop{0%{transform:scale(.5);opacity:0}100%{transform:scale(1);opacity:1}}
    @keyframes cd{0%{transform:scale(1.6);opacity:0}30%{transform:scale(1);opacity:1}100%{transform:scale(.7);opacity:0}}
    @keyframes tilein{0%{transform:scale(.4);opacity:0}100%{transform:scale(1);opacity:1}}
    @keyframes burst{0%{transform:scale(1)}60%{transform:scale(1.35)}100%{transform:scale(0);opacity:0}}
    @keyframes floatUp{from{transform:translate(-50%,0);opacity:1}to{transform:translate(-50%,-50px);opacity:0}}
    @keyframes nope{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
  `}</style>;
}

function bigBtn(extra = {}) {
  return { fontFamily: "Inter, sans-serif", fontWeight: 900, fontSize: 18, letterSpacing: 0.3, padding: "16px 32px", borderRadius: 16, border: "none", cursor: "pointer", background: `linear-gradient(180deg, ${C.gold}, ${C.brass})`, color: C.ink, boxShadow: "0 6px 0 rgba(0,0,0,0.3), 0 12px 24px rgba(0,0,0,0.4)", touchAction: "manipulation", userSelect: "none", ...extra };
}

function Attract({ onStart }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 26 }}>
      <div style={{ fontSize: 78, animation: "bob 3s ease-in-out infinite" }}>🧺</div>
      <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 48, lineHeight: 1, color: C.foam }}>Sládkova spíž</div>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: 20, color: C.brass, marginTop: 8 }}>Spojuj suroviny, plň kotel</div>
      <div style={{ display: "flex", gap: 10, marginTop: 14, fontSize: 30 }}>{TILES.map((t) => <span key={t.id}>{t.emoji}</span>)}</div>
      <div style={{ maxWidth: 340, color: "rgba(239,227,206,0.7)", marginTop: 12, fontSize: 15 }}>Voda, slad, chmel, kvasnice, med. Spoj tři a víc stejných — spadnou do kotle a vaří se z nich pivo.</div>
      <button style={bigBtn({ marginTop: 26, fontSize: 20 })} onPointerDown={(e) => (e.currentTarget.style.transform = "translateY(3px)")} onPointerUp={(e) => { e.currentTarget.style.transform = ""; onStart(); }}>🧺 Otevřít spíž</button>
    </div>
  );
}
function Intro({ onBegin }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ textAlign: "center", maxWidth: 460, animation: "pop .3s" }}>
        <div style={{ fontSize: 56 }}>🧺</div>
        <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 26, color: C.foam }}>Jak na to</div>
        <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: 14, padding: "16px 18px", margin: "14px 0", fontSize: 16, lineHeight: 1.55, textAlign: "left", borderLeft: `3px solid ${C.brass}` }}>
          Ťukni na surovinu a pak na <b>sousední</b> — prohodí se. Když vznikne řada <b>3+ stejných</b>, spojí se a spadnou do kotle. Spoj <b>4+</b> nebo udělej <b>kaskádu</b> a dostaneš kombo <b>ČISTÁ VÁRKA</b>.
        </div>
        <button style={bigBtn({ fontSize: 19 })} onPointerDown={(e) => (e.currentTarget.style.transform = "translateY(3px)")} onPointerUp={(e) => { e.currentTarget.style.transform = ""; onBegin(); }}>Jdeme! ▸</button>
      </div>
    </div>
  );
}
function Countdown({ onGo }) {
  const [n, setN] = useState(3);
  useEffect(() => { Sfx.beep(false); let cur = 3; const iv = setInterval(() => { cur -= 1; if (cur > 0) { setN(cur); Sfx.beep(false); } else if (cur === 0) { setN(0); Sfx.beep(true); } else { clearInterval(iv); onGo(); } }, 750); return () => clearInterval(iv); }, []); // eslint-disable-line
  return (<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><div key={n} style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: n > 0 ? 130 : 80, color: n > 0 ? C.gold : C.foam, animation: "cd .75s ease-out", lineHeight: 1 }}>{n > 0 ? n : "START!"}</div></div>);
}

// ---------- GAME ----------
function Game({ onEnd }) {
  const boardRef = useRef(makeBoard());
  const selRef = useRef(null);
  const popRef = useRef(new Set());
  const busyRef = useRef(false);
  const scoreRef = useRef(0);
  const qualityRef = useRef(0);
  const combosRef = useRef(0);
  const endedRef = useRef(false);
  const [, force] = useState(0);
  const render = () => force((x) => x + 1);
  const [time, setTime] = useState(GAME_SECONDS);
  const [floats, setFloats] = useState([]);
  const [cell, setCell] = useState(40);
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const cellRef = useRef(40);

  // sizing
  useEffect(() => {
    const fit = () => { const w = wrapRef.current; if (!w) return; const cs = Math.floor(Math.min(w.clientWidth / COLS, w.clientHeight / ROWS)); cellRef.current = cs; setCell(cs); };
    fit(); window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit);
  }, []);

  // swipe + tap resolution on pointer release
  useEffect(() => {
    const onUp = (e) => {
      const d = dragRef.current; dragRef.current = null;
      if (!d || busyRef.current || endedRef.current) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      const thr = Math.max(18, cellRef.current * 0.35);
      if (Math.max(adx, ady) < thr) { tapRef.current(d.r, d.c); return; } // malý pohyb = ťuk
      let r2 = d.r, c2 = d.c;
      if (adx > ady) c2 += dx > 0 ? 1 : -1; else r2 += dy > 0 ? 1 : -1;
      if (r2 < 0 || r2 >= ROWS || c2 < 0 || c2 >= COLS) return;
      selRef.current = null;
      swapRef.current(d.r, d.c, r2, c2);
    };
    const onCancel = () => { dragRef.current = null; };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => { window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onCancel); };
  }, []); // eslint-disable-line

  // timer
  useEffect(() => {
    const iv = setInterval(() => {
      setTime((t) => {
        if (t <= 1) { clearInterval(iv); endedRef.current = true; Sfx.win(); setTimeout(() => onEnd({ score: scoreRef.current, quality: qualityRef.current, combos: combosRef.current }), 300); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line

  const floatText = (txt) => { const id = nid(); setFloats((f) => [...f, { id, txt }]); setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 700); };

  const resolve = (mult) => {
    const b = boardRef.current;
    const matches = findMatches(b);
    if (!matches.size) { busyRef.current = false; render(); return; }
    popRef.current = matches; render();
    const cleared = matches.size;
    scoreRef.current += cleared * 10 * mult;
    qualityRef.current = Math.min(100, qualityRef.current + cleared);
    Sfx.match(mult);
    if (cleared >= 5 || mult >= 2) { combosRef.current += 1; floatText(`ČISTÁ VÁRKA${mult >= 2 ? " x" + mult : ""}!`); }
    setTimeout(() => {
      matches.forEach((key) => { const [r, c] = key.split(",").map(Number); b[r][c] = null; });
      collapse(b); popRef.current = new Set(); render();
      setTimeout(() => resolve(mult + 1), 120);
    }, 170);
  };

  const trySwap = (r1, c1, r2, c2) => {
    const b = boardRef.current;
    [b[r1][c1], b[r2][c2]] = [b[r2][c2], b[r1][c1]];
    if (findMatches(b).size) { busyRef.current = true; selRef.current = null; Sfx.swap(); render(); resolve(1); }
    else { [b[r1][c1], b[r2][c2]] = [b[r2][c2], b[r1][c1]]; Sfx.nope(); selRef.current = null; render(); }
  };

  const tap = (r, c) => {
    if (busyRef.current || endedRef.current) return;
    const sel = selRef.current;
    if (!sel) { selRef.current = { r, c }; Sfx.tick(); render(); return; }
    if (sel.r === r && sel.c === c) { selRef.current = null; render(); return; }
    if (Math.abs(sel.r - r) + Math.abs(sel.c - c) === 1) trySwap(sel.r, sel.c, r, c);
    else { selRef.current = { r, c }; Sfx.tick(); render(); }
  };

  const tapRef = useRef(tap); tapRef.current = tap;
  const swapRef = useRef(trySwap); swapRef.current = trySwap;

  const b = boardRef.current; const sel = selRef.current; const pop = popRef.current;
  const gridW = cell * COLS, gridH = cell * ROWS;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "8px 12px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "2px 4px 8px" }}>
        <div style={{ fontWeight: 900, fontSize: 18, color: time <= 10 ? C.wrong : C.foam }}>⏱ {time}s</div>
        <div style={{ fontWeight: 900, fontSize: 16, color: C.brass }}>{scoreRef.current}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: "rgba(239,227,206,0.6)", marginBottom: 2 }}>VÁRKA 🍺</div>
          <div style={{ height: 10, borderRadius: 6, background: "rgba(0,0,0,0.35)", overflow: "hidden" }}><div style={{ height: "100%", width: `${qualityRef.current}%`, background: `linear-gradient(90deg, ${C.brass}, ${C.gold})`, transition: "width .3s" }} /></div>
        </div>
        <div style={{ fontWeight: 900, color: C.foam }}>{qualityRef.current}%</div>
      </div>

      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", width: gridW, height: gridH, display: "grid", gridTemplateColumns: `repeat(${COLS}, ${cell}px)`, gridTemplateRows: `repeat(${ROWS}, ${cell}px)` }}>
          {b.map((row, r) => row.map((tile, c) => {
            const T = TILES[tile.t];
            const isSel = sel && sel.r === r && sel.c === c;
            const isPop = pop.has(r + "," + c);
            return (
              <button key={tile.id} onPointerDown={(e) => { e.preventDefault(); dragRef.current = { r, c, x: e.clientX, y: e.clientY }; }}
                style={{
                  width: cell, height: cell, padding: 2, border: "none", background: "transparent", cursor: "pointer", touchAction: "none",
                }}>
                <div style={{
                  width: "100%", height: "100%", borderRadius: cell * 0.24, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: cell * 0.5, background: `linear-gradient(160deg, ${T.col}, rgba(0,0,0,0.25))`,
                  border: isSel ? `3px solid ${C.gold}` : "2px solid rgba(255,255,255,0.12)",
                  boxShadow: isSel ? `0 0 14px ${C.gold}` : "inset 0 2px 4px rgba(255,255,255,0.15)",
                  animation: isPop ? "burst .18s forwards" : "tilein .18s",
                }}>{T.emoji}</div>
              </button>
            );
          }))}
          {floats.map((f) => (
            <div key={f.id} style={{ position: "absolute", left: "50%", top: "42%", transform: "translate(-50%,0)", fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: Math.max(22, cell * 0.7), color: C.gold, textShadow: "0 2px 8px rgba(0,0,0,0.7)", whiteSpace: "nowrap", pointerEvents: "none", animation: "floatUp .7s ease-out forwards", zIndex: 20 }}>{f.txt}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Result({ final, onAgain }) {
  useEffect(() => { Sfx.win(); }, []); // eslint-disable-line
  const q = final.quality || 0;
  const ranks = [
    { min: 90, name: "Mistr spíže", note: "Dokonale čistá várka. Sládek by ti potřásl rukou." },
    { min: 70, name: "Zkušený nákupčí", note: "Spíž plná, kotel bublá. Pěkná práce." },
    { min: 45, name: "Pomocník", note: "Něco se uvařilo — ale chce to víc cviku." },
    { min: 0, name: "Bloudil ve spíži", note: "Suroviny tak nějak zůstaly v polici. Zkus to znovu!" },
  ];
  const rank = ranks.find((r) => q >= r.min);
  const col = q >= 70 ? C.green : q >= 45 ? C.gold : C.wrong;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 26 }}>
      <div style={{ fontSize: 14, color: C.brass, letterSpacing: 2, fontWeight: 800 }}>KOTEL BUBLÁ</div>
      <div style={{ fontSize: 72, margin: "6px 0", animation: "pop .4s" }}>🍺</div>
      <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 42, color: col, lineHeight: 1 }}>{rank.name}</div>
      <div style={{ fontSize: 48, fontWeight: 900, color: col }}>{q}% várka</div>
      <div style={{ fontSize: 14, color: "rgba(239,227,206,0.7)", marginTop: 2 }}>Skóre {final.score} · {final.combos}× kombo</div>
      <div style={{ maxWidth: 380, color: "rgba(239,227,206,0.78)", marginTop: 8, fontSize: 15 }}>{rank.note}</div>
      <div style={{ maxWidth: 400, background: "rgba(0,0,0,0.25)", borderRadius: 12, padding: "12px 16px", margin: "16px 0 0", fontSize: 13.5, lineHeight: 1.5, textAlign: "left", borderLeft: `3px solid ${C.brass}` }}>
        <b style={{ color: C.brass }}>Věděl jsi?</b> Skvělé pivo stojí na pár čistých surovinách: voda, slad, chmel, kvasnice. Bavorský zákon o čistotě piva (<b>Reinheitsgebot, 1516</b>) povoloval jen je — a na téhle jednoduchosti stojí kvalita dodnes.
      </div>
      <button style={bigBtn({ marginTop: 22, fontSize: 19 })} onPointerDown={(e) => (e.currentTarget.style.transform = "translateY(3px)")} onPointerUp={(e) => { e.currentTarget.style.transform = ""; onAgain(); }}>↻ Hrát znovu</button>
    </div>
  );
}
