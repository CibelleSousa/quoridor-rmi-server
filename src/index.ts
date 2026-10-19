import http from 'http';
import { GameEngine } from './GameEngine';
import { ServerStub } from './ServerStub';

const PORT = process.env.PORT || 4000;

/**
 * 1. Instancia o Objeto Remoto Real (Motor do Quoridor para 4 jogadores)
 */
const gameEngine = new GameEngine();

/**
 * 2. Vincula o Objeto Remoto ao Apêndice do Servidor (Server Stub)
 */
const serverStub = new ServerStub(gameEngine);

/**
 * Servidor de Transporte RMI/RPC operando sob o paradigma Solicitação/Resposta HTTP (Sem uso de Sockets diretos).
 */
const server = http.createServer((req, res) => {
  // Configuração de cabeçalhos CORS para permitir chamadas remotas de múltiplos clientes Web (Vercel / Localhost)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Resposta imediata para preflight CORS dos navegadores
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Endpoint principal de Invocação de Métodos Remotos (POST /rmi)
  if (req.method === 'POST' && req.url === '/rmi') {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      const responsePayload = await serverStub.handleIncomingMessage(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(responsePayload);
    });

    return;
  }

  // Endpoint de Diretório / Health Check (GET /)
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      service: 'Quoridor 4-Players RMI Registry & Server',
      status: 'ONLINE',
      transport: 'HTTP Request/Reply (JSON-RPC / RMI)',
      endpoint: '/rmi',
      objectRegistered: 'QuoridorGameEngine',
    })
  );
});

server.listen(PORT, () => {
  console.log(`==============================================================`);
  console.log(`🚀 Servidor RMI Quoridor (4 Jogadores) rodando na porta ${PORT}`);
  console.log(`🔗 Endpoint de Invocação Remota: http://localhost:${PORT}/rmi`);
  console.log(`📦 Objeto Remoto Registrado: GameEngine -> IGameRemote`);
  console.log(`==============================================================`);
});