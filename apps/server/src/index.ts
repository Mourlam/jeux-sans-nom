import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

// 🔽 on importe la lib DU PAQUET (pas via ../../src/engine)
import type { State, ClientAction, Card } from "game-engine";
import { createGame, applyAction, getView } from "game-engine";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

// État des salles : roomId -> State du moteur
type RoomState = Record<string, State>;
const rooms: RoomState = {};

// Crée la salle si elle n’existe pas (le moteur exige 2 joueurs min)
function ensureRoom(roomId: string, socketId: string, playerName = "P") {
  if (!rooms[roomId]) {
    rooms[roomId] = createGame({
      players: [
        { id: socketId, name: playerName },
        { id: "guest", name: "Guest" }, // placeholder simple pour démarrer
      ],
    });
  }
}

io.on("connection", (socket) => {
  // Un client rejoint une room
  socket.on("join", (roomId: string, playerName = "P") => {
    ensureRoom(roomId, socket.id, playerName);
    socket.join(roomId);

    // Vue personnalisée pour CE joueur
    socket.emit("state", getView(rooms[roomId], socket.id));
  });

  /**
   * Adapter des mouvements :
   * - si tu envoies déjà { kind: "play", cardIds: string[] } | { kind: "pickup" },
   *   on les relaie tels quels.
   * - si tu envoies encore { card: number }, on choisit une carte de ce rang
   *   dans ta main et on construit { kind: "play", cardIds: [...] }.
   */
  socket.on("play", (roomId: string, move: any) => {
    const S = rooms[roomId];
    if (!S) return;

    let action: ClientAction | null = null;

    // 1) action complète du moteur
    if (move && typeof move === "object" && "kind" in move) {
      action = move as ClientAction;

    // 2) pickup abrégé
    } else if (move === "pickup" || (move && move.pickup)) {
      action = { kind: "pickup" };

    // 3) ancien format { card: number } -> on joue UNE carte de ce rang
    } else if (move && typeof move.card === "number") {
      // On essaie d’abord si c’est bien TON tour
      const current = S.players[S.current];
      let candidate: Card | undefined;

      if (current && current.id === socket.id) {
        candidate = current.hand.find((c) => c.rank === move.card);
      }
      // sinon, on essaie quand même dans ta main (au cas où)
      if (!candidate) {
        const you = S.players.find((p) => p.id === socket.id);
        candidate = you?.hand.find((c) => c.rank === move.card);
      }

      if (candidate) {
        action = { kind: "play", cardIds: [candidate.id] };
      }
    }

    if (!action) {
      socket.emit("error", "Coup invalide : envoie {kind:'play'| 'pickup'} ou {card:number}.");
      return;
    }

    // Appliquer l’action pour CE joueur
    rooms[roomId] = applyAction(S, socket.id, action);

    // Diffuser une vue adaptée à chaque joueur présent dans la room
    const clients = io.sockets.adapter.rooms.get(roomId);
    if (clients) {
      for (const clientId of clients) {
        io.to(clientId).emit("state", getView(rooms[roomId], clientId));
      }
    } else {
      // fallback
      io.to(roomId).emit("state", getView(rooms[roomId], socket.id));
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log("Server listening on " + PORT);
});
