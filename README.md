# Caranguejada

Jogo multiplayer de navegador sobre caranguejos numa ilha que está sendo engolida pelo mar.
A água invade das bordas para o centro, cada vez mais rápido. Você usa o **dash** para fugir da água,
cata uma **arma** no mapa para jogar os outros no mar e tenta ser o último de pé.
Dá pra jogar sozinho (contra bots) ou criar uma sala e mandar o link pros amigos (até 8 por sala, entre gente e bots).

## Como se joga

| Tecla              | Ação                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WASD` / setas     | andar                                                                                                                                                                                                 |
| Mouse              | **mira**: o caranguejo aponta pra mira (o "laser" mostra o alcance). Durante a partida o mouse fica **preso na tela** e a seta vira a mira do jogo, então não sai da janela nem clica fora sem querer |
| Clique             | **tiro** com a arma na mão; desarmado, **pega** a arma do chão                                                                                                                                        |
| `Shift` / `Espaço` | **dash**: dispara rápido para fugir. Só desloca, **não empurra** ninguém                                                                                                                              |
| `F`                | **pegar** a arma do chão, **largar** a sua, ou **trocar** uma pela outra                                                                                                                              |
| `Esc`              | menu: volume e sair da partida (o jogo **não** pausa). Também **solta o mouse**; "Voltar pro jogo" prende de novo                                                                                     |

Depois que você cai, a câmera acompanha outro jogador e dá pra **trocar** durante a rodada: `Tab`/`E`/`→`/clique passam pro próximo, `Q`/`←` voltam, e no celular há botões ◀ ▶ na tela.

**Efeitos reduzidos** (no menu inicial e no menu `Esc`): deixa o jogo mais leve, com a água parada, menos partículas e sem tremor de câmera. Liga sozinho em celular/tablet e pra quem usa "reduzir movimento" no sistema; a escolha fica salva.

No celular aparecem um direcional e os botões de pegar, dash e atacar na tela (sem mouse, o caranguejo mira pra onde anda).

Com uma arma na mão, uma **linha tracejada** mostra o alcance real dela na direção da mira: reta que
para no primeiro alvo (revólver, submetralhadora), cone (espingarda) ou reta **até o ponto mirado, com o raio
da explosão desenhado nele** (bazuca). Fica mais forte quando a arma está pronta pra atirar.

### Armas

Todo mundo começa a rodada desarmado. As armas aparecem em terra alta (nunca em cima de alguém) e
vão surgindo mais durante a rodada (a cada 4s; na enchente, a cada 3s), até ter uma no chão por caranguejo vivo (no máximo 6). Quando a terra acaba, elas nascem
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

A rajada da submetralhadora são 6 balas, então no mesmo alvo soma **21** de empurrão e **+18%**.

As armas têm **assistência de mira**: no teclado só dá pra apontar em 8 direções, então o
tiro vai em quem estiver a até 18° da direção apertada.

| Arma                | Chance | Alcance   | Recarga | Desgaste   | Particularidade                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------ | --------- | ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Revólver**        | 40%    | 7,5 tiles | 1s      | 6 tiros    | Tiro reto de longe: **afasta** o primeiro caranguejo da mira (a bala para nele). **Sem rebote**                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Espingarda**      | 30%    | 3,2 tiles | 1,1s    | 3 tiros    | Leque de chumbo (40°) que acerta todo mundo no cone e **arremessa longe** (mais forte de perto). O **rebote** empurra quem atirou um pouco pra trás (bem menos que a vítima), mesmo errando                                                                                                                                                                                                                                                                                                                          |
| **Submetralhadora** | 20%    | 6,5 tiles | 1,3s    | 30 balas   | Cada aperto solta uma **rajada de 6 balas** fracas e um pouco espalhadas. Uma bala sozinha quase não empurra, mas os empurrões **se somam**: a rajada inteira na mesma pessoa varre ela pra longe. Rebote leve por bala                                                                                                                                                                                                                                                                                              |
| **Bazuca**          | 10%    | 9 tiles   | 1,4s    | 2 foguetes | O foguete **voa pelo mapa** (dá pra desviar) e **explode onde você mirou com o mouse** (o círculo da mira mostra o ponto e o raio), de 2 até 9 tiles; encostar em alguém no caminho explode antes. No toque ou só no teclado, voa o alcance inteiro. A explosão empurra **todo mundo** no raio pra longe do centro, **inclusive quem atirou** se estiver perto (dá pra usar de "rocket jump"), e **destrói o bloco atingido e os 8 em volta** (3×3), abrindo uma cratera que a água ocupa. Pesada: anda mais devagar |

Os números ficam em [weapons.ts](packages/shared/src/weapons.ts), compartilhados entre o servidor
e a predição do cliente.

- A água **só sobe** e **acelera** com o tempo, no mesmo ritmo de sempre. Mas ela **para** logo abaixo da altura máxima: no fim de tudo sobram **8 blocos conectados** (o _refúgio final_) que **nunca alagam e não podem ser destruídos** (nem pela erosão, nem pela cratera da bazuca). É onde a inundação "fecha" e a briga final acontece, em vez de todo mundo acabar na água. Fica perto do ponto final sorteado e é surpresa: não é marcado. O número (`FINAL_REFUGE_TILES`) e o teto (`TIDE.maxLevel`) ficam em [constants.ts](packages/shared/src/constants.ts) e [tide.ts](packages/shared/src/tide.ts). Se ninguém sair do refúgio, a rodada ainda acaba no limite de 120s.
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
- **Só a água funda afoga.** Na rasa (até 1 de profundidade) o fôlego cai mas trava num mínimo: você fica fraco, nunca morto, e dá pra se arrastar na beirada e virar o jogo. Na funda o fôlego acaba em cerca de 4s. Por isso o que mata é **empurrar pro fundo** — jogar alguém no raso só o deixa sem fôlego pro próximo empurrão.
- As ondas comem a areia na linha d'água.
- Pontos: acertar alguém que se afoga em até 6s **+2**, último de pé **+5**. Eles só servem pra ordenar a tabela: quem vence é quem tem mais estrelas.
- **Vence a rodada** o último sobrevivente. Se os últimos afundarem no mesmo instante, é **empate**: ninguém leva a estrela.
- **Bots.** Tudo o que eles fazem está em [Bot.ts](packages/server/src/game/Bot.ts); os números têm nome na constante `BOT`. Eles jogam com **handicap de propósito**: sem ele acertavam 94% dos tiros. Cada bot sorteia uma **habilidade entre 0,5 e 0,9**; os números abaixo vão da habilidade 0 (pior caso) à 1 (melhor), então os bots reais ficam na faixa do meio.
  - Andam a 78–92% da sua velocidade, decidem a cada 0,4–0,9s e precisam de 0,28–0,6s mirando antes de atirar.
  - Erram a mira (de 13° a 5°, e mais de longe; o cone da espingarda conta como erro) e respiram 0,3–0,7s entre os tiros, além da recarga da arma.
  - **Perdem a mira ao levar tiro** e se assustam com quem **vem chegando** (de 0,9 a 2,5 tiles): mesmo já de olho em você de longe, entrar nessa faixa faz o bot hesitar de novo, uma vez por alvo.
  - **Encostado** (até 0,9 tile) e **de perto** (até 3 tiles) eles são decididos: o gatilho sai quase na hora (60% por tick, contra 7–16% de longe) e o respiro entre tiros cai 60%. Titubear com alguém grudado seria burrice, não dificuldade.
  - Jogam pra ganhar: desarmados, buscam a arma mais perto **no mapa todo** (de dash, se longe); armados, vão atrás de briga até 12 tiles; com espingarda ou bazuca, se dali não dá pra atirar (o rebote os jogaria em água funda, ou a explosão os pegaria), **dão a volta ou recuam** em vez de ficar parados; e não largam o seco pra perseguir quem caiu na água.
  - Quando a água ameaça o chão onde estão, **atravessam o mapa (no dash) até um lugar que ainda vai estar seco quando chegarem**, no fim o refúgio. Na água rasa nadam com calma até lá; na funda, só se o fôlego der. Eles leem o terreno inteiro, então **sabem onde é o refúgio desde o começo** (pra você é surpresa), mas só vão pra lá quando precisam; no resto do tempo vão brigar.
  - Medido com 6 bots em todos os mapas: acertam **75%** dos tiros (91% a até 2 tiles, 81% de 2 a 4, 60% de 4 a 6, 37% de mais longe). O primeiro tiro sai em ~0,1s (habilidade 1) a ~0,2s (habilidade 0) encostado, ~0,5s a ~1s chegando perto e ~0,4s a ~0,9s a meia distância.
- Cada rodada vencida vale uma **estrela**. Ao fim de cada rodada aparece um quadro com todos os caranguejos e quantas estrelas cada um tem.
- A partida tem **1, 3, 5 ou 7 rodadas** (de uns 25s com 2 jogadores a uns 45s com a sala cheia). Você escolhe no menu, e isso vale para jogar sozinho e para criar sala. No lobby, o anfitrião pode trocar, inclusive depois do resultado final, sem sair da sala.
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

O **cartão do link** (a imagem que aparece quando você cola o endereço no WhatsApp, Discord, Telegram etc.) vem das tags Open Graph do [index.html](packages/client/index.html) e da imagem `packages/client/public/og.jpg` (JPG 1200×628, 145 KB; o WebP não funciona em todos os apps). O endereço nas tags é **absoluto** de propósito: se o domínio mudar, troque `caranguejada.ajvale.com.br` ali. Esses apps guardam o cartão em cache, então, depois de trocar a imagem, compartilhe o link com um `?v=2` no final (ou limpe o cache em [developers.facebook.com/tools/debug](https://developers.facebook.com/tools/debug/)).

A arte do jogo não usa assets externos. Os sprites são desenhados como texto em [sprites.ts](packages/client/src/game/sprites.ts), os tiles são gerados em [terrainRenderer.ts](packages/client/src/game/terrainRenderer.ts) e os efeitos sonoros são sintetizados com WebAudio em [audio.ts](packages/client/src/game/audio.ts). As exceções são a capa e as músicas.

**Tela de abertura.** Ao abrir a página aparece a capa (`packages/client/public/capa.webp`, 161 KB) enquanto o jogo carrega por baixo; quando a cena do menu já está desenhando, ela some num fade. Ela fica **no mínimo 1,9s** na tela, contados de quando a imagem aparece (`CAPA_MINIMO_MS`, em [main.ts](packages/client/src/main.ts)), porque em internet rápida tudo carregava antes de dar pra ver a arte. A barra anda no menor entre o carregamento real e esse relógio. Os estilos dela ficam **embutidos no `index.html`**, de propósito: se dependessem do `style.css` do pacote, a capa apareceria desformatada e daria um salto quando o estilo chegasse (o mesmo vale pro `box-sizing`, pro `overflow` do corpo e pra altura da placa do título, que é reservada pra a troca de fonte não mexer nela). Com a CSP do servidor (`script-src 'self'`) não dá pra usar `onload` embutido, então a imagem não tem fade de entrada.

**Músicas**, em [src/assets/musicas/](packages/client/src/assets/musicas/) (MP3 128 kbps). **Cada rodada toca uma diferente, sem repetir na partida**: a ordem é sorteada no começo da partida, a troca acontece na contagem da rodada nova (uma some enquanto a outra entra), e no resumo entre rodadas a da rodada que acabou continua. Se a partida tiver mais rodadas que músicas (desempates), a lista é sorteada de novo, sem repetir a mesma em seguida. Sair da sala apaga a música ([music.ts](packages/client/src/game/music.ts)). **Pra adicionar uma música, é só soltar o .mp3 nessa pasta**: o Vite acha sozinho e publica com nome versionado (cache longo). Prefira 128 kbps (`ffmpeg -i original.mp3 -map_metadata -1 -b:a 128k nova.mp3`): cada jogador baixa uma por rodada. Tocam pelo mesmo controle de volume dos efeitos, um pouco mais baixas. Por causa delas o servidor responde a pedidos de pedaço de arquivo (`Range`, código 206): sem isso o Safari não toca mídia.

## Estrutura

```
packages/
  shared/   regras puras: constantes, maré, terreno procedural, física, armas, protocolo
  server/   servidor HTTP + WebSocket, salas, simulação, bots, métricas
  client/   Phaser + UI em DOM, predição local e interpolação
docker/       Dockerfile e docker-compose.yml
loadtest/     teste de pico com k6 (salas cheias jogando partidas inteiras)
.gitea/workflows/  pipeline de CI/CD
```

Pontos de arquitetura:

- **Servidor autoritativo** a 30 ticks/s com passo fixo, enviando snapshots a 20/s. O cliente nunca decide resultado, só envia intenção (direção, mira e ações).
- **Solo roda na sua máquina**: em "Jogar sozinho" a mesma classe `Room` é instanciada dentro da aba ([LocalConnection.ts](packages/client/src/net/LocalConnection.ts)), sem WebSocket nenhum. Latência zero (nada de reconciliação), funciona offline e as regras são idênticas — é o mesmo código, e os inputs passam pela mesma validação do protocolo.
- **Predição + reconciliação**: o seu caranguejo responde na hora. Quando chega o snapshot, o cliente compara com a posição que _ele mesmo_ tinha quando o servidor aplicou aquele input (`ack` + `ackAge`) e corrige suavemente, assim a latência não vira tremedeira.
- **Interpolação** dos outros jogadores com cerca de 100ms de atraso, só entre snapshots que já chegaram. O cliente **não extrapola**: se um snapshot atrasa, o caranguejo espera parado em vez de ser desenhado num palpite — chegamos a testar o palpite (dead reckoning) e, com caranguejo mudando de direção o tempo todo, o deslize de volta ficava pior que a travada.
- **Palpite do foguete** (bazuca): o foguete é desenhado no instante do clique, antes de o servidor responder — senão ele "nasceria" já adiantado no meio do caminho. Quando o foguete autoritativo chega, o palpite **vira** ele (mesma imagem, sem dois na tela) e o errinho de posição some em 0,2s. É o único projétil que voa; as outras armas são tiro instantâneo, resolvido com compensação de lag.
- **Mira livre da bazuca**: o cliente manda, junto com a direção, a distância até o cursor (`ad` no input). O servidor limita entre `rocketMinRange` (2 tiles, pra ela não explodir na sua cara) e o alcance da arma (`rocketRange`, em [weapons.ts](packages/shared/src/weapons.ts), compartilhada) e o foguete explode ali, ou antes, se tocar em alguém. O palpite local para no mesmo ponto, e o snapshot diz quanto falta (`rem`) pra tela nunca desenhar o foguete passando dele. Sem cursor (toque, só teclado), voa o alcance inteiro.
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
docker compose -f docker/docker-compose.yml up --build   # http://localhost:3000
```

Qualidade:

```bash
npm run check        # lint + typecheck + testes
npm run format       # prettier
```

Teste de carga (precisa do [k6](https://k6.io); instruções no cabeçalho do script): cada sala simulada joga uma partida inteira com 8 conexões.

```bash
k6 run -e ROOMS=700 -e WS_URL=ws://localhost:3000/ws loadtest/rooms-peak.js
```

### Configuração (variáveis de ambiente)

| Variável            | Padrão    | Descrição                                                                 |
| ------------------- | --------- | ------------------------------------------------------------------------- |
| `PORT`              | `3000`    | Porta HTTP/WebSocket                                                      |
| `HOST`              | `0.0.0.0` | Endereço onde o servidor escuta                                           |
| `LOG_LEVEL`         | `info`    | `debug`, `info`, `warn`, `error` (logs em JSON, uma linha cada)           |
| `STATIC_DIR`        | `public`  | Onde está o build do cliente                                              |
| `MAX_ROOMS`         | `500`     | Limite de salas por processo                                              |
| `ALLOWED_ORIGINS`   | (vazio)   | Origens aceitas no WebSocket, separadas por vírgula. Vazio = qualquer uma |
| `SHUTDOWN_GRACE_MS` | `5000`    | Tempo de drenagem no SIGTERM                                              |

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
- CI/CD: pipeline no Gitea ([ci-cd.yaml](.gitea/workflows/ci-cd.yaml)) que chama os workflows reutilizáveis do repositório de pipelines da organização: build da imagem, atualização dos manifestos Kubernetes (que ficam **fora** deste repositório) e deploy via ArgoCD. O que cada etapa verifica (testes, varredura da imagem) é definido lá, não aqui. A verificação com `npm audit` e Trivy que existia no GitHub Actions saiu junto com o `.github`; `npm run check` e `npm audit` continuam valendo rodar antes de subir.
