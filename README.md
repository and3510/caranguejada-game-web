# Caranguejada

Jogo multiplayer de navegador sobre caranguejos numa ilha que está sendo engolida pelo mar.
A água invade das bordas para o centro, cada vez mais rápido. Você usa o **dash** para fugir da água
e para jogar os outros no mar e tenta ser o último de pé.
Dá pra jogar sozinho (contra bots) ou criar uma sala e mandar o link pros amigos.

## Como se joga

| Tecla                    | Ação                                                            |
| ------------------------ | --------------------------------------------------------------- |
| `WASD` / setas           | andar                                                           |
| `Espaço` / `Shift` / `J` | **dash**: dispara rápido; quem estiver no caminho é arremessado |
| `Esc`                    | menu: volume e sair da partida (o jogo **não** pausa)           |

No celular aparecem um direcional e o botão de dash na tela.

- A água **só sobe** e **acelera** com o tempo. Cada rodada sorteia um **ponto final**: a enchente começa pelo lado oposto, a terra encolhe em faixas e o último tile seco é **surpresa** (não é marcado): quem ler a água primeiro chega antes.
- A cada rodada é sorteado um dos **11 mapas** (sem repetir o anterior). Você pode deixar **todos** no sorteio ou escolher **um ou mais**, no menu (vale para solo e criar sala) ou no lobby, inclusive depois do resultado final. A mecânica é a mesma; muda a geografia e o material (terra, madeira, telhado, coral, areia, lama):
  - **Morro**: uma ilha alta no centro.
  - **Arquipélago**: ilha central com ilhotas em volta, que afundam primeiro.
  - **Atol**: anel com lagoa no meio, onde a água aperta pelos dois lados.
  - **Ilhas Gêmeas**: duas ilhas ligadas por uma ponte de areia que some cedo.
  - **Espinhaço**: uma crista longa e estreita, terreno de empurrão.
  - **Cais do Porto**: calçadão de madeira com píeres, caixotes e um galpão de zinco.
  - **Navio Naufragado**: casco rachado no meio, com pedras em volta.
  - **Cidade Submersa**: quarteirões de telhado; as ruas viram canais e sobram pontes de tábua.
  - **Recife de Coral**: galhos de coral ramificados em água turquesa.
  - **Castelo de Areia**: torre, muralha com torreões, fosso e ponte levadiça.
  - **Manguezal**: lamaçal cortado por canais sinuosos, com água turva.
- O dash serve para as duas coisas: **fugir** (da enchente ou de alguém; rende igual nadando) e **atacar** (arremessa na direção do dash, então mirar importa; na água o empurrado desliza ainda mais longe).
- Nadando, o caranguejo sempre escala para sair da água (beira de telhado, muralha ou casco não vira armadilha).
- Na água o fôlego acaba em cerca de 3s (rasa) ou 1,7s (funda), o que dá tempo de voltar nadando se você cair perto da costa.
- As ondas comem a areia na linha d'água, e concha que fica no fundo é levada pelo mar.
- Pontos: concha **+1**, concha dourada **+3**, jogar alguém que se afoga em até 4s **+2**, último de pé **+5**.
- **Vence a rodada** o último sobrevivente. Se os últimos afundarem no mesmo instante, vence quem fez mais pontos naquela rodada; se empatarem também nos pontos, ninguém leva.
- Cada rodada vencida vale uma **estrela**. Ao fim de cada rodada aparece um quadro com todos os caranguejos e quantas estrelas cada um tem.
- A partida tem **1, 3, 5 ou 7 rodadas** (cerca de 40s cada). Você escolhe no menu, e isso vale para jogar sozinho e para criar sala. No lobby, o anfitrião pode trocar, inclusive depois do resultado final, sem sair da sala.

## Stack e por quê

| Camada    | Escolha                                         | Motivo                                                                                  |
| --------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| Linguagem | **TypeScript** (cliente, servidor e regras)     | Regras do jogo escritas uma vez e executadas igual no servidor e na predição do cliente |
| Render    | **Phaser 4** (WebGL)                            | Engine 2D madura para navegador, com câmera, tweens e texto                             |
| Rede      | **WebSocket (`ws`)** + servidor autoritativo    | Protocolo pequeno e explícito, sem mágica, fácil de testar e rotear por sala            |
| Build     | Vite (cliente), esbuild (servidor em 1 arquivo) | A imagem final não tem `node_modules`                                                   |
| Testes    | Vitest                                          | Regras, sala e protocolo testados sem rede                                              |

A arte não usa assets externos. Os sprites são desenhados como texto em [sprites.ts](packages/client/src/game/sprites.ts), os tiles são gerados em [terrainRenderer.ts](packages/client/src/game/terrainRenderer.ts) e os sons são sintetizados com WebAudio em [audio.ts](packages/client/src/game/audio.ts).

## Estrutura

```
packages/
  shared/   regras puras: constantes, maré, terreno procedural, física, protocolo
  server/   servidor HTTP + WebSocket, salas, simulação, bots, métricas
  client/   Phaser + UI em DOM, predição local e interpolação
deploy/k8s/ manifests (kustomize)
```

Pontos de arquitetura:

- **Servidor autoritativo** a 30 ticks/s com passo fixo, enviando snapshots a 15/s. O cliente nunca decide resultado, só envia intenção (direção e ações).
- **Predição + reconciliação**: o seu caranguejo responde na hora. Quando chega o snapshot, o cliente compara com a posição que _ele mesmo_ tinha quando o servidor aplicou aquele input (`ack` + `ackAge`) e corrige suavemente, assim a latência não vira tremedeira.
- **Interpolação** dos outros jogadores com cerca de 110ms de atraso.
- [Simulation.ts](packages/server/src/game/Simulation.ts) e [Room.ts](packages/server/src/game/Room.ts) não conhecem WebSocket (a conexão é a interface `Peer`), por isso dá para testar uma partida inteira em memória.

## Rodando

Requer Node 22+.

```bash
npm install
npm run dev          # servidor :3000 + Vite :5173 (abra http://localhost:5173)
```

Produção local:

```bash
npm run build && npm start               # http://localhost:3000
# ou
docker compose up --build                # http://localhost:3000
```

Qualidade:

```bash
npm run check        # lint + typecheck + testes
npm run format       # prettier
```

### Configuração (variáveis de ambiente)

| Variável            | Padrão   | Descrição                                                                 |
| ------------------- | -------- | ------------------------------------------------------------------------- |
| `PORT`              | `3000`   | Porta HTTP/WebSocket                                                      |
| `LOG_LEVEL`         | `info`   | `debug`, `info`, `warn`, `error` (logs em JSON, uma linha cada)           |
| `STATIC_DIR`        | `public` | Onde está o build do cliente                                              |
| `MAX_ROOMS`         | `500`    | Limite de salas por processo                                              |
| `ALLOWED_ORIGINS`   | (vazio)  | Origens aceitas no WebSocket, separadas por vírgula. Vazio = qualquer uma |
| `SHUTDOWN_GRACE_MS` | `5000`   | Tempo de drenagem no SIGTERM                                              |

### Endpoints operacionais

- `GET /healthz`: liveness.
- `GET /readyz`: readiness. Retorna 503 durante o shutdown, para o pod sair do Service antes de derrubar conexões.
- `GET /metrics`: Prometheus (salas, jogadores, partidas ativas, duração de tick, conexões, mensagens inválidas, rate limit).

## Segurança

- Toda mensagem do cliente passa por validação ([protocol.ts](packages/shared/src/protocol.ts)). Valores fora da faixa são normalizados e lixo é descartado.
- `maxPayload` de 2 KB no WebSocket, rate limit de 60 mensagens/s por conexão e heartbeat que derruba conexões mortas.
- Nomes de jogador são sanitizados (caracteres de controle, `<>`, tamanho) e renderizados sempre via `textContent`.
- Servidor de estáticos protegido contra path traversal, com CSP restritiva, `nosniff`, `frame-ancestors 'none'` e COOP.
- Container: usuário não-root, filesystem somente leitura, `cap_drop: ALL`, sem npm/yarn na imagem.
- CI: actions fixadas por **SHA de commit**, `npm audit` e **Trivy** bloqueando vulnerabilidades HIGH/CRITICAL na imagem.



