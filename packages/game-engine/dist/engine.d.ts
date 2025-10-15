export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export type Suit = "♠" | "♥" | "♦" | "♣";
export interface Card {
    id: string;
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
    current: number;
    drawPile: Card[];
    tablePile: Card[];
    discardPile: Card[];
    winners: string[];
    skipNext: boolean;
    le7Active: boolean;
    threshold: Rank;
    lastMove?: MoveResult;
    seed?: number;
}
export type ClientAction = {
    kind: "play";
    cardIds: string[];
} | {
    kind: "pickup";
};
export interface MoveResult {
    playerId: string;
    played: Card[];
    burned: boolean;
    replay: boolean;
    skipApplied: boolean;
    le7Set: boolean;
    specialsSuppressed: boolean;
    threshold: Rank;
    pickedUp: boolean;
}
export declare const makeDeck: () => Card[];
export declare const createGame: (opts: {
    players: {
        id: string;
        name: string;
    }[];
    seed?: number;
}) => State;
export declare const getView: (S: State, viewerId: string) => {
    status: GameStatus;
    players: {
        id: string;
        name: string;
        handCount: number;
        isYou: boolean;
        finishedAt: number | undefined;
    }[];
    currentPlayerId: string;
    you: Player | null;
    tableCount: number;
    topCard: Card | null;
    discardCount: number;
    drawCount: number;
    winners: string[];
    skipNext: boolean;
    le7Active: boolean;
    threshold: Rank;
    lastMove: MoveResult | null;
};
export declare const getLegalMoves: (S: State, playerId: string) => string[][];
export declare const applyAction: (S: State, playerId: string, action: ClientAction) => State;
//# sourceMappingURL=engine.d.ts.map