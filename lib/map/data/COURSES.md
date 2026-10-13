# Percursos DSB 2026

Os sete modelos em `../courses.ts` foram traçados manualmente das imagens fornecidas em `~/Downloads/provas_dsb`. A programação e a ordem das provas são as da Instrução Técnica da Etapa Macaé 2026 (Slalom é a Prova 6 e Sprint a Prova 7). Todos os arquivos de referência têm o prefixo `WhatsApp Image 2026-09-15 at ` e extensão `.jpeg`.

| Prova | Arquivo (sufixo) | Programação |
| --- | --- | --- |
| Raia Rápida | 13.32.59 (1) | 13/10/2026 · 15:00 |
| Match Race | 13.32.59 (2) | 14/10/2026 · 10:00 |
| Raia de Manobra | 13.33.00 | 14/10/2026 · 14:00 |
| Raia Longa | 13.33.00 (1) | 15/10/2026 · 08:00 |
| Revezamento de Pilotos | 13.33.00 (2) | 16/10/2026 · 09:00 |
| Slalom | 13.33.00 (3) | 17/10/2026 · 09:00 |
| Sprint | 13.32.59 | 17/10/2026 · 11:00 |

As imagens da Raia Rápida e Match Race não têm título; a associação foi inferida pelo circuito triangular e pelos dois traçados, respectivamente. As coordenadas exibidas no rodapé do Google Earth não identificam as boias. As áreas de apoio, largada e espera nas imagens são referências visuais; o modelo representa a área de manutenção, boias, percurso e chegada, sem impor regras da competição.

Os JPEGs não são distribuídos nem carregados pela aplicação. Só os poucos pontos vetoriais entram no pacote offline. O Match Race preserva dois caminhos; Manobra e Revezamento compartilham a geometria inicial, mas as edições são independentes.

Cada prova tem uma cópia de trabalho em `dsb:course:v2:<id>`, com a seleção em `dsb:selected-course:v2`. O circuito antigo `dsb:course:v1` é preservado como **Circuito livre / anterior**. Alterações são locais a este navegador/origem, sem sincronização com os aparelhos dos espectadores. Para disponibilizar ajustes da organização a todos, será necessário conectar essa configuração ao backend no futuro.

O editor permite arrastar boias, vértices, chegada, apoio e espera, inserir pontos em segmentos, acrescentar traçados e restaurar o modelo. O histórico de 30 ajustes fica em memória para desfazer durante a edição da prova; as posições finais são salvas ao concluir o gesto. Cancelar ou iniciar uma pinça durante o arraste desfaz esse gesto. Trocar de prova só prossegue se o circuito atual puder ser salvo.

## Posição no mapa

Os mapas da Instrução Técnica são as mesmas imagens de referência, então o traçado em pixels vale para os dois. A posição vem do georreferenciamento desses mapas contra o satélite que o app usa (Esri World Imagery): as capturas do Google Earth estão inclinadas, por isso `point()` aplica uma transformação projetiva, uma para as vistas de perto (todas no mesmo quadro) e outra para a vista da lagoa inteira da Raia Longa. Pontos de controle: prédios, píer e trilhas junto à chegada e, para a lagoa inteira, o canal, as lagoas do brejo e a rodovia da margem norte. As duas transformações, feitas em separado, põem a chegada no mesmo lugar com diferença de uns 10 m. A precisão é de cerca de 5 m perto do píer e 10 a 15 m nas boias mais distantes; a organização ainda ajusta as boias no `/admin` conforme forem fundeadas.

A chegada sai do píer, como no mapa oficial, então a ponta de terra dela pode cair fora do polígono de água. Poucos vértices de rota que cairiam na margem (a lagoa estava mais cheia na imagem do Google Earth) foram recuados alguns metros para a água.

## Ajustes da organização

A espera e a manutenção seguem as linhas desenhadas nos mapas oficiais: a espera vai do píer para o sul e a manutenção continua dali pela praia. No app cada uma é uma faixa de água de 26 m de largura, a 10 m dessa linha da margem. É o mesmo par de áreas para todas as provas (linha `imboassica:areas` em `tracker_courses`); ajustes são compartilhados entre provas. Restaurar o modelo de uma prova mantém essas áreas.

No Sprint, as duas boias marcam a largada e o traçado é uma reta do meio dessa linha até a chegada, como na imagem de referência.

A simulação mantém Barcos 1 e 2 no Match Race (um em cada traçado), Barco 1 no Slalom e os demais competidores na espera. As outras modalidades usam os seis competidores. Não há alternância automática de baterias. Apoios e jetskis patrulham posições escolhidas na água, fora dos circuitos, com deslocamentos de até 5 m ao redor de cada posição e menos de 1 nó. A velocidade dos competidores usa distância em metros, evitando aceleração artificial em segmentos longos. Resgates não são disparados automaticamente; isso depende de futura integração operacional.
