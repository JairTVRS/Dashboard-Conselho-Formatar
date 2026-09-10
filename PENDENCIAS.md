# Pendências

Levantado em 2026-09-10. O lote abaixo fecha a **v1.5.0** (MINOR: muda comportamento
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

**Pagamentos continuam entrando à mão.** A API não expõe pagamentos, então a aba de
Custo depende de subir `Pagamentos.csv` a cada atualização.

**Supabase está montado e não é usado.** `src/supabase.js` e `supabase/schema.sql`
existem, mas nenhum arquivo importa o módulo — o estado vive só no IndexedDB, por
máquina. Ou liga a persistência por usuário, ou remove o código e a dependência.

**Conferir a primeira sincronização real contra as planilhas.** A sync só passou a
funcionar na v1.4.3.

**As tags de versão pularam da v1.1.0 para a v1.4.3.** Faltam 1.2.0 a 1.4.2.
