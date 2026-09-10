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

**3. Carga em três fases encadeadas** — últimos 6 meses, restante do ano corrente,
ano anterior. Fases vazias são descartadas, o que resolve o começo do ano sem regra
especial. Verificado contra a API: a fase 1 fechou em 4,3 min, atravessando 4 janelas
de limite, e trouxe exatamente abr–set/2026, nada fora do intervalo.

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

**Três das quatro áreas são placeholders.** RH, Comercial e Financeiro aparecem no
menu com "Fonte de dados ainda não configurada". Só Operações tem dados.

**Pagamentos continuam entrando à mão.** A API não expõe pagamentos, então a aba de
Custo depende de subir `Pagamentos.csv` a cada atualização.

**Supabase está montado e não é usado.** `src/supabase.js` e `supabase/schema.sql`
existem, mas nenhum arquivo importa o módulo — o estado vive só no IndexedDB, por
máquina. Ou liga a persistência por usuário, ou remove o código e a dependência.

**Conferir a primeira sincronização real contra as planilhas.** A sync só passou a
funcionar na v1.4.3.

**As tags de versão pularam da v1.1.0 para a v1.4.3.** Faltam 1.2.0 a 1.4.2.
