"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

type Card = { id: string; rank: number; suit: string };
type Player = { id: string; name: string; hand?: Card[]; handCount?: number; finishedAt?: number; isYou?: boolean };
type StateView = {
  status: string;
  players: Player[];
  currentPlayerId: string | null;
  you: Player | null;
  tableCount: number;
  topCard: Card | null;
  discardCount: number;
  drawCount: number;
  winners: string[];
  skipNext: boolean;
  le7Active: boolean;
  threshold: number;
  lastMove: any;
};

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomId, setRoomId] = useState("table-1");
  const [name, setName] = useState("P1");
  const [state, setState] = useState<StateView | null>(null);
  const [card, setCard] = useState<number>(7);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const s = io("http://localhost:3001");
    s.on("connect", () => {
      s.emit("join", roomId, name);
    });
    s.on("state", (st: StateView) => {
      setState(st);
      setError("");
    });
    s.on("error", (msg: string) => setError(String(msg)));
    setSocket(s);
    return () => { s.disconnect(); };
  }, [roomId, name]);

  const play = () => socket?.emit("play", roomId, { card });
  const pickup = () => socket?.emit("play", roomId, "pickup");

  return (
    <main style={{ padding: 20, fontFamily: "sans-serif", maxWidth: 800 }}>
      <h1>Bataille Norvégienne — MVP</h1>

      <div style={{ display: "flex", gap: 12, margin: "12px 0" }}>
        <label>Room: <input value={roomId} onChange={e => setRoomId(e.target.value)} /></label>
        <label>Nom: <input value={name} onChange={e => setName(e.target.value)} /></label>
      </div>

      <div style={{ margin: "12px 0" }}>
        <label>Carte à jouer (2..14): </label>
        <input
          type="number"
          min={2}
          max={14}
          value={card}
          onChange={e => setCard(parseInt(e.target.value || "0", 10))}
          style={{ width: 80 }}
        />
        <button onClick={play} style={{ marginLeft: 8 }}>Jouer</button>
        <button onClick={pickup} style={{ marginLeft: 8 }}>Ramasser</button>
      </div>

      {error && <p style={{ color: "red" }}>Erreur: {error}</p>}

      <hr />

      <pre style={{ background: "#f6f6f6", padding: 12, borderRadius: 8 }}>
        {JSON.stringify(state, null, 2)}
      </pre>

      {state?.you?.hand && (
        <p>Ta main: {state.you.hand.map((c: Card) => `${c.rank}${c.suit}`).join(" , ")}</p>
      )}
      <p>Top: {state?.topCard ? `${state.topCard.rank}${state.topCard.suit}` : "(vide)"}</p>
      <p>Joueur courant: {state?.currentPlayerId}</p>
    </main>
  );
}
