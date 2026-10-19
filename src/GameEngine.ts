import {
  IGameRemote,
  GameState,
  Player,
  PlayerColor,
  Wall,
  WallOrientation,
  RoomInfo
} from './IGameRemote';
import { randomUUID } from 'crypto';

const BOARD_SIZE = 9;
const MAX_PLAYERS = 4;
const INITIAL_WALLS_PER_PLAYER = 5;

/**
 * Matriz de configuração imutável para a geometria inicial de cada nó cliente (jogador).
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
 * CONTEXTO DE EXECUÇÃO ISOLADO (Game Instance).
 * Representa uma sessão de jogo específica. Esta classe não lida com a rede diretamente;
 * ela atua como a máquina de estados pura para as regras de negócio do Quoridor.
 */
class GameInstance {
  public state: GameState;

  constructor(roomId: string, roomName: string) {
    this.state = this.createInitialState(roomId, roomName);
  }

  private createInitialState(roomId: string, roomName: string): GameState {
    return {
      roomId,
      roomName,
      boardSize: BOARD_SIZE,
      players: [],
      walls: [],
      currentTurnIndex: 0,
      status: 'WAITING_PLAYERS',
      winner: null,
      lastActionDescription: 'Aguardando alocação de processos clientes remotos...',
    };
  }

  public async joinGame(playerName: string): Promise<{ player: Player; state: GameState }> {
    if (this.state.players.length >= MAX_PLAYERS) {
      throw new Error('Capacidade da sala esgotada (máximo de 4 conexões).');
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
      this.state.lastActionDescription = `Quorum atingido. Turno inicial transferido para ${this.state.players[0].name}.`;
    } else {
      this.state.lastActionDescription = `${newPlayer.name} vinculado à sessão (${this.state.players.length}/${MAX_PLAYERS}).`;
    }

    return { player: newPlayer, state: this.state };
  }

  public async movePawn(playerId: string, targetRow: number, targetCol: number): Promise<GameState> {
    this.validateTurn(playerId);
    const currentPlayer = this.state.players[this.state.currentTurnIndex];

    if (targetRow < 0 || targetRow >= BOARD_SIZE || targetCol < 0 || targetCol >= BOARD_SIZE) {
      throw new Error('Exceção geométrica: Coordenadas violam os limites do espaço 9x9.');
    }

    if (this.isCellOccupied(targetRow, targetCol)) {
      throw new Error('Violação de estado: O vértice de destino já está alocado.');
    }

    if (!this.isValidPawnMove(currentPlayer.row, currentPlayer.col, targetRow, targetCol)) {
      throw new Error('Transição inválida segundo as regras de topologia do Quoridor.');
    }

    currentPlayer.row = targetRow;
    currentPlayer.col = targetCol;
    this.state.lastActionDescription = `${currentPlayer.name} transicionou para (${targetRow + 1}, ${targetCol + 1}).`;

    if (this.hasPlayerReachedGoal(currentPlayer)) {
      this.state.status = 'FINISHED';
      this.state.winner = currentPlayer;
      this.state.lastActionDescription = `🏆 Condição de parada atingida. ${currentPlayer.name} venceu a sessão!`;
    } else {
      this.advanceTurn();
    }

    return this.state;
  }

  public async placeWall(
    playerId: string,
    row: number,
    col: number,
    orientation: WallOrientation
  ): Promise<GameState> {
    this.validateTurn(playerId);
    const currentPlayer = this.state.players[this.state.currentTurnIndex];

    if (currentPlayer.wallsRemaining <= 0) {
      throw new Error('Recursos esgotados: Cota de barreiras do nó atingida.');
    }

    if (row < 0 || row > 7 || col < 0 || col > 7) {
      throw new Error('Vetor de posicionamento inválido.');
    }

    if (this.doesWallOverlapOrCross(row, col, orientation)) {
      throw new Error('Colisão detectada na matriz geométrica do tabuleiro.');
    }

    const candidateWall: Wall = { row, col, orientation, ownerId: currentPlayer.id };
    this.state.walls.push(candidateWall);

    // Validação de Grafo: Garante que o grafo permaneça conexo para o objetivo de todos os nós
    const allPlayersCanReachGoal = this.state.players.every((p) => this.canPlayerReachGoalBFS(p));

    if (!allPlayersCanReachGoal) {
      this.state.walls.pop();
      throw new Error('Bloqueio Ilegal de Rota (Regra anti-deadlock): Todos os nós devem ter um caminho válido.');
    }

    currentPlayer.wallsRemaining -= 1;
    this.state.lastActionDescription = `${currentPlayer.name} instanciou uma barreira ${orientation} em (${row + 1}, ${col + 1}).`;

    this.advanceTurn();
    return this.state;
  }

  public async getGameState(): Promise<GameState> {
    return this.state;
  }

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

    this.state.status = this.state.players.length === MAX_PLAYERS ? 'IN_PROGRESS' : 'WAITING_PLAYERS';
    this.state.lastActionDescription = 'Reset de sessão concluído com sucesso.';

    return this.state;
  }

  // --- Métodos privados utilitários e de heurística do Grafo foram mantidos exatos como na refatoração ---

  private validateTurn(playerId: string): void {
    if (this.state.status === 'WAITING_PLAYERS') {
      throw new Error('Estado prematuro: Aguardando sincronização do quorum de 4 processos.');
    }
    if (this.state.status === 'FINISHED') {
      throw new Error('Estado finalizado: A sessão não aceita novas transições.');
    }

    const currentPlayer = this.state.players[this.state.currentTurnIndex];
    if (!currentPlayer || currentPlayer.id !== playerId) {
      throw new Error('Violação de exclusão mútua de turno.');
    }
  }

  private advanceTurn(): void {
    this.state.currentTurnIndex = (this.state.currentTurnIndex + 1) % MAX_PLAYERS;
  }

  private isCellOccupied(r: number, c: number): boolean {
    return this.state.players.some((p) => p.row === r && p.col === c);
  }

  private isBlockedByWall(r1: number, c1: number, r2: number, c2: number): boolean {
    if (c1 === c2 && Math.abs(r1 - r2) === 1) {
      const minRow = Math.min(r1, r2);
      return this.state.walls.some((w) => w.orientation === 'H' && w.row === minRow && (w.col === c1 || w.col === c1 - 1));
    }
    if (r1 === r2 && Math.abs(c1 - c2) === 1) {
      const minCol = Math.min(c1, c2);
      return this.state.walls.some((w) => w.orientation === 'V' && w.col === minCol && (w.row === r1 || w.row === r1 - 1));
    }
    return true;
  }

  private isValidPawnMove(r1: number, c1: number, r2: number, c2: number): boolean {
    const dRow = Math.abs(r1 - r2);
    const dCol = Math.abs(c1 - c2);

    if (dRow + dCol === 1) return !this.isBlockedByWall(r1, c1, r2, c2);

    if ((dRow === 2 && dCol === 0) || (dRow === 0 && dCol === 2)) {
      const midR = (r1 + r2) / 2;
      const midC = (c1 + c2) / 2;
      if (this.isCellOccupied(midR, midC) && !this.isBlockedByWall(r1, c1, midR, midC) && !this.isBlockedByWall(midR, midC, r2, c2)) {
        return true;
      }
    }

    if (dRow === 1 && dCol === 1) {
      if (this.isCellOccupied(r2, c1) && !this.isBlockedByWall(r1, c1, r2, c1) && !this.isBlockedByWall(r2, c1, r2, c2)) {
        const behindR = r2 + (r2 - r1);
        if (behindR < 0 || behindR >= BOARD_SIZE || this.isBlockedByWall(r2, c1, behindR, c1) || this.isCellOccupied(behindR, c1)) return true;
      }
      if (this.isCellOccupied(r1, c2) && !this.isBlockedByWall(r1, c1, r1, c2) && !this.isBlockedByWall(r1, c2, r2, c2)) {
        const behindC = c2 + (c2 - c1);
        if (behindC < 0 || behindC >= BOARD_SIZE || this.isBlockedByWall(r1, c2, r1, behindC) || this.isCellOccupied(r1, behindC)) return true;
      }
    }
    return false;
  }

  private doesWallOverlapOrCross(row: number, col: number, orientation: WallOrientation): boolean {
    return this.state.walls.some((w) => {
      if (w.row === row && w.col === col) return true;
      if (w.orientation === orientation) {
        if (orientation === 'H' && w.row === row && Math.abs(w.col - col) === 1) return true;
        if (orientation === 'V' && w.col === col && Math.abs(w.row - row) === 1) return true;
      }
      return false;
    });
  }

  private hasPlayerReachedGoal(player: Player): boolean {
    if (player.targetRow !== undefined && player.row === player.targetRow) return true;
    if (player.targetCol !== undefined && player.col === player.targetCol) return true;
    return false;
  }

  private canPlayerReachGoalBFS(player: Player): boolean {
    const visited = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(false));
    const queue: [number, number][] = [[player.row, player.col]];
    visited[player.row][player.col] = true;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    while (queue.length > 0) {
      const [r, c] = queue.shift()!;
      if (player.targetRow !== undefined && r === player.targetRow) return true;
      if (player.targetCol !== undefined && c === player.targetCol) return true;

      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && !visited[nr][nc] && !this.isBlockedByWall(r, c, nr, nc)) {
          visited[nr][nc] = true;
          queue.push([nr, nc]);
        }
      }
    }
    return false;
  }
}

/**
 * OBJETO REMOTO DESPACHANTE (RMI Dispatcher / Manager).
 * Expõe a interface RMI e multiplexa as requisições para a sala (GameInstance) correspondente.
 */
export class GameEngine implements IGameRemote {
  /**
   * Dicionário em memória que garante o isolamento físico/lógico entre sessões distintas.
   */
  private rooms: Map<string, GameInstance> = new Map();

  public async createRoom(roomName: string): Promise<string> {
    const roomId = randomUUID();
    this.rooms.set(roomId, new GameInstance(roomId, roomName));
    return roomId;
  }

  public async listRooms(): Promise<RoomInfo[]> {
    const list: RoomInfo[] = [];
    for (const [roomId, instance] of this.rooms.entries()) {
      list.push({
        roomId,
        name: instance.state.roomName,
        playersCount: instance.state.players.length,
        status: instance.state.status,
      });
    }
    return list;
  }

  /**
   * Resolução de Roteamento Interno.
   * @param roomId Chave de identificação da sessão.
   */
  private getRoom(roomId: string): GameInstance {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Referência RMI Inexistente: Instância da sala '${roomId}' não localizada no Registry.`);
    }
    return room;
  }

  public async joinGame(roomId: string, playerName: string) {
    return this.getRoom(roomId).joinGame(playerName);
  }

  public async movePawn(roomId: string, playerId: string, targetRow: number, targetCol: number) {
    return this.getRoom(roomId).movePawn(playerId, targetRow, targetCol);
  }

  public async placeWall(roomId: string, playerId: string, row: number, col: number, orientation: WallOrientation) {
    return this.getRoom(roomId).placeWall(playerId, row, col, orientation);
  }

  public async getGameState(roomId: string) {
    return this.getRoom(roomId).state;
  }

  public async resetGame(roomId: string) {
    return this.getRoom(roomId).resetGame();
  }
}