/**
 * CONFIGURAÇÃO DE TEMPORIZAÇÃO DO DETECTOR DE FALHAS.
 *
 * Em um detector de falhas por temporização (timeout), os prazos precisam ser generosos
 * o bastante para não confundir lentidão com falha — um falso positivo expulsaria um
 * jogador perfeitamente saudável. Por isso os valores padrão são folgados.
 *
 * O problema é que prazos folgados tornam o comportamento impossível de demonstrar:
 * seria preciso encarar a tela por dois minutos e meio para ver o ciclo completo de
 * queda, pausa e abandono. O MODO DEMONSTRAÇÃO resolve isso encurtando os mesmos prazos,
 * sem alterar uma única linha da lógica de detecção.
 *
 * Ative com `npm run demo` (em vez de `npm run dev`). A flag foi escolhida em vez de uma
 * variável de ambiente porque a sintaxe de variáveis difere entre bash, cmd e PowerShell,
 * enquanto um script npm funciona igual nos três sistemas.
 */

const MODO_DEMO = process.argv.includes('--demo');

/** Tempo sem heartbeat até o cliente ser considerado desconectado (partida pausa). */
export const MICRO_DROP_TIMEOUT_MS = MODO_DEMO ? 8000 : 60000;

/** Tempo adicional em estado OFFLINE até o jogador ser declarado abandonado (peão fantasma). */
export const ABANDON_WINDOW_MS = MODO_DEMO ? 12000 : 90000;

/** Intervalo da varredura periódica de auditoria de vivacidade. */
export const AUDIT_INTERVAL_MS = MODO_DEMO ? 1000 : 3000;

export const EH_MODO_DEMO = MODO_DEMO;

/**
 * Imprime no console qual perfil de temporização está ativo, para que fique evidente
 * durante uma apresentação qual configuração o servidor está usando.
 */
export function descreverPerfilDeTempo(): string {
  if (MODO_DEMO) {
    return (
      `⚡ MODO DEMONSTRAÇÃO ativo: desconexão em ${MICRO_DROP_TIMEOUT_MS / 1000}s, ` +
      `abandono em +${ABANDON_WINDOW_MS / 1000}s`
    );
  }
  return (
    `🛡️  Perfil padrão: desconexão em ${MICRO_DROP_TIMEOUT_MS / 1000}s, ` +
    `abandono em +${ABANDON_WINDOW_MS / 1000}s (use "npm run demo" para encurtar)`
  );
}
