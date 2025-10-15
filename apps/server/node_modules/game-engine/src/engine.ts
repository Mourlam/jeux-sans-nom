/* -------------------------------------------------------
 * Bataille Norvégienne — Moteur complet (règles custom)
 * -------------------------------------------------------
 * Contraintes & règles données :
 * - 2 à 4 joueurs max
 * - Seuil de départ = 2
 * - Valet (11) : reset au Valet → threshold = 11
 * - 2 : reset à 2 → threshold = 2
 * - 7 : prochain coup doit être ≤ 7 ET effets spéciaux annulés pour ce coup
 * - 8 : prochain joueur passe (sauf si coup sous contrainte ≤7)
 * - 10 : brûle et le joueur rejoue (sauf si coup sous contrainte ≤7)
 * - 4 cartes de même rang consécutives sur la pile : brûle et le joueur rejoue (sauf si ≤7)
 * - Si tu ne peux pas jouer : tu ramasses et tu rejoues (ton tour continue)
 * - À chaque action : si main < 3 → piocher jusqu'à 3 (si pioche dispo). Si >3, ne pas piocher.
 */

export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; // 11=J, 12=Q, 13=K, 14=A
export type Suit = "♠" | "♥" | "♦" | "♣";

export interface Card {
  id: string;   // unique
  rank: Rank;
  suit: Suit;
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  finishedAt?: number;
}

export type GameStatus = "lobby" | "playing" | "finished";

export interface State {
  status: GameStatus;
  players: Player[];
  current: number;          // index joueur courant
  drawPile: Card[];
  tablePile: Card[];
  discardPile: Card[];
  winners: string[];        // ids dans l'ordre
  skipNext: boolean;        // dû à 8
  le7Active: boolean;       // contrainte "≤7 pour le prochain coup" (et effets annulés)
  threshold: Rank;          // seuil minimal en mode normal (>= threshold)
  lastMove?: MoveResult;
  seed?: number;
}

export type ClientAction =
  | { kind: "play"; cardIds: string[] }  // 1..n cartes, même rang
  | { kind: "pickup" };                  // ramasse la pile et rejoue

export interface MoveResult {
  playerId: string;
  played: Card[];            // vide si pickup
  burned: boolean;
  replay: boolean;           // le joueur rejoue (10 ou 4-of-a-kind)
  skipApplied: boolean;      // 8 utilisé (si non annulé)
  le7Set: boolean;           // 7 posé
  specialsSuppressed: boolean; // ce coup était sous ≤7 (effets annulés)
  threshold: Rank;
  pickedUp: boolean;
}

// -------------------------------------------------------
// Utils
// -------------------------------------------------------

const suits: Suit[] = ["♠", "♥", "♦", "♣"];
let uidCounter = 0;
const uid = () => String(++uidCounter);

export const makeDeck = (): Card[] => {
  const deck: Card[] = [];
  for (const s of suits) {
    for (let r = 2; r <= 14; r++) {
      deck.push({ id: `${r}${s}-${uid()}`, rank: r as Rank, suit: s });
    }
  }
  return deck;
};

const shuffle = (arr: Card[], seed?: number): Card[] => {
  const a = arr.slice();
  let random = Math.random;
  if (typeof seed === "number") {
    let x = Math.sin(seed) * 10000;
    random = () => {
      x = Math.sin(x) * 10000;
      return x - Math.floor(x);
    };
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    // évite Card|undefined en strict
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
};

const top = <T>(arr: T[]): T | undefined => arr[arr.length - 1];
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function rankName(r: Rank): string {
  switch (r) {
    case 11: return "Valet";
    case 12: return "Dame";
    case 13: return "Roi";
    case 14: return "As";
    default: return String(r);
  }
}

const allSameRank = (cards: Card[]) => {
  if (cards.length === 0) return false;
  const first = cards[0]!.rank;
  return cards.every((c) => c.rank === first);
};

// compléter la main à min 3 cartes (si pioche dispo)
const topUpTo3 = (S: State, P: Player) => {
  while (P.hand.length < 3 && S.drawPile.length > 0) {
    P.hand.push(S.drawPile.pop()!);
  }
};

// 4 cartes de même rang au sommet de la pile ?
const fourOfKindOnTop = (pile: Card[]): boolean => {
  if (pile.length < 4) return false;
  const a = pile[pile.length - 1]!;
  const b = pile[pile.length - 2]!;
  const c = pile[pile.length - 3]!;
  const d = pile[pile.length - 4]!;
  return a.rank === b.rank && b.rank === c.rank && c.rank === d.rank;
};

// -------------------------------------------------------
// Création et démarrage
// -------------------------------------------------------

export const createGame = (opts: {
  players: { id: string; name: string }[];
  seed?: number;
}): State => {
  if (opts.players.length < 2 || opts.players.length > 4) {
    throw new Error("Le nombre de joueurs doit être compris entre 2 et 4.");
  }
  const deck = shuffle(makeDeck(), opts.seed);

  const players: Player[] = opts.players.map((p) => ({
    id: p.id,
    name: p.name,
    hand: [],
  }));

  // distribution initiale : 3 cartes chacun (puis on complètera à 3 au début de chaque action)
  const draw = deck.slice();
  for (let r = 0; r < 3; r++) {
    for (const pl of players) {
      const c = draw.pop();
      if (c) pl.hand.push(c);
    }
  }

  const S: State = {
    status: "playing",
    players,
    current: 0,
    drawPile: draw,
    tablePile: [],
    discardPile: [],
    winners: [],
    skipNext: false,
    le7Active: false,
    threshold: 2,
    seed: opts.seed ?? Date.now(),
  };

  return S;
};

// -------------------------------------------------------
// Légalité d’un set
// -------------------------------------------------------

const canPlaySet = (S: State, P: Player, cards: Card[]): string | null => {
  if (cards.length === 0) return "Aucune carte sélectionnée.";
  if (!allSameRank(cards)) return "Toutes les cartes jouées doivent être du même rang.";

  // cartes doivent appartenir au joueur
  const own = new Set(P.hand.map((c) => c.id));
  for (const c of cards) if (!own.has(c.id)) return "Carte non possédée.";

  const r = cards[0]!.rank;

  if (S.le7Active) {
    // Sous contrainte ≤7 : seules cartes de rang ≤7 autorisées, effets spéciaux annulés
    if (r > 7) return "Sous contrainte ≤7 : vous devez jouer une carte de rang ≤ 7.";
    return null;
  }

  // Mode normal (pas de ≤7)
  const topCard = top(S.tablePile);
  const required = Math.max(S.threshold, topCard ? topCard.rank : S.threshold) as Rank;
  if (r < required) {
    return `Vous devez jouer ≥ ${rankName(required)} (top ${
      topCard ? rankName(topCard.rank) : rankName(S.threshold)
    }).`;
  }
  return null;
};

// -------------------------------------------------------
// Vues & aides
// -------------------------------------------------------

export const getView = (S: State, viewerId: string) => {
  const youIdx = S.players.findIndex((p) => p.id === viewerId);
  const players = S.players.map((p, i) => ({
    id: p.id,
    name: p.name,
    handCount: p.hand.length,
    isYou: i === youIdx,
    finishedAt: p.finishedAt,
  }));

  return {
    status: S.status,
    players,
    currentPlayerId: S.players[S.current]?.id ?? null,
    you: youIdx >= 0 ? clone(S.players[youIdx]) : null,
    tableCount: S.tablePile.length,
    topCard: top(S.tablePile) ?? null,
    discardCount: S.discardPile.length,
    drawCount: S.drawPile.length,
    winners: S.winners.slice(),
    skipNext: S.skipNext,
    le7Active: S.le7Active,
    threshold: S.threshold,
    lastMove: S.lastMove ?? null,
  };
};

// Renvoie des propositions de sets jouables (ids) regroupées par rang
export const getLegalMoves = (S: State, playerId: string): string[][] => {
  const P = S.players[S.current];
  if (!P || P.id !== playerId) return [];

  const byRank = new Map<Rank, Card[]>();
  for (const c of P.hand) {
    const arr = byRank.get(c.rank) ?? [];
    arr.push(c);
    byRank.set(c.rank, arr);
  }

  const legal: string[][] = [];
  for (const [, arr] of byRank) {
    // tester 1..n cartes de ce rang
    for (let n = 1; n <= arr.length; n++) {
      const subset = arr.slice(0, n);
      const err = canPlaySet(S, P, subset);
      if (!err) legal.push(subset.map((c) => c.id));
    }
  }
  return legal;
};

// -------------------------------------------------------
// Application d’une action
// -------------------------------------------------------

export const applyAction = (S: State, playerId: string, action: ClientAction): State => {
  if (S.status !== "playing") return S;

  const idx = S.players.findIndex((p) => p.id === playerId);
  if (idx === -1 || idx !== S.current) return S;

  const P = S.players[idx];
  if (!P) return S;

  // Règle de pioche : avant CHAQUE action, si main < 3 → piocher jusqu'à 3
  topUpTo3(S, P);

  // Action PICKUP
  if (action.kind === "pickup") {
    if (S.tablePile.length === 0) return S; // rien à ramasser
    P.hand.push(...S.tablePile);
    S.tablePile = [];
    // La contrainte ≤7 est consommée (quelque soit l'action), et on rejoue
    const specialsSuppressed = S.le7Active;
    S.le7Active = false;

    S.lastMove = {
      playerId,
      played: [],
      burned: false,
      replay: true,             // on rejoue après avoir ramassé
      skipApplied: false,
      le7Set: false,
      specialsSuppressed,
      threshold: S.threshold,
      pickedUp: true,
    };
    // On NE change PAS de joueur (rejoue)
    return S;
  }

  // Action PLAY
  const cards = action.cardIds
    .map((id) => P.hand.find((c) => c.id === id))
    .filter(Boolean) as Card[];

  const err = canPlaySet(S, P, cards);
  if (err) return S;

  // Retirer les cartes de la main
  const idSet = new Set(action.cardIds);
  P.hand = P.hand.filter((c) => !idSet.has(c.id));

  // Poser sur la table
  S.tablePile.push(...cards);

  const rank = cards[0]!.rank;
  let burned = false;
  let replay = false;
  let skipApplied = false;
  let le7Set = false;
  const specialsSuppressed = S.le7Active;

  // Effets spéciaux (SI PAS sous contrainte ≤7)
  if (!specialsSuppressed) {
    if (rank === 7) {
      // Prochain coup ≤7, effets annulés
      S.le7Active = true;
      le7Set = true;
    } else if (rank === 8) {
      // Prochain joueur passe
      S.skipNext = true;
      skipApplied = true;
    } else if (rank === 11) {
      // Reset au Valet
      S.threshold = 11;
    } else if (rank === 2) {
      // Reset à 2
      S.threshold = 2;
    }
  }

  // Brûlage : 10 OU 4-of-a-kind sur le haut de pile (cumulé)
  if (!specialsSuppressed) {
    if (rank === 10 || fourOfKindOnTop(S.tablePile)) {
      S.discardPile.push(...S.tablePile);
      S.tablePile = [];
      burned = true;
      replay = true; // tu rejoues
      // La contrainte ≤7 saute si elle était active (mais normalement elle n’était pas active ici)
      S.le7Active = false;
    }
  }

  // Mise à jour du seuil normal
  if (!burned) {
    const topCard = top(S.tablePile);
    if (topCard) {
      // Si effets spéciaux annulés (≤7), on remonte tout de même le seuil selon la carte posée
      // Sinon, on remonte aussi, sauf quand reset 2/11 vient d'être joué (déjà traité)
      if (specialsSuppressed || (rank !== 2 && rank !== 11)) {
        S.threshold = Math.max(S.threshold, topCard.rank) as Rank;
      }
    }
  }

  // La contrainte ≤7 est consommée par CE coup
  if (specialsSuppressed) S.le7Active = false;

  S.lastMove = {
    playerId,
    played: cards,
    burned,
    replay,
    skipApplied,
    le7Set,
    specialsSuppressed,
    threshold: S.threshold,
    pickedUp: false,
  };

  // Fin de main : si joueur vide sa main → il “termine”
  if (P.hand.length === 0 && !P.finishedAt) {
    P.finishedAt = Date.now();
    S.winners.push(P.id);
  }

  // Avancer le tour
  if (!replay) {
    // joueur suivant
    let next = (S.current + 1) % S.players.length;

    // sauter joueurs déjà finis
    const used = new Set(S.winners);
    while (used.has(S.players[next]!.id) && next !== S.current) {
      next = (next + 1) % S.players.length;
    }

    // skip (8) s’il est actif
    if (S.skipNext) {
      S.skipNext = false;
      next = (next + 1) % S.players.length;
      while (used.has(S.players[next]!.id) && next !== S.current) {
        next = (next + 1) % S.players.length;
      }
    }

    S.current = next;
  }
  // Sinon replay = true : on ne change pas S.current (même joueur rejoue)

  // Vérifier fin de partie (quand 1 seul joueur reste)
  checkEnd(S);
  return S;
};

const checkEnd = (S: State) => {
  const done = new Set(S.winners);
  const remaining = S.players.filter((p) => !done.has(p.id));
  if (remaining.length <= 1 && S.status === "playing") {
    if (remaining[0] && !remaining[0].finishedAt) {
      remaining[0].finishedAt = Date.now();
      S.winners.push(remaining[0].id);
    }
    S.status = "finished";
  }
};