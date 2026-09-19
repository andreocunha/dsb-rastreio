# Percursos DSB 2026

Os sete modelos em `../courses.ts` foram traçados manualmente das imagens fornecidas em `~/Downloads/provas_dsb`. A programação veio da tabela do evento enviada pelo usuário. Todos os arquivos de referência têm o prefixo `WhatsApp Image 2026-09-15 at ` e extensão `.jpeg`.

| Prova | Arquivo (sufixo) | Programação |
| --- | --- | --- |
| Raia Rápida | 13.32.59 (1) | 13/10/2026 · 15:00 |
| Match Race | 13.32.59 (2) | 14/10/2026 · 10:00 |
| Raia de Manobra | 13.33.00 | 14/10/2026 · 14:00 |
| Raia Longa | 13.33.00 (1) | 15/10/2026 · 08:00 |
| Revezamento de Pilotos | 13.33.00 (2) | 16/10/2026 · 09:00 |
| Sprint | 13.32.59 | 17/10/2026 · 09:00 |
| Slalom | 13.33.00 (3) | 17/10/2026 · 09:30 |

As imagens da Raia Rápida e Match Race não têm título; a associação foi inferida pelo circuito triangular e pelos dois traçados, respectivamente. As coordenadas exibidas no rodapé do Google Earth não identificam as boias. A conversão visual para latitude/longitude é aproximada, ajustada à região da lagoa, sem garantia de escala, distância ou posição oficial. As coordenadas dos marcos devem ser conferidas pela organização antes do evento. As áreas de apoio, largada e espera nas imagens são referências visuais; o modelo representa a área de manutenção, boias, percurso e chegada, sem impor regras da competição.

Os JPEGs não são distribuídos nem carregados pela aplicação. Só os poucos pontos vetoriais entram no pacote offline. O Match Race preserva dois caminhos; Manobra e Revezamento compartilham a geometria inicial, mas as edições são independentes.

Cada prova tem uma cópia de trabalho em `dsb:course:v2:<id>`, com a seleção em `dsb:selected-course:v2`. O circuito antigo `dsb:course:v1` é preservado como **Circuito livre / anterior**. Alterações são locais a este navegador/origem, sem sincronização com os aparelhos dos espectadores. Para disponibilizar ajustes da organização a todos, será necessário conectar essa configuração ao backend no futuro.

O editor permite arrastar boias, vértices, chegada, apoio e espera, inserir pontos em segmentos, acrescentar traçados e restaurar o modelo. O histórico de 30 ajustes fica em memória para desfazer durante a edição da prova; as posições finais são salvas ao concluir o gesto. Cancelar ou iniciar uma pinça durante o arraste desfaz esse gesto. Trocar de prova só prossegue se o circuito atual puder ser salvo.

## Ajustes da organização

A manutenção foi alinhada à captura mais recente do organizador, usando as quatro boias do Match Race como referências de posição. É a mesma área inferior para todas as provas. A área de espera fica separada, junto à margem acima da manutenção. As duas ficam em `dsb:event-areas:v1`; ajustes são compartilhados entre provas. Na primeira migração, uma manutenção já editada no Match Race é preservada como área comum. Restaurar o modelo de uma prova mantém essas áreas.

No Sprint, o traçado sobe por fora da boia direita, contorna-a por cima e retorna entre as duas boias. A migração substitui somente o antigo traçado reto intacto, preservando percursos personalizados.

A simulação mantém Barcos 1 e 2 no Match Race (um em cada traçado), Barco 1 no Slalom e os demais competidores na espera. As outras modalidades usam os seis competidores. Não há alternância automática de baterias. Apoios e jetskis patrulham posições escolhidas na água, fora dos circuitos, com deslocamentos de até 5 m ao redor de cada posição e menos de 1 nó. A velocidade dos competidores usa distância em metros, evitando aceleração artificial em segmentos longos. Resgates não são disparados automaticamente; isso depende de futura integração operacional.
