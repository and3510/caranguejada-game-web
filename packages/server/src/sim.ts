/**
 * Núcleo do jogo, sem rede e sem nada de Node: `Room`, `Simulation` e `Bot` só dependem
 * de `@caranguejada/shared`. Por isso dá pra rodar isto dentro do navegador — é o que o
 * modo "jogar sozinho" faz, com o servidor autoritativo na própria aba (latência zero).
 */
export { Room, SOLO_BOTS, type Peer } from './game/Room';
export { Simulation, type Crab, type CrabInput } from './game/Simulation';
export { Bot, botName } from './game/Bot';
export type { Logger } from './logger';
