import { useState, useEffect, useRef, useCallback } from "react";

/*
  LEDAŘI — sklizeň ledu pro Czech Beer Museum (samostatná hra, ne součást Mistra Sládka)
  Tetris na řece: shora vidíš Vltavu, po proudu plují kry ledu (tetromina). Otáčíš a
  posouváš je, ať těsně zapadnou do skladu ledu. Plná řada se zapečetí (zmizí). Méně
  mezer = víc chladu. Příběh: než byly lednice, pivovary řezaly v zimě led z řek a
  skladovaly ho ve sklepích, aby udržely ležáky studené celé léto → proto "ležák".

  Tok: attract → instrukce → countdown → hra (90 s nebo zaplnění) → výsledek
  Stejná rodina jako Mistr Sládek (Sfx, intro, countdown, result), studená paleta.
*/

const C = {
  bg: "#08151F", bg2: "#0E2436", water: "#10314A", waterHi: "#16415F",
  ink: "#06121C", frost: "#EAF6FB", cyan: "#4FD0E0", ice: "#7FC4DE",
  brass: "#E0A745", gold: "#F5C542", cream: "#E8F1F6", green: "#7FB04A",
  wrong: "#D96A4A", line: "rgba(234,246,251,0.14)",
};

// tetromino tvary (kry ledu) + barvy
const PIECES = [
  { m: [[1, 1, 1, 1]], c: "#6FD3E8" },                 // I
  { m: [[1, 1], [1, 1]], c: "#9FE0F0" },               // O
  { m: [[0, 1, 0], [1, 1, 1]], c: "#56B8DA" },         // T
  { m: [[0, 1, 1], [1, 1, 0]], c: "#74D6C4" },         // S
  { m: [[1, 1, 0], [0, 1, 1]], c: "#5FB0E0" },         // Z
  { m: [[1, 0, 0], [1, 1, 1]], c: "#6FA8E6" },         // J
  { m: [[0, 0, 1], [1, 1, 1]], c: "#8FC8E8" },         // L
];

const COLS = 9, ROWS = 16, GAME_SECONDS = 90;

function rotateCW(m) {
  const R = m.length, Cc = m[0].length;
  const out = Array.from({ length: Cc }, () => Array(R).fill(0));
  for (let r = 0; r < R; r++) for (let c = 0; c < Cc; c++) out[c][R - 1 - r] = m[r][c];
  return out;
}

// ---------- procedural Web Audio ----------
const Sfx = (() => {
  let ctx = null, master = null, enabled = true;
  const ensure = () => {
    if (typeof window === "undefined") return;
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.32; master.connect(ctx.destination); }
    if (ctx.state === "suspended") ctx.resume();
  };
  const tone = (f, dur, type = "sine", vol = 0.3, slide) => {
    if (!enabled || !ctx) return; const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, ctx.currentTime); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(1, slide), ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur);
  };
  const noise = (dur, vol = 0.3, f = 1000, type = "highpass") => {
    if (!enabled || !ctx) return; const n = ctx.createBufferSource(); const buf = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; n.buffer = buf;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    n.connect(fl); fl.connect(g); g.connect(master); n.start(); n.stop(ctx.currentTime + dur);
  };
  return {
    resume: ensure, setEnabled: (v) => { enabled = v; }, isEnabled: () => enabled,
    click: () => tone(660, 0.06, "square", 0.16),
    beep: (hi) => tone(hi ? 820 : 540, 0.12, "square", 0.25),
    move: () => tone(420, 0.04, "square", 0.12),
    rotate: () => tone(620, 0.06, "triangle", 0.16, 760),
    drop: () => { tone(180, 0.12, "sawtooth", 0.25, 70); noise(0.1, 0.14, 600); },
    seal: () => { [600, 760, 920].forEach((f, i) => setTimeout(() => tone(f, 0.14, "triangle", 0.26), i * 50)); noise(0.18, 0.16, 2400); },
    fail: () => tone(150, 0.4, "sawtooth", 0.22, 60),
    win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.24, "triangle", 0.28), i * 95)),
  };
})();

function useShake() {
  const ref = useRef(null);
  const shake = useCallback(() => { const el = ref.current; if (!el) return; el.classList.remove("shk"); void el.offsetWidth; el.classList.add("shk"); }, []);
  return [ref, shake];
}

// ===================================================================
export default function Ledari() {
  const [phase, setPhase] = useState("attract"); // attract | intro | countdown | play | result
  const [muted, setMuted] = useState(false);
  const [final, setFinal] = useState({ lines: 0, score: 0, cold: 0 });

  useEffect(() => {
    const l = document.createElement("link"); l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Inter:wght@600;700;900&display=swap";
    document.head.appendChild(l); return () => { try { document.head.removeChild(l); } catch (e) {} };
  }, []);

  // idle reset
  useEffect(() => {
    if (phase === "attract") return;
    let last = Date.now(); const bump = () => (last = Date.now());
    window.addEventListener("pointerdown", bump, true);
    const iv = setInterval(() => { if (Date.now() - last > 30000) setPhase("attract"); }, 1000);
    return () => { window.removeEventListener("pointerdown", bump, true); clearInterval(iv); };
  }, [phase]);

  const toggleMute = () => setMuted((m) => { const nm = !m; Sfx.setEnabled(!nm); if (!nm) Sfx.resume(); return nm; });

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", height: "100%", minHeight: 560, width: "100%", background: `radial-gradient(130% 90% at 50% -10%, ${C.bg2}, ${C.bg} 65%)`, color: C.cream, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
      <GlobalCSS />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: `1px solid ${C.line}`, zIndex: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 20 }}>🧊</span>
          <span style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 17, color: C.cyan }}>Ledaři</span>
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
    @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
    @keyframes shk{0%,100%{transform:translate(0,0)}15%{transform:translate(-7px,3px)}40%{transform:translate(7px,-3px)}65%{transform:translate(-5px,2px)}85%{transform:translate(5px,-1px)}}
    .shk{animation:shk .4s ease-in-out}
  `}</style>;
}

function bigBtn(extra = {}) {
  return { fontFamily: "Inter, sans-serif", fontWeight: 900, fontSize: 18, letterSpacing: 0.3, padding: "16px 32px", borderRadius: 16, border: "none", cursor: "pointer", background: `linear-gradient(180deg, ${C.cyan}, #2E9CB4)`, color: C.ink, boxShadow: "0 6px 0 rgba(0,0,0,0.35), 0 12px 24px rgba(0,0,0,0.45)", touchAction: "manipulation", userSelect: "none", ...extra };
}

function Attract({ onStart }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 26 }}>
      <div style={{ fontSize: 84, animation: "bob 3s ease-in-out infinite" }}>🧊</div>
      <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 54, lineHeight: 1, color: C.frost }}>Ledaři</div>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: 21, color: C.cyan, marginTop: 8 }}>Naskladni led na celé léto</div>
      <div style={{ maxWidth: 340, color: "rgba(232,241,246,0.7)", marginTop: 12, fontSize: 15 }}>
        Po řece plují kry ledu. Otáčej je a skládej těsně k sobě — sklep musí udržet ležáky studené až do podzimu.
      </div>
      <button style={bigBtn({ marginTop: 28, fontSize: 20 })} onPointerDown={(e) => (e.currentTarget.style.transform = "translateY(3px)")} onPointerUp={(e) => { e.currentTarget.style.transform = ""; onStart(); }}>🧊 Začít sklízet led</button>
    </div>
  );
}

function Intro({ onBegin }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ textAlign: "center", maxWidth: 460, animation: "pop .3s" }}>
        <div style={{ fontSize: 60 }}>🧊</div>
        <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 26, color: C.frost }}>Jak na to</div>
        <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: 14, padding: "16px 18px", margin: "14px 0", fontSize: 16, lineHeight: 1.55, textAlign: "left", borderLeft: `3px solid ${C.cyan}` }}>
          Kry ledu plují <b>shora po proudu dolů</b>. Tlačítky je <b>posouvej</b> ◀ ▶, <b>otáčej</b> ⟳ a <b>spusť dolů</b> ⬇.
          Skládej je těsně k sobě — <b>plná řada se zapečetí</b> a zmizí. Čím míň mezer, tím víc chladu.
        </div>
        <button style={bigBtn({ fontSize: 19 })} onPointerDown={(e) => (e.currentTarget.style.transform = "translateY(3px)")} onPointerUp={(e) => { e.currentTarget.style.transform = ""; onBegin(); }}>Jdeme! ▸</button>
      </div>
    </div>
  );
}

function Countdown({ onGo }) {
  const [n, setN] = useState(3);
  useEffect(() => {
    Sfx.beep(false); let cur = 3;
    const iv = setInterval(() => { cur -= 1; if (cur > 0) { setN(cur); Sfx.beep(false); } else if (cur === 0) { setN(0); Sfx.beep(true); } else { clearInterval(iv); onGo(); } }, 750);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div key={n} style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: n > 0 ? 130 : 80, color: n > 0 ? C.cyan : C.frost, animation: "cd .75s ease-out", lineHeight: 1 }}>{n > 0 ? n : "START!"}</div>
    </div>
  );
}

// ---------- GAME ----------
function Game({ onEnd }) {
  const [shakeRef, shake] = useShake();
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [hud, setHud] = useState({ time: GAME_SECONDS, score: 0, cold: 0 });

  // mutable game state
  const g = useRef(null);

  const spawn = (st) => {
    const p = PIECES[(Math.random() * PIECES.length) | 0];
    const m = p.m.map((row) => row.slice());
    const piece = { m, c: p.c, x: ((COLS - m[0].length) / 2) | 0, y: 0 };
    if (collide(st.board, piece, 0, 0)) st.over = true;
    st.piece = piece;
  };
  const collide = (board, piece, dx, dy, mm) => {
    const m = mm || piece.m;
    for (let r = 0; r < m.length; r++) for (let c = 0; c < m[0].length; c++) {
      if (!m[r][c]) continue;
      const nx = piece.x + c + dx, ny = piece.y + r + dy;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
    return false;
  };
  const merge = (st) => {
    const { board, piece } = st;
    piece.m.forEach((row, r) => row.forEach((v, c) => { if (v) { const y = piece.y + r, x = piece.x + c; if (y >= 0) board[y][x] = piece.c; } }));
  };
  const clearLines = (st) => {
    const { board } = st; let cleared = [];
    for (let r = 0; r < ROWS; r++) if (board[r].every((v) => v)) cleared.push(r);
    if (!cleared.length) return 0;
    // frost particles
    cleared.forEach((r) => { for (let i = 0; i < 14; i++) st.parts.push({ x: Math.random() * st.boardW + st.ox, y: st.oy + r * st.cell + st.cell / 2, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, life: 1 }); });
    st.flash.push({ rows: cleared.slice(), t: performance.now() });
    cleared.forEach((r) => { board.splice(r, 1); board.unshift(Array(COLS).fill(0)); });
    return cleared.length;
  };
  const lockPiece = (st) => {
    merge(st); Sfx.drop();
    const n = clearLines(st);
    if (n) {
      Sfx.seal(); shake();
      st.lines += n;
      st.score += [0, 100, 300, 600, 1000][n];
      st.cold = Math.min(100, st.cold + n * 7);
    }
    spawn(st);
  };

  const move = (dx) => { const st = g.current; if (!st || st.over || st.paused) return; if (!collide(st.board, st.piece, dx, 0)) { st.piece.x += dx; Sfx.move(); } };
  const rot = () => {
    const st = g.current; if (!st || st.over || st.paused) return;
    const nm = rotateCW(st.piece.m);
    for (const k of [0, -1, 1, -2, 2]) { if (!collide(st.board, st.piece, k, 0, nm)) { st.piece.m = nm; st.piece.x += k; Sfx.rotate(); return; } }
  };
  const hardDrop = () => {
    const st = g.current; if (!st || st.over || st.paused) return;
    let d = 0; while (!collide(st.board, st.piece, 0, d + 1)) d++;
    st.piece.y += d; lockPiece(st);
  };

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current, ctx = canvas.getContext("2d");
    const st = {
      board: Array.from({ length: ROWS }, () => Array(COLS).fill(0)),
      piece: null, parts: [], flash: [], lines: 0, score: 0, cold: 0,
      over: false, run: true, cell: 20, ox: 0, oy: 0, boardW: 0, boardH: 0,
    };
    g.current = st;
    spawn(st);

    let W = 0, H = 0;
    const resize = () => {
      W = wrap.clientWidth; H = wrap.clientHeight; canvas.width = W; canvas.height = H;
      st.cell = Math.floor(Math.min(W / COLS, H / ROWS));
      st.boardW = st.cell * COLS; st.boardH = st.cell * ROWS;
      st.ox = Math.floor((W - st.boardW) / 2); st.oy = Math.floor((H - st.boardH) / 2);
    };
    resize(); window.addEventListener("resize", resize);

    const drawCell = (x, y, color) => {
      const cs = st.cell, px = st.ox + x * cs, py = st.oy + y * cs;
      ctx.fillStyle = color; roundRect(ctx, px + 1, py + 1, cs - 2, cs - 2, 4); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)"; roundRect(ctx, px + 3, py + 3, cs - 6, (cs - 6) * 0.4, 3); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1; roundRect(ctx, px + 1, py + 1, cs - 2, cs - 2, 4); ctx.stroke();
    };

    let t0 = performance.now(), prev = t0, grav = 0, raf;
    const loop = (t) => {
      if (!st.run) return;
      const dt = t - prev; prev = t;
      const elapsed = (t - t0) / 1000; const left = Math.max(0, GAME_SECONDS - elapsed);
      const dropInt = Math.max(220, 720 - elapsed * 5); // zrychluje proud
      if (!st.over) { grav += dt; if (grav >= dropInt) { grav = 0; if (!collide(st.board, st.piece, 0, 1)) st.piece.y += 1; else lockPiece(st); } }

      // particles
      st.parts.forEach((p) => { p.x += p.vx; p.y += p.vy; p.life -= 0.04; });
      st.parts = st.parts.filter((p) => p.life > 0);
      st.flash = st.flash.filter((f) => t - f.t < 220);

      // ---- draw ----
      ctx.clearRect(0, 0, W, H);
      // river water bg + current
      ctx.fillStyle = C.water; ctx.fillRect(st.ox, st.oy, st.boardW, st.boardH);
      ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) { const yy = st.oy + ((elapsed * 30 + i * st.boardH / 6) % st.boardH); ctx.beginPath(); ctx.moveTo(st.ox, yy); ctx.lineTo(st.ox + st.boardW, yy); ctx.stroke(); }
      // frame
      ctx.strokeStyle = "rgba(234,246,251,0.25)"; ctx.lineWidth = 2; ctx.strokeRect(st.ox, st.oy, st.boardW, st.boardH);

      // settled
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (st.board[r][c]) drawCell(c, r, st.board[r][c]);
      // current piece + ghost
      if (st.piece && !st.over) {
        let gd = 0; while (!collide(st.board, st.piece, 0, gd + 1)) gd++;
        st.piece.m.forEach((row, r) => row.forEach((v, c) => {
          if (!v) return; const x = st.piece.x + c;
          // ghost
          const gy = st.piece.y + r + gd; if (gy >= 0) { ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1; roundRect(ctx, st.ox + x * st.cell + 2, st.oy + gy * st.cell + 2, st.cell - 4, st.cell - 4, 4); ctx.stroke(); }
          const y = st.piece.y + r; if (y >= 0) drawCell(x, y, st.piece.c);
        }));
      }
      // flash sealed rows
      st.flash.forEach((f) => { const a = 1 - (t - f.t) / 220; ctx.fillStyle = `rgba(255,255,255,${a * 0.8})`; f.rows.forEach((r) => ctx.fillRect(st.ox, st.oy + r * st.cell, st.boardW, st.cell)); });
      // particles
      st.parts.forEach((p) => { ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = C.frost; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill(); });
      ctx.globalAlpha = 1;

      // HUD update (throttled)
      const sec = Math.ceil(left);
      if (sec !== hudRef.current.time || st.score !== hudRef.current.score || st.cold !== hudRef.current.cold) {
        hudRef.current = { time: sec, score: st.score, cold: st.cold }; setHud(hudRef.current);
      }

      if (left <= 0 || st.over) {
        st.run = false; if (st.over) Sfx.fail(); else Sfx.win();
        setTimeout(() => onEnd({ lines: st.lines, score: st.score, cold: st.cold, over: st.over }), 350);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    const hudRef = { current: { time: GAME_SECONDS, score: 0, cold: 0 } };
    raf = requestAnimationFrame(loop);
    return () => { st.run = false; cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []); // eslint-disable-line

  // hold-repeat for left/right
  const holdRef = useRef(null);
  const startHold = (fn) => { fn(); clearInterval(holdRef.current); holdRef.current = setInterval(fn, 110); };
  const endHold = () => { clearInterval(holdRef.current); holdRef.current = null; };
  useEffect(() => () => clearInterval(holdRef.current), []);

  const ctrlBtn = (label, handlers, big) => (
    <button {...handlers} style={{
      flex: big ? 1.4 : 1, height: 64, borderRadius: 14, border: `1px solid ${C.line}`,
      background: "linear-gradient(180deg, rgba(79,208,224,0.2), rgba(0,0,0,0.25))",
      color: C.frost, fontSize: 28, fontWeight: 900, cursor: "pointer", touchAction: "none",
      boxShadow: "0 4px 0 rgba(0,0,0,0.3)", userSelect: "none",
    }}>{label}</button>
  );

  return (
    <div ref={shakeRef} style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "8px 12px 12px" }}>
      {/* HUD */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "2px 4px 8px" }}>
        <div style={{ fontWeight: 900, fontSize: 18, color: hud.time <= 10 ? C.wrong : C.frost }}>⏱ {hud.time}s</div>
        <div style={{ fontWeight: 900, fontSize: 16, color: C.cyan }}>{hud.score}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: "rgba(232,241,246,0.6)", marginBottom: 2 }}>CHLAD ❄️</div>
          <div style={{ height: 10, borderRadius: 6, background: "rgba(0,0,0,0.35)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${hud.cold}%`, background: `linear-gradient(90deg, ${C.cyan}, ${C.frost})`, transition: "width .3s" }} />
          </div>
        </div>
        <div style={{ fontWeight: 900, color: C.frost }}>{hud.cold}%</div>
      </div>
      {/* board */}
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
      {/* controls */}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {ctrlBtn("◀", { onPointerDown: (e) => { e.preventDefault(); startHold(() => move(-1)); }, onPointerUp: endHold, onPointerLeave: endHold, onPointerCancel: endHold })}
        {ctrlBtn("⟳", { onPointerDown: (e) => { e.preventDefault(); rot(); } }, false)}
        {ctrlBtn("▶", { onPointerDown: (e) => { e.preventDefault(); startHold(() => move(1)); }, onPointerUp: endHold, onPointerLeave: endHold, onPointerCancel: endHold })}
        {ctrlBtn("⬇", { onPointerDown: (e) => { e.preventDefault(); hardDrop(); } }, true)}
      </div>
    </div>
  );
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2); ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function Result({ final, onAgain }) {
  useEffect(() => { Sfx.win(); }, []); // eslint-disable-line
  const cold = final.cold || 0;
  const ranks = [
    { min: 90, name: "Ledový mistr", note: "Sklep vydrží studený až do podzimu. Ležáky jásají." },
    { min: 70, name: "Zkušený ledař", note: "Pěkně naskladněno. Léto pivo přečká v pohodě." },
    { min: 45, name: "Pomocník u řeky", note: "Něco se rozteče, ale na pár várek to stačí." },
    { min: 0, name: "Bruslař", note: "Tohle léto bude pivo spíš teplý. Zkus to znovu!" },
  ];
  const rank = ranks.find((r) => cold >= r.min);
  const col = cold >= 70 ? C.green : cold >= 45 ? C.gold : C.wrong;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 26 }}>
      <div style={{ fontSize: 14, color: C.cyan, letterSpacing: 2, fontWeight: 800 }}>SKLEP PŘIPRAVEN NA LÉTO</div>
      <div style={{ fontSize: 74, margin: "6px 0", animation: "pop .4s" }}>🧊</div>
      <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 44, color: col, lineHeight: 1 }}>{rank.name}</div>
      <div style={{ fontSize: 50, fontWeight: 900, color: col }}>{cold}% chladu</div>
      <div style={{ fontSize: 14, color: "rgba(232,241,246,0.7)", marginTop: 2 }}>Skóre {final.score} · {final.lines} řad</div>
      <div style={{ maxWidth: 380, color: "rgba(232,241,246,0.78)", marginTop: 8, fontSize: 15 }}>{rank.note}</div>
      <div style={{ maxWidth: 400, background: "rgba(0,0,0,0.25)", borderRadius: 12, padding: "12px 16px", margin: "16px 0 0", fontSize: 13.5, lineHeight: 1.5, textAlign: "left", borderLeft: `3px solid ${C.cyan}` }}>
        <b style={{ color: C.cyan }}>Věděl jsi?</b> Než byly lednice, pivovary v zimě řezaly led z řek a skladovaly ho v izolovaných sklepích. Díky tomu udržely pivo studené celé léto — a právě z toho „ležení" za studena vznikl <b>ležák</b>.
      </div>
      <button style={bigBtn({ marginTop: 22, fontSize: 19 })} onPointerDown={(e) => (e.currentTarget.style.transform = "translateY(3px)")} onPointerUp={(e) => { e.currentTarget.style.transform = ""; onAgain(); }}>↻ Hrát znovu</button>
    </div>
  );
}
