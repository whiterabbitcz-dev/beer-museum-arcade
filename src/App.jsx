import { useState, useEffect } from "react";
import Ledari from "./games/Ledari.jsx";
import Spiz from "./games/Spiz.jsx";
import Sudy from "./games/Sudy.jsx";

/*
  Pivní arkáda — rozcestník pro Czech Beer Museum (kiosek).
  stav: "menu" | "ledari" | "spiz" | "sudy". Klik na dlaždici otevře hru přes
  celou plochu; fixní "◀ Zpět" vlevo nahoře vrátí na menu. Hry samotné NEupravovány.
*/

const C = {
  bg: "#241405", bg2: "#34200C", panel: "#3E2810",
  brass: "#E0A745", gold: "#F5C542", foam: "#F5EFE0", cream: "#EFE3CE",
  ink: "#1A0E03", line: "rgba(245,239,224,0.14)",
};

const GAMES = [
  { id: "ledari", emoji: "🧊", name: "Ledaři", tag: "Naskladni led na léto", accent: "#4FD0E0", Comp: Ledari },
  { id: "spiz", emoji: "🧺", name: "Sládkova spíž", tag: "Spojuj suroviny", accent: "#F5C542", Comp: Spiz },
  { id: "sudy", emoji: "🛢️", name: "Bednářův sklep", tag: "Dokutálej sudy", accent: "#E0A745", Comp: Sudy },
];

export default function App() {
  const [view, setView] = useState("menu");
  const active = GAMES.find((g) => g.id === view);

  // idle reset zpět na rozcestník po 60 s nečinnosti (kiosek)
  useEffect(() => {
    if (view === "menu") return;
    let last = Date.now();
    const bump = () => (last = Date.now());
    window.addEventListener("pointerdown", bump, true);
    window.addEventListener("keydown", bump, true);
    const iv = setInterval(() => { if (Date.now() - last > 60000) setView("menu"); }, 1000);
    return () => {
      window.removeEventListener("pointerdown", bump, true);
      window.removeEventListener("keydown", bump, true);
      clearInterval(iv);
    };
  }, [view]);

  if (active) {
    const Game = active.Comp;
    return (
      <div style={{ position: "relative", flex: 1, minHeight: 0, height: "100%", width: "100%" }}>
        <Game />
        <button
          onPointerUp={() => setView("menu")}
          style={{
            position: "fixed", top: 10, left: 10, zIndex: 9999,
            display: "flex", alignItems: "center", gap: 6,
            fontFamily: "Inter, system-ui, sans-serif", fontWeight: 900, fontSize: 15,
            color: C.foam, background: "rgba(26,14,3,0.82)", backdropFilter: "blur(4px)",
            border: `1px solid ${C.line}`, borderRadius: 22, padding: "10px 16px",
            cursor: "pointer", touchAction: "manipulation", userSelect: "none",
            boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
          }}
        >◀ Zpět</button>
      </div>
    );
  }

  return (
    <div style={{
      flex: 1, minHeight: 0, height: "100%", width: "100%", overflow: "hidden",
      fontFamily: "Inter, system-ui, sans-serif", color: C.cream,
      background: `radial-gradient(120% 90% at 50% -10%, ${C.bg2}, ${C.bg} 62%)`,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "24px 18px", textAlign: "center",
    }}>
      <FontInject />
      <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 4 }}>🍺</div>
      <h1 style={{
        fontFamily: "Fraunces, Georgia, serif", fontWeight: 900, fontSize: 44, lineHeight: 1,
        color: C.foam, margin: "6px 0 2px",
      }}>Pivní arkáda</h1>
      <div style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 18, color: C.brass, marginBottom: 22 }}>
        Tři hry z pivovaru — vyber si
      </div>

      <div style={{
        width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 14,
      }}>
        {GAMES.map((g) => (
          <button
            key={g.id}
            onPointerUp={() => setView(g.id)}
            onPointerDown={(e) => (e.currentTarget.style.transform = "translateY(2px)")}
            onPointerLeave={(e) => (e.currentTarget.style.transform = "")}
            style={{
              display: "flex", alignItems: "center", gap: 18, textAlign: "left",
              width: "100%", padding: "20px 22px", borderRadius: 20, cursor: "pointer",
              touchAction: "manipulation", userSelect: "none",
              color: C.cream,
              background: `linear-gradient(160deg, ${C.panel}, rgba(0,0,0,0.28))`,
              border: `1px solid ${C.line}`, borderLeft: `5px solid ${g.accent}`,
              boxShadow: "0 6px 0 rgba(0,0,0,0.3), 0 12px 26px rgba(0,0,0,0.4)",
              transition: "transform .06s",
            }}
          >
            <span style={{ fontSize: 46, lineHeight: 1, flexShrink: 0 }}>{g.emoji}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{
                display: "block", fontFamily: "Fraunces, Georgia, serif", fontWeight: 900,
                fontSize: 24, color: C.foam, lineHeight: 1.1,
              }}>{g.name}</span>
              <span style={{ display: "block", fontSize: 15, color: "rgba(239,227,206,0.72)", marginTop: 3 }}>
                {g.tag}
              </span>
            </span>
            <span style={{ marginLeft: "auto", fontSize: 26, color: g.accent, flexShrink: 0 }}>▸</span>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 24, fontSize: 12, color: "rgba(239,227,206,0.4)", letterSpacing: 1 }}>
        Czech Beer Museum Prague
      </div>
    </div>
  );
}

// Rozcestník si fonty injectuje sám (hry to dělají taky, až se otevřou).
function FontInject() {
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Inter:wght@600;700;900&display=swap";
    document.head.appendChild(l);
    return () => { try { document.head.removeChild(l); } catch (e) { /* noop */ } };
  }, []);
  return null;
}
