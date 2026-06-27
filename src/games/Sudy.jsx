import { useState, useEffect, useRef, useCallback } from "react";

/*
  BEDNÁŘŮV SKLEP — sokoban pro Czech Beer Museum (samostatná hra)
  Kutálíš plné sudy na ležácká lože (cílová pole) ve sklepě. Krátké, odpouštějící
  levely s undo + reset (žádné zákeřné deadlocky). Tematické sklepy.
  Edukace: sudy byly po staletí způsob, jak pivo skladovat a vozit do hospod.

  Tok: attract → instrukce → hra (levely) → výsledek. Bez countdownu (není časovka).
  Stejná rodina jako Mistr Sládek (Sfx, intro, result), teplá paleta.
*/

const C = {
  bg: "#241405", bg2: "#34200C", stone: "#2A1B0C", stoneHi: "#3A2613",
  floor: "#4A3217", floorHi: "#573B1C",
  brass: "#E0A745", gold: "#F5C542", foam: "#F5EFE0", cream: "#EFE3CE",
  ink: "#1A0E03", wood: "#9A6326", woodDeep: "#5E3A14", hoop: "#3A2410",
  green: "#7FB04A", target: "#E8A23E", line: "rgba(245,239,224,0.14)",
};

// symboly: # zeď, . lože(cíl), $ sud, * sud na loži, @ bednář, + bednář na loži, ' ' podlaha
const LEVELS = [
  { name: "Sklep U Zlatého chmele", map: ["######", "#@ $.#", "######"] },
  { name: "Ledový sklep", map: ["#######", "#@ $ .#", "#  $ .#", "#######"] },
  { name: "Panská hospoda", map: ["#######", "# . . #", "#     #", "# $ $ #", "#  @  #", "#######"] },
  { name: "Pivovarský sklad", map: ["#######", "#. . .#", "#     #", "#$ $ $#", "#  @  #", "#######"] },
];

const key = (r, c) => r + "," + c;

function parseLevel(map) {
  const walls = new Set(), targets = new Set(), barrels = new Set();
  let player = null, rows = map.length, cols = 0;
  map.forEach((line, r) => {
    cols = Math.max(cols, line.length);
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === "#") walls.add(key(r, c));
      if (ch === "." || ch === "*" || ch === "+") targets.add(key(r, c));
      if (ch === "$" || ch === "*") barrels.add(key(r, c));
      if (ch === "@" || ch === "+") player = { r, c };
    }
  });
  return { walls, targets, barrels: [...barrels], player, rows, cols };
}

// ---------- Web Audio ----------
const Sfx = (() => {
  let ctx = null, master = null, enabled = true;
  const ensure = () => { if (typeof window === "undefined") return; if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.32; master.connect(ctx.destination); } if (ctx.state === "suspended") ctx.resume(); };
  const tone = (f, dur, type = "sine", vol = 0.3, slide) => { if (!enabled || !ctx) return; const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, ctx.currentTime); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(1, slide), ctx.currentTime + dur); g.gain.setValueAtTime(vol, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur); o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur); };
  const noise = (dur, vol = 0.3, f = 800, type = "lowpass") => { if (!enabled || !ctx) return; const n = ctx.createBufferSource(); const buf = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * dur), ctx.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; n.buffer = buf; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; const g = ctx.createGain(); g.gain.setValueAtTime(vol, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur); n.connect(fl); fl.connect(g); g.connect(master); n.start(); n.stop(ctx.currentTime + dur); };
  return {
    resume: ensure, setEnabled: (v) => { enabled = v; }, isEnabled: () => enabled,
    click: () => tone(660, 0.06, "square", 0.16),
    step: () => tone(300, 0.04, "sine", 0.1),
    roll: () => { tone(140, 0.14, "sawtooth", 0.2, 90); noise(0.12, 0.12, 500); },
    seat: () => { tone(520, 0.1, "triangle", 0.24, 700); tone(180, 0.12, "sine", 0.2, 120); },
    undo: () => tone(420, 0.08, "triangle", 0.16, 300),
    levelclear: () => [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, "triangle", 0.26), i * 80)),
    win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.24, "triangle", 0.28), i * 95)),
  };
})();

// ===================================================================
export default function Sudy() {
  const [phase, setPhase] = useState("attract");
  const [muted, setMuted] = useState(false);
  const [final, setFinal] = useState({ moves: 0, undos: 0 });

  useEffect(() => {
    const l = document.createElement("link"); l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Inter:wght@600;700;900&display=swap";
    document.head.appendChild(l); return () => { try { document.head.removeChild(l); } catch (e) {} };
  }, []);
  useEffect(() => {
    if (phase === "attract") return;
    let last = Date.now(); const bump = () => (last = Date.now());
    window.addEventListener("pointerdown", bump, true); window.addEventListener("keydown", bump, true);
    const iv = setInterval(() => { if (Date.now() - last > 45000) setPhase("attract"); }, 1000);
    return () => { window.removeEventListener("pointerdown", bump, true); window.removeEventListener("keydown", bump, true); clearInterval(iv); };
  }, [phase]);
  const toggleMute = () => setMuted((m) => { const nm = !m; Sfx.setEnabled(!nm); if (!nm) Sfx.resume(); return nm; });

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", height: "100%", minHeight: 560, width: "100%", background: `radial-gradient(120% 90% at 50% -10%, ${C.bg2}, ${C.bg} 62%)`, color: C.cream, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
      <GlobalCSS />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: `1px solid ${C.line}`, zIndex: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 20 }}>🛢️</span>
          <span style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 17, color: C.gold }}>Bednářův sklep</span>
        </div>
        <button onPointerUp={toggleMute} style={{ fontSize: 16, background: "rgba(0,0,0,0.25)", border: `1px solid ${C.line}`, borderRadius: 20, padding: "5px 10px", cursor: "pointer", touchAction: "manipulation", lineHeight: 1 }}>{muted ? "🔇" : "🔊"}</button>
      </div>

      <div style={{ flex: 1, position: "relative", display: "flex", minHeight: 0, zIndex: 2 }}>
        {phase === "attract" && <Attract onStart={() => { Sfx.resume(); Sfx.click(); setPhase("intro"); }} />}
        {phase === "intro" && <Intro onBegin={() => { Sfx.click(); setPhase("play"); }} />}
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
    @keyframes seatpop{0%{transform:scale(1)}50%{transform:scale(1.18)}100%{transform:scale(1)}}
    @keyframes clearflash{0%{opacity:0}40%{opacity:1}100%{opacity:0}}
  `}</style>;
}

function bigBtn(extra = {}) {
  return { fontFamily: "Inter, sans-serif", fontWeight: 900, fontSize: 18, letterSpacing: 0.3, padding: "16px 32px", borderRadius: 16, border: "none", cursor: "pointer", background: `linear-gradient(180deg, ${C.gold}, ${C.brass})`, color: C.ink, boxShadow: "0 6px 0 rgba(0,0,0,0.3), 0 12px 24px rgba(0,0,0,0.4)", touchAction: "manipulation", userSelect: "none", ...extra };
}

function Attract({ onStart }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 26 }}>
      <div style={{ fontSize: 78, animation: "bob 3s ease-in-out infinite" }}>🛢️</div>
      <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 46, lineHeight: 1, color: C.foam }}>Bednářův sklep</div>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: 20, color: C.brass, marginTop: 8 }}>Dokutálej sudy na jejich lože</div>
      <div style={{ maxWidth: 340, color: "rgba(239,227,206,0.7)", marginTop: 12, fontSize: 15 }}>Jsi bednář ve sklepě. Roluj plné sudy na vyznačená ležácká lože. Když se zasekneš, vrať tah zpět.</div>
      <button style={bigBtn({ marginTop: 26, fontSize: 20 })} onPointerDown={(e) => (e.currentTarget.style.transform = "translateY(3px)")} onPointerUp={(e) => { e.currentTarget.style.transform = ""; onStart(); }}>🛢️ Do sklepa</button>
    </div>
  );
}
function Intro({ onBegin }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ textAlign: "center", maxWidth: 470, animation: "pop .3s" }}>
        <div style={{ fontSize: 54 }}>🛢️</div>
        <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 26, color: C.foam }}>Jak na to</div>
        <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: 14, padding: "16px 18px", margin: "14px 0", fontSize: 16, lineHeight: 1.55, textAlign: "left", borderLeft: `3px solid ${C.brass}` }}>
          Šipkami chodíš po sklepě. Když jdeš proti sudu, <b>tlačíš ho</b> — ale jen když je za ním místo. Dostaň <b>každý sud na zářící lože</b>. Zaseknutý? Klepni <b>↶ Zpět</b> nebo <b>↻ Reset</b>. Nic nezkazíš.
        </div>
        <button style={bigBtn({ fontSize: 19 })} onPointerDown={(e) => (e.currentTarget.style.transform = "translateY(3px)")} onPointerUp={(e) => { e.currentTarget.style.transform = ""; onBegin(); }}>Jdeme! ▸</button>
      </div>
    </div>
  );
}

// ---------- GAME ----------
function Game({ onEnd }) {
  const [lvlIdx, setLvlIdx] = useState(0);
  const stateRef = useRef(null);     // {walls,targets,barrels:Set,player,rows,cols}
  const histRef = useRef([]);
  const movesRef = useRef(0);
  const undosRef = useRef(0);
  const lockRef = useRef(false);
  const [, force] = useState(0);
  const render = () => force((x) => x + 1);
  const [cell, setCell] = useState(46);
  const [clearing, setClearing] = useState(false);
  const wrapRef = useRef(null);

  const loadLevel = (i) => {
    const p = parseLevel(LEVELS[i].map);
    stateRef.current = { walls: p.walls, targets: p.targets, barrels: new Set(p.barrels), player: p.player, rows: p.rows, cols: p.cols };
    histRef.current = []; lockRef.current = false; render();
  };
  useEffect(() => { loadLevel(0); }, []); // eslint-disable-line
  useEffect(() => {
    const fit = () => { const w = wrapRef.current, st = stateRef.current; if (!w || !st) return; setCell(Math.floor(Math.min((w.clientWidth - 8) / st.cols, (w.clientHeight - 8) / st.rows))); };
    fit(); window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit);
  }, [lvlIdx]);

  const isWin = (st) => [...st.targets].every((t) => st.barrels.has(t));

  const move = (dr, dc) => {
    const st = stateRef.current; if (!st || lockRef.current) return;
    const nr = st.player.r + dr, nc = st.player.c + dc, nk = key(nr, nc);
    if (st.walls.has(nk)) return;
    if (st.barrels.has(nk)) {
      const br = nr + dr, bc = nc + dc, bk = key(br, bc);
      if (st.walls.has(bk) || st.barrels.has(bk)) return; // can't push
      // snapshot
      histRef.current.push({ player: { ...st.player }, barrels: new Set(st.barrels) });
      st.barrels.delete(nk); st.barrels.add(bk); st.player = { r: nr, c: nc };
      movesRef.current++; Sfx.roll();
      if (st.targets.has(bk)) Sfx.seat();
    } else {
      histRef.current.push({ player: { ...st.player }, barrels: new Set(st.barrels) });
      st.player = { r: nr, c: nc }; movesRef.current++; Sfx.step();
    }
    render();
    if (isWin(st)) {
      lockRef.current = true; Sfx.levelclear(); setClearing(true);
      setTimeout(() => {
        setClearing(false);
        if (lvlIdx + 1 >= LEVELS.length) { Sfx.win(); onEnd({ moves: movesRef.current, undos: undosRef.current }); }
        else { const ni = lvlIdx + 1; setLvlIdx(ni); loadLevel(ni); }
      }, 900);
    }
  };
  const undo = () => { const h = histRef.current; if (!h.length || lockRef.current) return; const prev = h.pop(); const st = stateRef.current; st.player = prev.player; st.barrels = prev.barrels; undosRef.current++; Sfx.undo(); render(); };
  const reset = () => { if (lockRef.current) return; Sfx.undo(); loadLevel(lvlIdx); };

  // keyboard
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowUp") { e.preventDefault(); move(-1, 0); }
      else if (e.key === "ArrowDown") { e.preventDefault(); move(1, 0); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); move(0, -1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); move(0, 1); }
      else if (e.key === "z" || e.key === "Backspace") { e.preventDefault(); undo(); }
      else if (e.key === "r") { e.preventDefault(); reset(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line

  const st = stateRef.current;
  if (!st) return <div style={{ flex: 1 }} />;
  const gridW = cell * st.cols, gridH = cell * st.rows;
  const placed = [...st.targets].filter((t) => st.barrels.has(t)).length;

  const dpadBtn = (label, handler, span) => (
    <button onPointerDown={(e) => { e.preventDefault(); handler(); }} style={{
      gridArea: span, height: "100%", width: "100%", borderRadius: 12, border: `1px solid ${C.line}`,
      background: "linear-gradient(180deg, rgba(224,167,69,0.18), rgba(0,0,0,0.25))", color: C.foam,
      fontSize: 26, fontWeight: 900, cursor: "pointer", touchAction: "none", boxShadow: "0 3px 0 rgba(0,0,0,0.3)", userSelect: "none",
    }}>{label}</button>
  );
  const sideBtn = (label, handler) => (
    <button onPointerDown={(e) => { e.preventDefault(); handler(); }} style={{
      flex: 1, height: 48, borderRadius: 12, border: `1px solid ${C.line}`, background: "rgba(0,0,0,0.25)",
      color: C.brass, fontSize: 15, fontWeight: 800, cursor: "pointer", touchAction: "none", userSelect: "none",
    }}>{label}</button>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "8px 12px 12px" }}>
      {/* HUD */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 4px 8px" }}>
        <div style={{ fontWeight: 900, fontSize: 14, color: C.brass }}>Sklep {lvlIdx + 1}/{LEVELS.length}</div>
        <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 15, color: C.foam }}>{LEVELS[lvlIdx].name}</div>
        <div style={{ fontWeight: 900, fontSize: 14, color: C.gold }}>{placed}/{st.targets.size} 🛢️</div>
      </div>

      {/* board */}
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", width: gridW, height: gridH }}>
          {Array.from({ length: st.rows }).map((_, r) => Array.from({ length: st.cols }).map((__, c) => {
            const k = key(r, c); const wall = st.walls.has(k); const tgt = st.targets.has(k);
            return (
              <div key={k} style={{ position: "absolute", left: c * cell, top: r * cell, width: cell, height: cell, padding: 1, boxSizing: "border-box" }}>
                <div style={{
                  width: "100%", height: "100%", borderRadius: 5,
                  background: wall ? `linear-gradient(160deg, ${C.stoneHi}, ${C.stone})` : `linear-gradient(160deg, ${C.floorHi}, ${C.floor})`,
                  boxShadow: wall ? "inset 0 2px 3px rgba(255,255,255,0.08), inset 0 -2px 3px rgba(0,0,0,0.4)" : "inset 0 0 0 1px rgba(0,0,0,0.2)",
                }}>
                  {tgt && !wall && (
                    <div style={{ position: "absolute", inset: cell * 0.22, borderRadius: "50%", border: `3px dashed ${C.target}`, boxShadow: `0 0 10px ${C.target}66`, animation: "seatpop 2s ease-in-out infinite" }} />
                  )}
                </div>
              </div>
            );
          }))}

          {/* barrels */}
          {[...st.barrels].map((bk) => {
            const [r, c] = bk.split(",").map(Number); const onT = st.targets.has(bk);
            return (
              <div key={"b" + bk} style={{ position: "absolute", left: c * cell, top: r * cell, width: cell, height: cell, padding: cell * 0.12, boxSizing: "border-box", transition: "left .09s linear, top .09s linear" }}>
                <div style={{
                  width: "100%", height: "100%", borderRadius: "28% / 38%",
                  background: `linear-gradient(180deg, ${C.wood}, ${C.woodDeep})`,
                  border: onT ? `3px solid ${C.gold}` : `2px solid ${C.hoop}`,
                  boxShadow: onT ? `0 0 14px ${C.gold}, inset 0 0 6px rgba(0,0,0,0.4)` : "inset 0 -3px 6px rgba(0,0,0,0.45), inset 0 3px 4px rgba(255,255,255,0.15)",
                  position: "relative", overflow: "hidden",
                }}>
                  <div style={{ position: "absolute", top: "28%", left: 0, right: 0, height: 2, background: C.hoop, opacity: 0.7 }} />
                  <div style={{ position: "absolute", top: "62%", left: 0, right: 0, height: 2, background: C.hoop, opacity: 0.7 }} />
                  <div style={{ position: "absolute", top: 3, left: "20%", right: "20%", height: "20%", borderRadius: "50%", background: "rgba(255,255,255,0.18)" }} />
                  {onT && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: cell * 0.34 }}>✓</div>}
                </div>
              </div>
            );
          })}

          {/* player */}
          <div style={{ position: "absolute", left: st.player.c * cell, top: st.player.r * cell, width: cell, height: cell, display: "flex", alignItems: "center", justifyContent: "center", fontSize: cell * 0.6, transition: "left .09s linear, top .09s linear", zIndex: 5 }}>🧑‍🏭</div>

          {clearing && <div style={{ position: "absolute", inset: 0, background: `radial-gradient(circle, ${C.gold}55, transparent 70%)`, animation: "clearflash .9s ease-out", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: Math.max(20, cell * 0.7), color: C.foam, textShadow: "0 2px 8px #000", zIndex: 10 }}>Sklep plný!</div>}
        </div>
      </div>

      {/* controls: D-pad + side */}
      <div style={{ display: "flex", gap: 12, marginTop: 10, alignItems: "stretch" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 56px)", gridTemplateRows: "repeat(2, 50px)", gap: 6, gridTemplateAreas: `". up ." "left down right"` }}>
          {dpadBtn("▲", () => move(-1, 0), "up")}
          {dpadBtn("◀", () => move(0, -1), "left")}
          {dpadBtn("▼", () => move(1, 0), "down")}
          {dpadBtn("▶", () => move(0, 1), "right")}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, justifyContent: "center" }}>
          {sideBtn("↶ Zpět", undo)}
          {sideBtn("↻ Reset", reset)}
        </div>
      </div>
    </div>
  );
}

function Result({ final, onAgain }) {
  useEffect(() => { Sfx.win(); }, []); // eslint-disable-line
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 26 }}>
      <div style={{ fontSize: 14, color: C.brass, letterSpacing: 2, fontWeight: 800 }}>VŠECHNY SUDY NA MÍSTĚ</div>
      <div style={{ fontSize: 72, margin: "6px 0", animation: "pop .4s" }}>🛢️</div>
      <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 44, color: C.green, lineHeight: 1 }}>Sklepmistr</div>
      <div style={{ fontSize: 15, color: "rgba(239,227,206,0.75)", marginTop: 8 }}>Naskladnil jsi všechny sklepy za <b style={{ color: C.foam }}>{final.moves}</b> tahů{final.undos ? ` (${final.undos}× zpět)` : ""}.</div>
      <div style={{ maxWidth: 400, background: "rgba(0,0,0,0.25)", borderRadius: 12, padding: "12px 16px", margin: "16px 0 0", fontSize: 13.5, lineHeight: 1.5, textAlign: "left", borderLeft: `3px solid ${C.brass}` }}>
        <b style={{ color: C.brass }}>Věděl jsi?</b> Dřevěné sudy byly po staletí jediný způsob, jak pivo skladovat a rozvážet do hospod. Ve sklepě se ukládaly na bok na dřevěná lože — a dodnes se říká, že pivo se „stáčí do sudů".
      </div>
      <button style={bigBtn({ marginTop: 22, fontSize: 19 })} onPointerDown={(e) => (e.currentTarget.style.transform = "translateY(3px)")} onPointerUp={(e) => { e.currentTarget.style.transform = ""; onAgain(); }}>↻ Hrát znovu</button>
    </div>
  );
}
