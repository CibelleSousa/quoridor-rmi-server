/**
 * Direções cardeais que identificam cada um dos 4 jogadores no tabuleiro 9x9 do Quoridor.
 * - N (Norte): Inicia na linha 0 e vence ao chegar na linha 8.
 * - S (Sul): Inicia na linha 8 e vence ao chegar na linha 0.
 * - W (Oeste): Inicia na coluna 0 e vence ao chegar na coluna 8.
 * - E (Leste): Inicia na coluna 8 e vence ao chegar na coluna 0.
 */
export type PlayerColor = 'N' | 'S' | 'W' | 'E';

/**
 * Orientação das barreiras (paredes) posicionadas no tabuleiro.
 * - H: Horizontal (bloqueia passagem vertical entre duas linhas em 2 colunas adjacentes).
 * - V: Vertical (bloqueia passagem horizontal entre duas colunas em 2 linhas adjacentes).
 */
export type WallOrientation = 'H' | 'V';

/**
 * Representa uma parede posicionada no tabuleiro 9x9.
 * A coordenada (row, col) indica o ponto superior-esquerdo da parede de tamanho 2 (0 <= row, col <= 7).
 */
export interface Wall {
  row: number;
  col: number;
  orientation: WallOrientation;
  ownerId: string;
}

/**
 * Representa um dos 4 jogadores remotos na partida de Quoridor.
 */
export interface Player {
  id: string;
  name: string;
  color: PlayerColor;
  row: number;
  col: number;
  targetRow?: number;
  targetCol?: number;
  wallsRemaining: number;
}

/**
 * Representa o estado global sincronizado da partida distribuída de Quoridor.
 */
export interface GameState {
  boardSize: number;
  players: Player[];
  walls: Wall[];
  currentTurnIndex: number;
  status: 'WAITING_PLAYERS' | 'IN_PROGRESS' | 'FINISHED';
  winner: Player | null;
  lastActionDescription: string;
}

/**
 * INTERFACE REMOTA (Equivalente a `java.rmi.Remote` apresentada nos slides).
 * Define o contrato de métodos que podem ser invocados remotamente pelos processos clientes
 * através do Apêndice do Cliente (Client Stub).
 */
export interface IGameRemote {
  /**
   * Registra um novo jogador remoto na partida (máximo de 4 jogadores).
   * @param playerName Nome de exibição do jogador.
   * @returns Objeto contendo os dados do jogador instanciado e o estado atualizado do jogo.
   */
  joinGame(playerName: string): Promise<{ player: Player; state: GameState }>;

  /**
   * Move o peão do jogador para uma casa adjacente (ou realiza um salto válido sobre outro peão).
   * @param playerId Identificador único do jogador que está realizando o movimento.
   * @param targetRow Linha de destino no tabuleiro 9x9 (0 a 8).
   * @param targetCol Coluna de destino no tabuleiro 9x9 (0 a 8).
   * @returns O estado atualizado da partida após a movimentação.
   */
  movePawn(playerId: string, targetRow: number, targetCol: number): Promise<GameState>;

  /**
   * Posiciona uma barreira (parede de 2 blocos) no tabuleiro, validando se não bloqueia
   * completamente o caminho de nenhum dos 4 jogadores até seus objetivos ( via algoritmo BFS).
   * @param playerId Identificador único do jogador que está posicionando a parede.
   * @param row Coordenada de linha da âncora da parede (0 a 7).
   * @param col Coordenada de coluna da âncora da parede (0 a 7).
   * @param orientation Orientação da parede ('H' para Horizontal ou 'V' para Vertical).
   * @returns O estado atualizado da partida após o posicionamento da parede.
   */
  placeWall(
    playerId: string,
    row: number,
    col: number,
    orientation: WallOrientation
  ): Promise<GameState>;

  /**
   * Consulta o estado atual da partida no servidor (Sincronização de estado).
   * @returns O estado atual completo do jogo.
   */
  getGameState(): Promise<GameState>;

  /**
   * Reinicia o tabuleiro, as posições dos peões e o estoque de paredes para uma nova partida,
   * mantendo os jogadores já conectados.
   * @returns O estado reiniciado do jogo.
   */
  resetGame(): Promise<GameState>;
}

/**
 * Estrutura da mensagem de requisição empacotada pelo Apêndice do Cliente (Marshalling).
 */
export interface RMIRPCRequest {
  requestId: string;
  method: keyof IGameRemote;
  args: any[];
}

/**
 * Estrutura da mensagem de resposta empacotada pelo Apêndice do Servidor (Server Stub).
 */
export interface RMIRPCResponse {
  requestId: string;
  result?: any;
  error?: string;
}