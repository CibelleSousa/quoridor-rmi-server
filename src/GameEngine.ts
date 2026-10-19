import {
  IGameRemote,
  GameState,
  Player,
  PlayerColor,
  Wall,
  WallOrientation,
} from './IGameRemote';
import { randomUUID } from 'crypto';

const BOARD_SIZE = 9;
const MAX_PLAYERS = 4;
const INITIAL_WALLS_PER_PLAYER = 5;

/**
 * Configuração inicial de cada um dos 4 jogadores no tabuleiro 9x9.
 */
const PLAYER_CONFIGS: {
  color: PlayerColor;
  startRow: number;
  startCol: number;
  targetRow?: number;
  targetCol?: number;
  label: string;
}[] = [
  { color: 'N', startRow: 0, startCol: 4, targetRow: 8, label: 'Norte (Topo -> Base)' },
  { color: 'S', startRow: 8, startCol: 4, targetRow: 0, label: 'Sul (Base -> Topo)' },
  { color: 'W', startRow: 4, startCol: 0, targetCol: 8, label: 'Oeste (Esq -> Dir)' },
  { color: 'E', startRow: 4, startCol: 8, targetCol: 0, label: 'Leste (Dir -> Esq)' },
];

/**
 * OBJETO REMOTO REAL (Equivalente à classe `ComputeEngine` do diagrama UML dos slides).
 * Implementa a interface remota `IGameRemote` e mantém o estado autoritativo da partida de Quoridor.
 */
export class GameEngine implements IGameRemote {
  private state: GameState;

  constructor() {
    this.state = this.createInitialState();
  }

  /**
   * Cria o estado inicial limpo para uma partida de Quoridor 9x9.
   */
  private createInitialState(): GameState {
    return {
      boardSize: BOARD_SIZE,
      players: [],
      walls: [],
      currentTurnIndex: 0,
      status: 'WAITING_PLAYERS',
      winner: null,
      lastActionDescription: 'Aguardando os 4 jogadores remotos se conectarem...',
    };
  }

  /**
   * @inheritdoc
   */
  public async joinGame(playerName: string): Promise<{ player: Player; state: GameState }> {
    if (this.state.players.length >= MAX_PLAYERS) {
      throw new Error('A partida já atingiu o limite máximo de 4 jogadores remotos.');
    }

    const idx = this.state.players.length;
    const cfg = PLAYER_CONFIGS[idx];

    const newPlayer: Player = {
      id: randomUUID(),
      name: playerName.trim() || `Jogador ${idx + 1}`,
      color: cfg.color,
      row: cfg.startRow,
      col: cfg.startCol,
      targetRow: cfg.targetRow,
      targetCol: cfg.targetCol,
      wallsRemaining: INITIAL_WALLS_PER_PLAYER,
    };

    this.state.players.push(newPlayer);

    if (this.state.players.length === MAX_PLAYERS) {
      this.state.status = 'IN_PROGRESS';
      this.state.lastActionDescription = `Os 4 jogadores entraram! Vez de ${this.state.players[0].name}.`;
    } else {
      this.state.lastActionDescription = `${newPlayer.name} entrou na partida (${this.state.players.length}/4).`;
    }

    return { player: newPlayer, state: this.state };
  }

  /**
   * @inheritdoc
   */
  public async movePawn(playerId: string, targetRow: number, targetCol: number): Promise<GameState> {
    this.validateTurn(playerId);
    const currentPlayer = this.state.players[this.state.currentTurnIndex];

    if (
      targetRow < 0 ||
      targetRow >= BOARD_SIZE ||
      targetCol < 0 ||
      targetCol >= BOARD_SIZE
    ) {
      throw new Error('Coordenadas fora dos limites do tabuleiro 9x9.');
    }

    // Verifica se já existe outro peão na casa de destino
    if (this.isCellOccupied(targetRow, targetCol)) {
      throw new Error('Já existe um peão ocupando esta casa!');
    }

    // Verifica se o movimento (passo simples ou salto sobre adversário) é válido
    const isValid = this.isValidPawnMove(
      currentPlayer.row,
      currentPlayer.col,
      targetRow,
      targetCol
    );

    if (!isValid) {
      throw new Error('Movimento inválido! Mova 1 casa ortogonal sem atravessar paredes (ou pule um peão adjacente).');
    }

    // Atualiza a posição do peão
    currentPlayer.row = targetRow;
    currentPlayer.col = targetCol;
    this.state.lastActionDescription = `${currentPlayer.name} moveu o peão para (${targetRow + 1}, ${targetCol + 1}).`;

    // Verifica condição de vitória (alcançou a linha ou coluna objetivo no lado oposto)
    if (this.hasPlayerReachedGoal(currentPlayer)) {
      this.state.status = 'FINISHED';
      this.state.winner = currentPlayer;
      this.state.lastActionDescription = `🏆 ${currentPlayer.name} alcançou o lado oposto e venceu a partida!`;
    } else {
      this.advanceTurn();
    }

    return this.state;
  }

  /**
   * @inheritdoc
   */
  public async placeWall(
    playerId: string,
    row: number,
    col: number,
    orientation: WallOrientation
  ): Promise<GameState> {
    this.validateTurn(playerId);
    const currentPlayer = this.state.players[this.state.currentTurnIndex];

    if (currentPlayer.wallsRemaining <= 0) {
      throw new Error('Você não possui mais barreiras disponíveis!');
    }

    if (row < 0 || row > 7 || col < 0 || col > 7) {
      throw new Error('Coordenadas de parede inválidas (devem estar entre 0 e 7).');
    }

    // Verifica colisão ou cruzamento com paredes já existentes
    if (this.doesWallOverlapOrCross(row, col, orientation)) {
      throw new Error('Esta posição colide ou cruza com uma barreira já existente!');
    }

    const candidateWall: Wall = {
      row,
      col,
      orientation,
      ownerId: currentPlayer.id,
    };

    // Adiciona temporariamente a parede para testar se todos os 4 jogadores mantêm pelo menos 1 caminho livre (BFS)
    this.state.walls.push(candidateWall);
    const allPlayersCanReachGoal = this.state.players.every((p) =>
      this.canPlayerReachGoalBFS(p)
    );

    if (!allPlayersCanReachGoal) {
      this.state.walls.pop(); // Desfaz a parede ilegal
      throw new Error('Regra do Quoridor: Você não pode trancar completamente o caminho de um jogador até o objetivo!');
    }

    currentPlayer.wallsRemaining -= 1;
    this.state.lastActionDescription = `${currentPlayer.name} posicionou uma parede ${
      orientation === 'H' ? 'Horizontal' : 'Vertical'
    } em (${row + 1}, ${col + 1}).`;

    this.advanceTurn();
    return this.state;
  }

  /**
   * @inheritdoc
   */
  public async getGameState(): Promise<GameState> {
    return this.state;
  }

  /**
   * @inheritdoc
   */
  public async resetGame(): Promise<GameState> {
    this.state.walls = [];
    this.state.currentTurnIndex = 0;
    this.state.winner = null;

    this.state.players.forEach((p, idx) => {
      const cfg = PLAYER_CONFIGS[idx];
      p.row = cfg.startRow;
      p.col = cfg.startCol;
      p.wallsRemaining = INITIAL_WALLS_PER_PLAYER;
    });

    this.state.status =
      this.state.players.length === MAX_PLAYERS ? 'IN_PROGRESS' : 'WAITING_PLAYERS';
    this.state.lastActionDescription = 'Partida reiniciada! Tabuleiro limpo e barreiras restauradas.';

    return this.state;
  }

  /**
   * Valida se a partida está em andamento e se o jogador que invocou o método remoto detém o turno atual.
   */
  private validateTurn(playerId: string): void {
    if (this.state.status === 'WAITING_PLAYERS') {
      throw new Error(
        `Aguardando os 4 jogadores entrarem (${this.state.players.length}/4 conectados).`
      );
    }
    if (this.state.status === 'FINISHED') {
      throw new Error('A partida já foi encerrada.');
    }

    const currentPlayer = this.state.players[this.state.currentTurnIndex];
    if (!currentPlayer || currentPlayer.id !== playerId) {
      throw new Error(`Não é a sua vez! Turno atual: ${currentPlayer?.name}.`);
    }
  }

  /**
   * Avança o turno circularmente entre os 4 jogadores (0 -> 1 -> 2 -> 3 -> 0).
   */
  private advanceTurn(): void {
    this.state.currentTurnIndex = (this.state.currentTurnIndex + 1) % MAX_PLAYERS;
  }

  /**
   * Verifica se uma célula (r, c) está ocupada por algum dos 4 peões.
   */
  private isCellOccupied(r: number, c: number): boolean {
    return this.state.players.some((p) => p.row === r && p.col === c);
  }

  /**
   * Verifica se há uma parede bloqueando o passo direto entre duas células ortogonalmente adjacentes.
   */
  private isBlockedByWall(r1: number, c1: number, r2: number, c2: number): boolean {
    // Movimento Vertical (mesma coluna, linhas adjacentes)
    if (c1 === c2 && Math.abs(r1 - r2) === 1) {
      const minRow = Math.min(r1, r2);
      return this.state.walls.some(
        (w) =>
          w.orientation === 'H' &&
          w.row === minRow &&
          (w.col === c1 || w.col === c1 - 1)
      );
    }

    // Movimento Horizontal (mesma linha, colunas adjacentes)
    if (r1 === r2 && Math.abs(c1 - c2) === 1) {
      const minCol = Math.min(c1, c2);
      return this.state.walls.some(
        (w) =>
          w.orientation === 'V' &&
          w.col === minCol &&
          (w.row === r1 || w.row === r1 - 1)
      );
    }

    return true;
  }

  /**
   * Valida se o peão pode ir de (r1, c1) para (r2, c2), considerando passos simples e saltos sobre peões.
   */
  private isValidPawnMove(r1: number, c1: number, r2: number, c2: number): boolean {
    const dRow = Math.abs(r1 - r2);
    const dCol = Math.abs(c1 - c2);

    // 1. Passo ortogonal simples (distância Manhattan = 1)
    if (dRow + dCol === 1) {
      return !this.isBlockedByWall(r1, c1, r2, c2);
    }

    // 2. Salto em linha reta sobre um peão adjacente (distância = 2 na mesma linha ou coluna)
    if ((dRow === 2 && dCol === 0) || (dRow === 0 && dCol === 2)) {
      const midR = (r1 + r2) / 2;
      const midC = (c1 + c2) / 2;
      if (
        this.isCellOccupied(midR, midC) &&
        !this.isBlockedByWall(r1, c1, midR, midC) &&
        !this.isBlockedByWall(midR, midC, r2, c2)
      ) {
        return true;
      }
    }

    // 3. Salto diagonal (permitido quando há um peão adjacente e uma parede ou outro peão atrás dele)
    if (dRow === 1 && dCol === 1) {
      // Tentativa via vizinho vertical (r2, c1)
      if (
        this.isCellOccupied(r2, c1) &&
        !this.isBlockedByWall(r1, c1, r2, c1) &&
        !this.isBlockedByWall(r2, c1, r2, c2)
      ) {
        const behindR = r2 + (r2 - r1);
        const blockedBehind =
          behindR < 0 ||
          behindR >= BOARD_SIZE ||
          this.isBlockedByWall(r2, c1, behindR, c1) ||
          this.isCellOccupied(behindR, c1);
        if (blockedBehind) return true;
      }

      // Tentativa via vizinho horizontal (r1, c2)
      if (
        this.isCellOccupied(r1, c2) &&
        !this.isBlockedByWall(r1, c1, r1, c2) &&
        !this.isBlockedByWall(r1, c2, r2, c2)
      ) {
        const behindC = c2 + (c2 - c1);
        const blockedBehind =
          behindC < 0 ||
          behindC >= BOARD_SIZE ||
          this.isBlockedByWall(r1, c2, r1, behindC) ||
          this.isCellOccupied(r1, behindC);
        if (blockedBehind) return true;
      }
    }

    return false;
  }

  /**
   * Verifica se uma nova parede sobrepõe ou cruza no meio com alguma parede existente.
   */
  private doesWallOverlapOrCross(
    row: number,
    col: number,
    orientation: WallOrientation
  ): boolean {
    return this.state.walls.some((w) => {
      // Cruzamento exato no mesmo ponto central (uma H e outra V na mesma âncora)
      if (w.row === row && w.col === col) return true;

      // Sobreposição de 1 segmento na mesma orientação
      if (w.orientation === orientation) {
        if (orientation === 'H' && w.row === row && Math.abs(w.col - col) === 1) {
          return true;
        }
        if (orientation === 'V' && w.col === col && Math.abs(w.row - row) === 1) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Verifica se o jogador atingiu sua linha ou coluna de vitória.
   */
  private hasPlayerReachedGoal(player: Player): boolean {
    if (player.targetRow !== undefined && player.row === player.targetRow) return true;
    if (player.targetCol !== undefined && player.col === player.targetCol) return true;
    return false;
  }

  /**
   * Algoritmo de Busca em Largura (BFS) para garantir que o jogador possui pelo menos
   * um caminho válido até sua borda de destino.
   */
  private canPlayerReachGoalBFS(player: Player): boolean {
    const visited = Array.from({ length: BOARD_SIZE }, () =>
      Array(BOARD_SIZE).fill(false)
    );
    const queue: [number, number][] = [[player.row, player.col]];
    visited[player.row][player.col] = true;

    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];

    while (queue.length > 0) {
      const [r, c] = queue.shift()!;

      if (player.targetRow !== undefined && r === player.targetRow) return true;
      if (player.targetCol !== undefined && c === player.targetCol) return true;

      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (
          nr >= 0 &&
          nr < BOARD_SIZE &&
          nc >= 0 &&
          nc < BOARD_SIZE &&
          !visited[nr][nc] &&
          !this.isBlockedByWall(r, c, nr, nc)
        ) {
          visited[nr][nc] = true;
          queue.push([nr, nc]);
        }
      }
    }

    return false;
  }
}