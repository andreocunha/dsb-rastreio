# DSB · Solar Boat Race

Interface Next.js com mapa simplificado em Canvas 2D e cenário 3D opcional para acompanhar posições reais do DSB Tracker.
O mapa é sempre público, sem login. A organização entra pelo **painel da organização**:

- **No app DSB (iframe):** o app adiciona `?admin=1` para quem está em `admin_emails` (a
  mesma lista do painel `/admin` do app) e aparece o botão **Organização** no mapa. O
  painel entra sozinho com a conta do app: pede a sessão ao app (`postMessage`), o
  servidor confere o token no Supabase e o e-mail em `admin_emails`. Dentro do iframe a
  sessão vai num cabeçalho `Authorization` (navegadores não enviam o cookie ali).
- **Direto no navegador (`/admin` ou `/?admin=1`):** senha da organização, em
  `ADMIN_PASSWORD` no `.env` (mínimo 8 caracteres; trocar a senha encerra as sessões
  abertas, que duram 12 h; 10 tentativas por minuto).

O painel tem as abas **Prova** (escolher e publicar a prova, ajustar o desenho no mapa),
**Barcos** (lista com logos; cor, casco e motores no mapa; cadastrar barco),
**Aparelhos** (vincular ou trocar o celular de um barco, desativar, apagar) e **SOS**.
O histórico é do barco: trocar o celular mantém o mesmo barco no mapa e no histórico, e
apagar um aparelho mantém trajetos, posições e SOS da equipe (migração
`../dsb-app/supabase/migrations/20261007215611_rastreio_historico_do_barco.sql`).
SSE pelo `dsb-server` entrega uma leitura compartilhada da frota; não há assinatura
Supabase Realtime por visitante. O modo normal usa telemetria real, sem barcos mockados.

O local é sempre DSB / Imboassica e a iluminação do 3D segue o sol real no local
(horário de Brasília). Para testes, há um local em Vitória (-20.265221, -40.260797):
`/?venue=vitoria-test`. A posição do tracker não é deslocada para o local escolhido.

## Run

```sh
npm install
npm run dev
```

Production, including the offline app shell:

```sh
npm run build
npm start
```

The build command generates `public/offline-manifest.js` from the exact Next build. Deploy the generated file together with `public/sw.js` and the Next build. Do not deploy with only `next build`, bypassing the package script. A secure origin (HTTPS, or localhost for development) is required for service workers.

## Dentro do app DSB (iframe) e logos

Quando aberto dentro de outro site (iframe) ou com `?embed=1`, o mapa mostra só o
essencial para o público (o botão **Organização** só com `?admin=1`, veja acima).
No celular, as embarcações ficam numa faixa fina no rodapé (logo, nome e
velocidade; tocar acompanha o barco) e 3D/horário/camada ficam num único botão.
As logos vêm de `teams.logo` (nome do arquivo), enviado pelo stream ao vivo, e são
carregadas de `https://dsb.app.br/logos/<arquivo>`; outro endereço pode ser definido em
`NEXT_PUBLIC_LOGO_BASE`. Sem logo, aparecem as iniciais na cor do barco.

## Map and interaction

The default chart bundles simplified OpenStreetMap geometry: no external tiles, map library, web font or 3D engine is loaded. The satellite button loads imagery on demand. Drag/pinch or use zoom buttons; select a boat on the map or in the accessible fleet list; the initial view fits the selected course. The sliders button below the layer selector opens the course editor. Controls sit near the bottom edge, above the fleet panel on mobile.

O editor de percursos abre pelo painel da organização (**Prova → Ajustar o desenho no mapa**), nos modos
simplificado e 3D, sem mudar a vista nem mover o mapa. Cada ajuste é salvo no servidor
(tabela `tracker_courses`, com 0,6 s de espera após o último gesto). **Mostrar esta
prova ao público** define qual prova todos veem. O `dsb-server` lê essa tabela a cada 2 s
(uma leitura para todos) e envia a prova pelo mesmo SSE das posições: quem está com o
mapa aberto recebe a mudança em segundos, sem Supabase Realtime. A última prova
publicada fica em cache no aparelho para abrir offline. Dados vindos do servidor são
validados estritamente. Migração: `../dsb-tracker/supabase/migrations/20260929180000_tracker_courses.sql`. See [geography provenance and licensing](lib/map/data/README.md).

Seven 2026 course presets include the supplied schedule. Their geometry is approximate, manually traced from the supplied images: see [course references and limitations](lib/map/data/COURSES.md). Routes and buoys save per course; maintenance and waiting areas are shared across the event. The legacy circuit remains under “Circuito livre / anterior”. Drag handles to adjust geometry, tap a path to insert vertices, undo edits or restore a built-in model. Restoring a course preserves the shared event areas. The mobile editor collapses its options while editing, and fitting the course accounts for the open panel. Zoom reaches level 21; satellite images are enlarged from native level 18 above that level, keeping request counts bounded.

## Offline behaviour

- Production installs an atomic, versioned cache of the home page, its JS/CSS, manifest and small app icon. Installation completes only after the entire shell has been cached.
- Subsequent home navigations use that cached build immediately. New builds install in the background and show an explicit update action, avoiding mixed HTML/JS versions.
- The illustrated map works offline after preparation. Live positions require a connection. First-ever access still requires a connection. Browser eviction or clearing site data removes this capability.
- Satellite is optional: only visited tiles are available offline. Persistent satellite storage is capped at 120 tiles; the in-memory cache at 96 images, with six simultaneous requests. Failed tiles do not retry every frame; reconnection clears their failure state.
- Navigation caching is restricted to `/`. API, telemetry, RSC, mutations and unrelated origins are not cached. Live updates require connectivity; stale boats show the age of the last fix and suppress speed.
- Development intentionally does not register this worker, to prevent caching dev/HMR chunks.

## Rendering budget

In simplified mode, the geographic background and transparent moving layer use separate canvases. A small margin allows the background to be translated during camera movement before repainting. Boat hulls/panels/shadows are cached sprites rendered at 3× resolution. The moving layer follows screen density up to DPR 3 with a five-million-pixel buffer limit; the background stays capped at DPR 1.5. Live interpolation and dragging use up to 60 fps; stationary live scenes and reduced motion use 15 fps. Trails are capped at 100 points per boat sampled every 400 ms. The fleet summary updates at 2 Hz. Hidden tabs stop their animation loop; paused scenes are redrawn only after an interaction changes them.

These are implementation limits, not a guarantee for every device. Benchmark a representative low-end Android device and the intended competition telemetry before the event.

## Modo 3D e horário do cenário

O 3D é o padrão ao abrir o app. **Simplificado / 3D**, no canto superior direito,
alterna o modo e a escolha fica salva no navegador; `?view=3d` e `?view=simple` permitem compartilhar o modo. O 3D é
carregado só ao ser ativado e volta ao simplificado se o WebGL falhar.

**Visual.** Câmera quase aérea, norte para cima (como um drone). A terra é a
fotografia de satélite com tratamento de cor; a água é estilizada e ocupa
exatamente a margem traçada do próprio satélite (`lib/map/data/*-water.json`),
com degradê de profundidade, arrebentação no mar e espuma discreta na margem da
lagoa. Não há prédios, árvores ou relevo inventados.

**Barcos.** Catamarã (dois flutuadores, piloto num deles) ou monocasco (painel
mais largo que o casco), piloto de colete laranja, bandeira amarela e 1, 2 ou 3
motores de popa, cada um com sua própria esteira. O casco usa a cor da equipe com
um leve brilho próprio, legível em qualquer horário. A demonstração inclui jetskis
de resgate (brancos, com prancha) e lancha de alumínio patrulhando devagar perto da
raia, fora do percurso. As cores das equipes são tons vivos escolhidos para
contrastar com a água.
Ao vivo, cor, casco e motores são definidos no painel da organização, aba **Barcos**
(colunas `teams.boat_hull` e `teams.boat_motors`; migração em
`../dsb-app/supabase/migrations/20260927200000_boat_appearance.sql`). Sem a
migração, todos aparecem como catamarã de 1 motor.

**Percurso.** Linhas, áreas, chegada quadriculada e boias (cilindros laranja e
cubos rosa na chegada) são desenhados em WebGL por baixo dos barcos. O número de
cada boia fica num disco branco no topo dela; "CHEGADA" e os nomes das áreas são
pintados na água, do lado livre da linha. Áreas têm contorno fixo, sem animação. Nomes dos barcos evitam sobreposição com
histerese: não trocam de lado nem piscam por colisões momentâneas.

**Girar e inclinar (3D).** Como no Google Maps: no computador, Ctrl/Shift + arrastar
ou arrastar com o botão direito (horizontal gira, vertical inclina entre 45° e a
vista de cima); no celular, torcer dois dedos gira e deslizar dois dedos lado a lado
para cima/baixo inclina. A bússola aparece quando o mapa está girado ou inclinado e
volta ao norte com um toque. Só a câmera muda: não há custo extra de renderização.

**Horário.** Horário real (posição do sol pela data e coordenadas do evento),
Manhã, Meio-dia, Pôr do sol e Noite, com transição suave de 1,6 s entre eles.

**Orçamento.** 60 fps, caindo para 30 fps se o aparelho não sustentar; DPR até 2
(1,75 em telas estreitas) e no máximo 3,6 milhões de pixels. Cerca de 5 draw calls
por barco. Pacote 3D ≈ 157 KiB gzip, sem contar os tiles de satélite, que usam o
mesmo cache/Service Worker do 2D (até 48 tiles visíveis, zoom nativo 18). A aba
oculta suspende a animação. Edição do circuito usa a visualização simplificada.

### Demonstração

Só para testes, sem botão no mapa: `/?venue=imboassica&view=3d&demo=1`. Dez
competidores no percurso padrão e três embarcações de apoio. O modo fica
identificado como **Demonstração · Dados fictícios**. Há pausa, velocidades
1×/2×/4× e retorno ao vivo. A demonstração não abre SSE, não envia dados e não lê
nem sobrescreve o circuito salvo pelo operador.

In simplified mode, wake length, width and opacity follow each boat's speed in knots: hidden up to 0.3 knots, moderate at 6 knots, and capped at 12 knots. Faster support craft use that same ceiling without changing the competitors' scale. Each visible wake uses five arcs; the separate colored position history still represents the traveled path.

## Checks

```sh
npm test
npm run lint
npm run build
```

Tests cover geographic round trips, persisted/corrupt course data, static-background invalidation, DPR and hidden-tab handling, tile concurrency/memory limits, atomic offline installation, API cache isolation and tile cache bounds. Production browser checks should include a narrow mobile viewport and a reload with the app server unavailable after the service worker has finished installing.

## SOS e movimento ao vivo

O mapa mostra avisos discretos para novos SOS pelo mesmo SSE das posições.
O movimento ao vivo é reproduzido com 3 s de atraso (`PLAYBACK_DELAY` em
`lib/map/live-motion.ts`): os pontos de 1 Hz ficam num buffer e o barco segue uma
curva suave (Hermite) entre eles, sem parar quando um ponto chega atrasado ou se
perde um ponto. Nada é extrapolado além do último GPS recebido; saltos e quedas
longas reposicionam direto. Não há tráfego extra.

A esteira no 3D é feita de marcas de espuma instanciadas deixadas no caminho
(1 draw call por barco, envelhecimento na GPU). Segue a física de uma esteira real:
jato estreito por motor no centro e dois braços que se abrem no ângulo de Kelvin
(~19,5°) e desbotam. Duração e intensidade dependem da velocidade (máximo perto de
10–12 nós; quase nada em marcha lenta) e aumentam quando o barco está ampliado para
visibilidade. Acompanha curvas sem dobras.
Detalhes e testes em `../dsb-server/docs/sos-e-movimento-2026-09-27.md`.
