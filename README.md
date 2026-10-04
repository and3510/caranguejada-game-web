# Caranguejada

Jogo multiplayer de navegador sobre caranguejos numa ilha que está sendo engolida pelo mar.
A água invade das bordas para o centro, cada vez mais rápido. Você usa o **dash** para fugir da água,
cata uma **arma** no mapa para jogar os outros no mar e tenta ser o último de pé.
Dá pra jogar sozinho (contra bots) ou criar uma sala e mandar o link pros amigos.

## Como se joga

| Tecla              | Ação                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| `WASD` / setas     | andar                                                                    |
| Mouse              | **mira**: o caranguejo aponta pro cursor (o "laser" mostra o alcance)    |
| Clique             | **tiro** com a arma na mão; desarmado, **pega** a arma do chão           |
| `Shift` / `Espaço` | **dash**: dispara rápido para fugir. Só desloca, **não empurra** ninguém |
| `F`                | **pegar** a arma do chão, **largar** a sua, ou **trocar** uma pela outra |
| `Esc`              | menu: volume e sair da partida (o jogo **não** pausa)                    |

Depois que você cai, a câmera acompanha outro jogador e dá pra **trocar** durante a rodada: `Tab`/`E`/`→`/clique passam pro próximo, `Q`/`←` voltam, e no celular há botões ◀ ▶ na tela.

No celular aparecem um direcional e os botões de pegar, dash e atacar na tela (sem mouse, o caranguejo mira pra onde anda).

Com uma arma na mão, uma **linha tracejada** mostra o alcance real dela na direção da mira: reta que
para no primeiro alvo (revólver, submetralhadora), cone (espingarda) ou reta com o raio da explosão
no fim (bazuca). Fica mais forte quando a arma está pronta pra atirar.

### Armas

Todo mundo começa a rodada desarmado. As armas aparecem em terra alta (nunca em cima de alguém) e
vão surgindo mais durante a rodada (na enchente, a cada 3s). Quando a terra acaba, elas nascem
**boiando na água** perto de quem ainda está vivo: até o fim dá pra se armar e jogar alguém pro fundo. Toda arma é de fogo e é jogada fora quando
**acaba a munição**; quanto mais fraco cada tiro, mais munição a arma tem.
Largada no chão, a arma guarda o desgaste. Quem afunda leva a arma junto pro fundo. Arma na água
**boia por 10s** (dá pra pegar nadando; ela pisca no fim) e depois o mar leva.

Da mais comum pra mais rara: **revólver** (40% das armas que aparecem), **espingarda** (30%),
**submetralhadora** (20%) e **bazuca** (10%).

### Dano percentual

Ninguém morre por vida: o que mata continua sendo a água. Mas cada acerto soma **dano (%)** na
vítima, e **quanto mais dano acumulado, mais longe os próximos acertos a jogam** (100% = o dobro do
empurrão; teto de 200%, ou 3×). **Só você vê o seu** número (ao lado do seu nome, "Teste 46%", esquentando de branco
a vermelho); o dos outros jogadores fica escondido. Zera a cada rodada. Tiro que erra não soma, e quem se explode sozinho com a bazuca não
ganha dano.

| Arma            | Empurrão base | Dano por acerto |
| --------------- | ------------- | --------------- |
| Bazuca          | 28            | +20%            |
| Espingarda      | 26            | +14%            |
| Revólver        | 15            | +8%             |
| Submetralhadora | 3,5 por bala  | +3% por bala    |

As armas têm **assistência de mira**: no teclado só dá pra apontar em 8 direções, então o
tiro vai em quem estiver a até 18° da direção apertada.

| Arma                | Chance | Alcance   | Recarga | Desgaste   | Particularidade                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ------ | --------- | ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Revólver**        | 40%    | 7,5 tiles | 1s      | 6 tiros    | Tiro reto de longe: **afasta** o primeiro caranguejo da mira (a bala para nele). **Sem rebote**                                                                                                                                                                                                                                                              |
| **Espingarda**      | 30%    | 3,2 tiles | 1,1s    | 3 tiros    | Leque de chumbo (40°) que acerta todo mundo no cone e **arremessa longe** (mais forte de perto). O **rebote** empurra quem atirou um pouco pra trás (bem menos que a vítima), mesmo errando                                                                                                                                                                  |
| **Submetralhadora** | 20%    | 5 tiles   | 1,3s    | 20 balas   | Cada aperto solta uma **rajada de 4 balas** fracas e um pouco espalhadas. Uma bala sozinha quase não empurra, mas os empurrões **se somam**: a rajada inteira na mesma pessoa varre ela pra longe. Rebote leve por bala                                                                                                                                      |
| **Bazuca**          | 10%    | 9 tiles   | 1,4s    | 2 foguetes | O foguete **voa pelo mapa** (dá pra desviar) e explode ao tocar alguém ou no fim do alcance. A explosão empurra **todo mundo** no raio pra longe do centro, **inclusive quem atirou** se estiver perto (dá pra usar de "rocket jump"), e **destrói o bloco atingido e os 8 em volta** (3×3), abrindo uma cratera que a água ocupa. Pesada: anda mais devagar |

Os números ficam em [weapons.ts](packages/shared/src/weapons.ts), compartilhados entre o servidor
e a predição do cliente.

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
- O dash serve para **fugir** (da enchente ou de alguém; rende igual nadando) e para encurtar a distância até um alvo, mas quem empurra é a **arma**. O tiro sai na direção apertada, então mirar importa; na água o empurrado desliza ainda mais longe.
- Nadando, o caranguejo anda a **70%** da velocidade a pé e sempre escala para sair da água (beira de telhado, muralha ou casco não vira armadilha).
- Na água o fôlego acaba em cerca de 7s (rasa) ou 4s (funda), o que dá tempo de voltar nadando se você cair perto da costa. Jogar alguém pra água funda afoga bem mais rápido.
- As ondas comem a areia na linha d'água.
- Pontos: acertar alguém que se afoga em até 6s **+2**, último de pé **+5**. Eles só servem pra ordenar a tabela: quem vence é quem tem mais estrelas.
- **Vence a rodada** o último sobrevivente. Se os últimos afundarem no mesmo instante, é **empate**: ninguém leva a estrela.
- Cada rodada vencida vale uma **estrela**. Ao fim de cada rodada aparece um quadro com todos os caranguejos e quantas estrelas cada um tem.
- A partida tem **1, 3, 5 ou 7 rodadas** (cerca de 40s cada). Você escolhe no menu, e isso vale para jogar sozinho e para criar sala. No lobby, o anfitrião pode trocar, inclusive depois do resultado final, sem sair da sala.
- **Vence a partida** quem tiver mais estrelas. Se no fim das rodadas houver empate no topo, entra uma **rodada extra de desempate**, e outra, até alguém ficar na frente (com um teto de 10 extras, que na prática nunca chega).
- No resultado final dá pra ver quem está na sala e quantos bots tem, pra ajustar antes de jogar de novo.

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
  shared/   regras puras: constantes, maré, terreno procedural, física, armas, protocolo
  server/   servidor HTTP + WebSocket, salas, simulação, bots, métricas
  client/   Phaser + UI em DOM, predição local e interpolação
deploy/k8s/ manifests (kustomize)
```

Pontos de arquitetura:

- **Servidor autoritativo** a 30 ticks/s com passo fixo, enviando snapshots a 20/s. O cliente nunca decide resultado, só envia intenção (direção, mira e ações).
- **Predição + reconciliação**: o seu caranguejo responde na hora. Quando chega o snapshot, o cliente compara com a posição que _ele mesmo_ tinha quando o servidor aplicou aquele input (`ack` + `ackAge`) e corrige suavemente, assim a latência não vira tremedeira.
- **Interpolação** dos outros jogadores com cerca de 100ms de atraso.
- **Compensação de lag nos tiros**: você vê os outros um pouco no passado, então cada input leva o tempo de simulação que estava na sua tela (`vt`) e o servidor testa o tiro contra onde o alvo estava _naquele instante_ (até 0,3s de volta). Sem isso, tiro em quem se mexe "passava longe" mesmo parecendo certo.
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
