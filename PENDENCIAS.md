# Pendências

Levantado em 2026-09-10. O primeiro lote fecha a **v1.5.0** (MINOR: muda comportamento
sem quebrar o uso existente).

## Lote v1.5.0

### Já implementado, não publicado

**1. Cartão de compartilhamento** (commit `65e0298`)
O link no WhatsApp saía como "Indicadores Operacionais", que é o `<title>`, porque a
página não tinha nenhuma meta de Open Graph. Agora `og:title` diz **KPIs Conselho
Formatar**, com descrição e imagem de 1200x630 sobre fundo sólido (o WhatsApp achata
transparência em preto).

**2. Respeito ao limite de requisições** (commit `a05abb2`)
A API aceita 50 requisições por minuto e a janela precisa de 789 páginas, então a
sincronização morria no primeiro `429` e ninguém sem cache via dados. Os proxies
repassam `RateLimit-*` e `Retry-After`, o cliente espera o que a API manda e
`PAGE_GUARD` subiu de 500 para 2000. Verificado: 4 janelas de limite atravessadas
sem falha.

### Implementado

**3. Carga mês a mês, do mais recente para o mais antigo** (v1.5.1). A primeira
tentativa fatiava em três blocos — 6 meses, resto do ano, ano anterior — e não
resolvia o primeiro acesso: como a tela só libera quando o bloco fecha em reuniões
*e* tarefas, o bloco de 6 meses deixava a tela vazia por 4,3 minutos mesmo com 5.455
reuniões já gravadas. Com a fatia de um mês, o mês corrente aparece em 17s (medido) e
a linha do tempo cresce para trás sozinha. Sem caso especial de virada de ano.

**4. Cobertura persistida**, que só avança quando a fase fecha em todos os recursos —
senão a tela mostraria reuniões cheias e zero tarefas no intervalo entre uma e outra.
A regra de fase pendente olha só a borda antiga da cobertura: a janela termina em
"hoje" e avança todo dia, e comparar pela borda nova faria a fase de 6 meses
recomeçar do zero a cada visita.

**5. A linha do tempo vem da cobertura**, não dos dados soltos, então um
`Pagamentos.csv` com meses ainda não sincronizados não estica a tabela. As linhas
ficam no cache e entram quando a fase correspondente terminar.

**6. Rótulos derivados do período real e comparação só quando é justa.** O rótulo era
montado com `jan/` fixo no código. Agora sai dos meses que existem de fato, e as
colunas de ano anterior e variação só aparecem quando os dois lados cobrem os mesmos
meses.

**7. Aviso durante as fases de fundo**, dizendo que o comparativo fica disponível ao
terminar.

**8. Recarga dos últimos 30 dias sem filtro de `updatedAt`.** O incremental perdia
registro que entra na janela pelo tempo passar: uma tarefa que vence hoje, criada e
não tocada há semanas, tem `updatedAt` velho. O mês corrente ficava subcontado.

**9. Cache de planilha descartado na migração.** Encontrado ao revisar o lote: as
atividades importadas na v1.1.0 têm `nid` e **não** têm `id`, enquanto as da API têm
`id`. Como a chave é `id || nid`, as mesmas atividades entrariam duas vezes e todo
indicador dobraria — e isso ia acontecer no primeiro sync bem-sucedido de quem já usa
o dashboard. Reuniões e tarefas hoje só vêm da API, então as linhas sem `id` são
descartadas ao abrir. Os pagamentos, que continuam sendo importados à mão, ficam.

**10. Cores do cabeçalho por classe** (v1.5.2). Eram pintadas por posição
(`nth-child`), então com a comparação oculta as colunas de mês assumiam a posição das
que sumiram e herdavam o cinza do acumulado e o laranja da variação. Agora cada
coluna leva classe própria: mês preto, acumulado cinza, variação laranja, texto
branco em todas.

**11. Primeira competência em 5s** (v1.5.2). A classificação dos clientes eram 10
páginas buscadas antes do primeiro mês, sem entrar em nenhum número da tabela. Movida
para depois: o primeiro mês caiu de 17s para 5,1s, medido. A tela vazia também deixou
de mandar "sincronize na engrenagem" durante uma sincronização em curso — passa a
mostrar o progresso real.

**12. Badge do cabeçalho vivo e clicável** (v1.5.3). Ele dizia só "Sincronizando…"
e só reavaliava quando um mês inteiro fechava, então nas esperas de 40–50s do limite
da API o dashboard parecia travado. Passa a mostrar o mês e a posição
(`Sincronizando jul/2025 · mês 14 de 21`) e a contar a espera para baixo
(`retomando em 42s`), chegando a `retomando…` em vez de travar no zero. Clicar abre a
engrenagem na aba Dados. O painel usa a mesma fonte, para não contar num lugar e
congelar no outro.

## Lote v1.6.2 → v1.8.0 · Comercial

Levantado em 2026-09-11, a partir de quatro pedidos: recebimento zerado, recebimento
por hora vazio, contagem de reuniões por cliente e o nome do cliente errado.

**13. Nome do cliente no lugar da razão social** (v1.6.2). A matriz rotulava por
`companyName`: FEHEROS aparecia como CAMPOS FERREIRA COMERCIO ELETRONICO LTDA. O
campo "Nome" da tela do cliente é `tradingName` na API — descoberto por eliminação,
já que ela valida o parâmetro `fields`. Os 950 clientes têm o campo preenchido.

**14. Aba Qtd de reuniões por cliente** (v1.7.0). Mesma contagem de "Reuniões
realizadas" de Operações, repartida por cliente. O total não bate entre as duas telas
de propósito: a matriz comercial exige cliente vinculado, e reunião interna não
pertence a linha nenhuma dela.

**15. Recebimento tinha a fonte errada** (v1.8.0). A matriz lia o `Pagamentos.csv`,
que é o contas a **pagar**: 778 linhas, 55 entidades que são pessoas e planos de
conta de salário. Não havia um único cliente ali, e por isso toda linha mostrava
`R$ 0` — e, por tabela, o recebimento por hora ficava sem numerador. Conferido também
que a API do Hub não tem endpoint financeiro: 25 nomes de recurso sondados
(`receipts`, `receivables`, `invoices`, `payments`, `contracts`…), todos 404. O
recebimento passa a vir do `Recebimentos.csv`, com card de upload e cache próprios, e
o `Pagamentos.csv` fica só na aba de Custo.

**16. Linhas repetidas no relatório de recebimentos** (v1.8.0). 11 parcelas saem
duplicadas — a mesma sai até cinco vezes, idêntica nas 23 colunas —, somando R$ 129
mil a mais. A chave passa a ser o `NID` da parcela. Parcelamento real não se perde:
cada parcela tem NID próprio, conferido nas 16 faturas parceladas do arquivo.

**17. Abas de R$ vazias avisam o que falta** (v1.8.0). Sem o arquivo importado, elas
mostravam uma coluna inteira de `R$ 0`, que tem cara de número apurado. Agora dizem
que o relatório precisa ser importado, e que sincronizar não resolve.

## Lote v1.8.1 → v1.10.0 · Leitura dos números

Levantado em 2026-09-11, depois de a v1.8.0 entrar em produção e a tela mostrar
valores absurdos.

**18. O leitor de CSV corrompia valor e competência** (v1.8.1). O arquivo ia para o
`XLSX` com inferência de tipo ligada, e o SheetJS adivinha com convenção americana —
antes de `normalizeNumber` e `normalizeDate` verem qualquer coisa. `1.300,00` virava
`1.3`, `900,00` virava `90000`, e `01/12/2024` virava 12 de janeiro. Atingia 45% das
parcelas de recebimento e 93% das de pagamento, e inflava o recebimento de R$ 10,0 mi
para R$ 18,6 mi. **A aba de Custo carregava o mesmo defeito desde a v1.1.0.** O CSV
passa a ser lido como texto cru, com o BOM removido antes e detecção de ANSI.

**19. Ordenação por clique no cabeçalho** (v1.9.0), nas duas áreas, com volta à ordem
natural no terceiro clique.

**20. Coluna de período por média** (v1.10.0), com seletor para voltar à soma. A
média divide só pelos meses com valor: um cliente que entrou em julho não deve ter a
média diluída pelos meses em que ainda não era cliente.

## Lote v1.10.1 → v1.12.0 · Depois da primeira olhada em produção

Levantado em 2026-09-11, conferindo a v1.10.0 na tela.

**21. A rolagem travava no mês mais antigo quando havia ordenação** (v1.10.1).
Introduzido na v1.9.0: desliguei a rolagem automática para não jogar a pessoa ao fim
da linha do tempo a cada clique, mas trocar o conteúdo da tabela zera `scrollLeft` —
o efeito foi o oposto. Agora a posição é guardada e devolvida quando a tabela
continua a mesma; forma nova ainda abre no mês mais recente.

**22. Ordenação padrão explícita na Comercial** (v1.11.0). A matriz já vinha ordenada
pela coluna do ano corrente, mas sem seta no cabeçalho — não dava para saber por onde
estava ordenada nem que bastava clicar para inverter. A área passa a declarar
`defaultSort`. Operações fica de fora: lá as linhas têm sequência de leitura.

**23. Aviso de arquivo importado por leitor antigo** (v1.12.0). A v1.8.1 corrigiu a
leitura, mas o cache guarda a linha já normalizada — quem importou antes continuou
vendo número errado sem nenhum sinal na tela. Foi o que aconteceu: a MAMÃE OLÍVIA
aparecia com média de R$ 307.865 (quatro parcelas de ~R$ 770 empilhadas num mês só e
multiplicadas por 100) quando o certo é R$ 770. Cada arquivo passa a guardar a versão
do leitor, e versão antiga acende aviso no card e no badge.

**24. Colunas fixas se cobriam e escondiam os valores** (v1.12.1). Os deslocamentos
das quatro colunas fixas estavam escritos no CSS, calculados para `jan/25 a set/25`.
O prefixo `média · ` da v1.10.0 alargou as colunas sem mover os pontos de parada, e
cada uma passou a avançar por cima da anterior — sumia o valor, que fica encostado à
direita da célula. Na tela parecia dado faltando. Agora os deslocamentos são medidos
depois de montar a tabela.

**25. Filtros de recorte aceitam mais de uma escolha** (v1.13.0), com as seleções
como tags removíveis dentro do campo. Nada marcado continua significando tudo.

**26. Filtro de status do cliente na Comercial** (v1.14.0), começando em **Ativo**.
A carteira tem 732 inativos contra 187 ativos, 24 prospects e 7 ad hoc, então a
matriz abria dominada por quem já saiu. Com o padrão, a aba de Recebimento cai de 209
para 145 clientes — R$ 1,38 mi dos R$ 9,44 mi pertencem a cliente hoje inativo.

## Confirmado, sem ação

**Horas apontadas não devem descontar as pausas.** Em 700 tarefas finalizadas, só 10
têm pausa maior que zero, e nelas a pausa quase sempre supera a duração — uma tem 22
min de duração e 5.597 de pausa. São contadores independentes: subtrair daria hora
negativa. `src/api/hub.js` fica como está.

## Em aberto

**A sincronização incremental perde registro que entra na janela pelo tempo passar.**
O incremental filtra por `updatedAt`, mas a janela termina em "hoje" e avança sozinha.
Uma tarefa com vencimento hoje, criada há três semanas e não tocada desde então, ontem
estava fora da janela e hoje está dentro — e o incremental não a traz, porque o
`updatedAt` é velho. O mês corrente pode ficar subcontado até alguém usar "Recarregar
janela completa". Correção provável: a cada sincronização, recarregar sem filtro de
`updatedAt` uma faixa curta recente (uns 30 dias).

**Duas das quatro áreas são placeholders.** RH e Financeiro aparecem no menu com
"Fonte de dados ainda não configurada". Operações e Comercial têm dados.

**Abril de 2026 não tem um único recebimento.** Zero parcelas com vencimento em
04/2026 no relatório exportado, em qualquer centro de custo, e zero finalizações no
mês. A série pula de mar/2026 (R$ 461.719,66) direto para mai/2026 (R$ 510.997,97), e
os NIDs #18353 a #18495 não aparecem. As mensalidades de maio foram criadas
manualmente em 27/04, enquanto as anteriores nasciam do "Sistema" no dia 1º — parece
mudança de processo na virada. Enquanto não se resolver no Hub, abr/2026 aparece
`R$ 0` na matriz. **A conferir no Hub, não tem conserto no código.**

**O relatório de recebimentos precisa ser exportado por data de vencimento.** A
primeira exportação foi filtrada por "finalizada em", e a competência da matriz é o
vencimento: nesse arranjo, a parcela que vence dentro da janela mas foi baixada fora
dela não vem no arquivo.

**O financeiro continua entrando à mão.** A API não expõe pagamentos nem
recebimentos, então Custo e Recebimento dependem de subir os dois CSV a cada
atualização.

**Supabase está montado e não é usado.** `src/supabase.js` e `supabase/schema.sql`
existem, mas nenhum arquivo importa o módulo — o estado vive só no IndexedDB, por
máquina. Ou liga a persistência por usuário, ou remove o código e a dependência.

**Conferir a primeira sincronização real contra as planilhas.** A sync só passou a
funcionar na v1.4.3.

**As tags de versão pularam da v1.1.0 para a v1.4.3.** Faltam 1.2.0 a 1.4.2.
