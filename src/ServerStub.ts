import { IGameRemote, RMIRPCRequest, RMIRPCResponse } from './IGameRemote';

/**
 * APÊNDICE DO SERVIDOR (Server Stub / Skeleton).
 * Conforme a arquitetura de RMI/RPC apresentada nos slides do Prof. Giacomin (Tanenbaum & Steen),
 * o Apêndice do Servidor recebe a mensagem bruta da rede, realiza o desempacotamento (Unmarshalling)
 * dos parâmetros, faz a chamada local ao objeto real (`GameEngine`) e empacota o valor de retorno.
 */
export class ServerStub {
  private targetObject: IGameRemote;

  /**
   * @param targetObject Instância do objeto remoto real que implementa `IGameRemote`.
   */
  constructor(targetObject: IGameRemote) {
    this.targetObject = targetObject;
  }

  /**
   * Processa uma mensagem de requisição RPC/RMI serializada em JSON e retorna a resposta serializada.
   * @param rawMessage Payload JSON recebido pela camada de transporte HTTP.
   * @returns Payload JSON contendo o resultado da invocação ou a exceção remota capturada.
   */
  public async handleIncomingMessage(rawMessage: string): Promise<string> {
    let requestId = 'unknown';

    try {
      // Passo 5 do diagrama de RPC dos slides: Apêndice desempacota a mensagem (Unmarshalling)
      const request: RMIRPCRequest = JSON.parse(rawMessage);
      requestId = request.requestId;

      const { method, args } = request;

      const targetMethod = (this.targetObject as any)[method];
      if (typeof targetMethod !== 'function') {
        throw new Error(
          `Método remoto '${String(method)}' não existe na interface IGameRemote.`
        );
      }

      // Contexto de Roteamento para Logging (Identifica se é Lobby ou Sala específica)
      const isLobbyMethod = ['createRoom', 'listRooms'].includes(method as string);
      const roomLog = (!isLobbyMethod && args.length > 0) ? `[Sala: ${args[0]}]` : `[Lobby Registry]`;

      // Evita poluir o console do servidor com chamadas periódicas de leitura de estado
      if (method !== 'getGameState') {
        console.log(
          `📥 [Server Stub] ${roomLog} Invocação local -> ${String(method)}(${JSON.stringify(args)})`
        );
      }

      // Passo 6 do diagrama de RPC dos slides: Apêndice faz a chamada local ao procedimento/método
      const result = await targetMethod.apply(this.targetObject, args);

      const response: RMIRPCResponse = {
        requestId,
        result,
      };

      return JSON.stringify(response);
    } catch (error: any) {
      console.error(`❌ [Server Stub] Exceção durante invocação remota:`, error.message);
      const errorResponse: RMIRPCResponse = {
        requestId,
        error: error.message || 'Erro interno ao executar método remoto no servidor.',
      };
      return JSON.stringify(errorResponse);
    }
  }
}