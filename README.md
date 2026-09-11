# Dashboard Conselho Formatar

Dashboard de indicadores operacionais. Reuniões e tarefas vêm da API do Formatar Hub;
os relatórios de **pagamentos** e **recebimentos** continuam sendo importados
manualmente, porque a API não expõe nada do financeiro.

## Desenvolvimento

```bash
npm install
cp .env.example .env.local   # preencha HUB_API_SECRET_KEY
npm run dev
```

O servidor do Vite expõe `/api/v1/*` como proxy para `https://hub.formatar.com.br/v1`,
injetando o header `Authorization: Bearer <secret key>` no servidor. A chave nunca chega ao navegador.

## Integração com o Hub

| Item | Valor |
|---|---|
| Upstream | `https://hub.formatar.com.br/v1` |
| Autenticação | header `Authorization: Bearer <secret key>` |
| Endpoints usados | `GET /meetings`, `GET /tasks`, `GET /customers`, `GET /teams`, `GET /users`, `GET /user-groups`, `GET /meeting-types` |
| Limite de requisições | **50 por minuto** (`RateLimit-Policy: 50;w=60`) |
| Tamanho da página | 100 linhas, fixo — a API ignora `limit`, `perPage` e afins |
| Janela sincronizada | 1º de janeiro do ano anterior até hoje (móvel) |

### Limite de requisições

A API aceita 50 requisições por minuto e entrega 100 linhas por página, sem
parâmetro para pedir páginas maiores. Uma carga completa da janela passa de 780
páginas, então **esperar a janela reabrir faz parte do fluxo normal** e a primeira
carga leva por volta de 15 minutos.

O proxy repassa os headers `RateLimit-*` e `Retry-After` justamente para o navegador
poder se autorregular: `src/api/hub.js` segura a próxima chamada quando restam
poucas requisições e, num `429`, espera o tempo que a própria API informa. Cada
recurso é gravado no IndexedDB assim que termina, para que fechar a aba no meio da
primeira carga não custe tudo o que já foi baixado.

### Carga em fases

Como a janela inteira leva uns 16 minutos, a carga é fatiada **mês a mês, do mais
recente para o mais antigo**, e cada mês encadeia o seguinte em segundo plano. O mês
corrente fica visível em torno de **5 segundos** e a linha do tempo cresce para trás
enquanto a pessoa já analisa.

A classificação dos clientes (`GET /customers`, 10 páginas) é buscada **depois** do
primeiro mês: ela não entra em nenhum número da tabela, só no filtro, e buscá-la
antes atrasava a primeira competência em segundos gastos olhando para tela vazia.

Fatiar em blocos grandes não resolvia o primeiro acesso: a tela só libera quando o
bloco fecha em reuniões *e* tarefas, então um bloco de 6 meses deixava a tela vazia
por 4 minutos mesmo com milhares de reuniões já em cache. Com a fatia de um mês não
existe caso especial de virada de ano.

O que a tela exibe é decidido pela **cobertura**, gravada junto do cache: ela só
avança quando a fase fecha em *todos* os recursos. Sem isso a tela mostraria
reuniões cheias e zero tarefas no intervalo entre uma e outra. Pela mesma razão, um
arquivo do financeiro com meses fora da cobertura não estica a linha do tempo — as
linhas ficam no cache e entram quando a fase correspondente terminar.

Enquanto os dois anos não estiverem cobertos pelos mesmos meses, as colunas de ano
anterior e de variação não aparecem, e a coluna acumulada é rotulada com o período
que ela realmente soma. Comparar jan–set de um ano contra abr–set do outro seria uma
variação inventada.

A sincronização roda automaticamente ao abrir o dashboard, de forma incremental
(`updatedAt[$gte]` a partir do último sync). A faixa dos últimos 30 dias é sempre
recarregada **sem** esse filtro: a janela termina em "hoje" e avança sozinha, então
uma tarefa que vence hoje, criada e não tocada há semanas, entraria na janela sem
que o `updatedAt` mudasse — e o incremental a perderia. O botão **Recarregar janela completa**,
na engrenagem, refaz a busca inteira — é o que reconcilia registros excluídos no Hub.
Os dados ficam em cache no IndexedDB do navegador, então o dashboard abre preenchido
mesmo antes de a sincronização terminar.

### Mapeamento de status

| API | Dashboard |
|---|---|
| `unscheduled` | Previsto |
| `sent` | Enviado |
| `scheduled` | Agendado |
| `pending` | Pendente |
| `started` | Iniciado |
| `paused` | Pausado |
| `finished` | Finalizado |
| `canceled_by_customer` | Cancelado pelo cliente |
| `canceled_by_consultant` | Cancelado pelo consultor |
| `canceled_by_scheduling` | Cancelado pelo agendamento |
| `canceled_by_customer_proposal` | Proposta cancelada pelo cliente |
| `canceled` | Cancelado |

A competência de uma reunião vem de `startDate` e a de uma tarefa de `dueDate`.
As horas apontadas usam `durationInMinutes`. A classificação do cliente vem de
`GET /customers` e é reaplicada ao cache a cada sincronização.

## Build Cloudflare Pages

Toda a configuração de publicação vive no painel do Cloudflare, em
**Configurações → Build**:

| Campo | Valor |
|---|---|
| Comando da build | `npm run build` |
| Diretório de saída da build | `dist` |
| Predefinição da estrutura | Nenhum |

> O projeto **não** deve ter um `wrangler.toml`. Quando esse arquivo existe, o
> Cloudflare passa a tratá-lo como fonte de verdade e **ignora as variáveis e
> segredos do painel** — o que impede a Function de ler `HUB_API_SECRET_KEY`,
> já que uma secret jamais pode ser versionada no repositório.

### Variável obrigatória

Em **Cloudflare Pages → Configurações → Variáveis e segredos**, crie um segredo:

| Nome | Valor |
|---|---|
| `HUB_API_SECRET_KEY` | a secret key do Hub, sem prefixo `Bearer` |

Guarde a chave crua: o prefixo `Bearer` é montado pelo proxy na hora da chamada.
Depois de criar o segredo é necessário um novo deploy para que a função passe a
enxergá-lo. Sem a variável, o dashboard abre normalmente e a engrenagem indica que
a conexão não está configurada.

`functions/api/[[path]].js` é a Pages Function que faz o proxy: aceita apenas `GET`
e apenas os recursos `meetings`, `tasks` e `customers`.

## Leitura das tabelas

### Coluna de período: média ou soma

O seletor **Coluna de período**, ao lado dos filtros, decide o que as duas colunas de
período mostram. O padrão é **Média mensal**, e o rótulo avisa (`média · jan/26 a
set/26`). A escolha vale para as duas áreas e fica guardada no navegador.

Em **média**, a regra é uma só para todas as linhas: a média dos meses **com valor**.
Mês zerado fica fora do divisor porque não é um mês fraco, é um mês em que aquela
linha não existia. BENE PISCINAS recebeu R$ 3.950 uma única vez, em jul/2026: a média
é R$ 3.950, não R$ 439. Já SÉCULO XXI, com movimento em 7 dos 9 meses, soma R$ 9.000
e tem média de R$ 1.286.

É por isso que a média é o padrão: o acumulado distorce a comparação entre anos
sempre que os dois lados cobrem períodos de atividade diferentes — o que é a regra
numa carteira em que cliente entra e sai.

Em **soma**, cada linha volta a agregar do seu jeito: contagens de distintos usam
`total(months)` e contam o distinto do período inteiro; percentuais e razões usam
`aggregate: 'average'`; o resto soma.

### Ordenação

Todo cabeçalho ordena por clique, em Operações e na Comercial. O primeiro clique
numa coluna de número traz do **maior para o menor**, que é o que se quer olhar; na
coluna de rótulo, de A a Z. O clique seguinte inverte, e o terceiro volta à ordem
natural da área — o ranking do ano corrente na Comercial, a sequência de leitura dos
indicadores em Operações, que não é alfabética nem numérica.

Linhas sem valor comparável — a variação de quem não tinha movimento no ano anterior
— vão para o fim nos dois sentidos: elas não são as menores, são as que não têm
resposta.

Trocar de aba ou escolher uma competência específica volta à ordenação padrão: a
coluna ordenada pode simplesmente não existir do outro lado.

## Área Comercial

Matriz de cliente por mês, alimentada pelas atividades **finalizadas**, com cinco
visões em abas: tempo de duração (em `HH:MM`), quantidade de reuniões, quantidade de
participantes, recebimento e recebimento por hora. As colunas de período somam,
exceto recebimento por hora, que é a **razão dos totais** — somar razões mensais
daria um número sem sentido.

A aba de quantidade de reuniões conta a mesma coisa que "Reuniões realizadas" em
Operações, mas repartida por cliente — e por isso o total das duas telas **não
bate**: a matriz comercial só conta atividade com cliente vinculado, e a reunião
interna não pertence a linha nenhuma daqui.

### De onde vem cada vínculo

| Filtro | Caminho |
|---|---|
| Nome do cliente | `customers.tradingName` — o campo **Nome** da tela do cliente. A razão social (`companyName`) fica guardada só como chave de reserva para casar relatórios importados à mão |
| Classificação | `customers.classification` |
| Time | `tasks.team` direto; a reunião chega pelo `meetingType`, e um tipo pode pertencer a mais de um time |
| Grupo de Usuário | responsável e participantes → `users.userGroup` |

Ao filtrar, a **duração conta inteira** — não se reparte uma reunião de uma hora
entre times. Já a contagem de participantes respeita o filtro: com um grupo ativo,
uma reunião de três pessoas soma só quem pertence a ele.

### Recebimento

Vem do **`Recebimentos.csv`** — o contas a *receber*, importado à mão na engrenagem.
Não confundir com o `Pagamentos.csv`, que é o contas a *pagar* e alimenta a aba de
Custo em Operações: lá a "entidade" é fornecedor ou funcionário, não cliente. Até a
v1.6.1 a matriz comercial lia o arquivo errado, e por isso mostrava `R$ 0` em todas
as linhas.

| Regra | Valor |
|---|---|
| Competência | mês do **Vencimento** — a cobrança pertence ao mês que ela remunera |
| Valor | **Valor pago**, que já inclui juros e multa |
| Filtro | só `Status = Pago` e `Centro de custo = Consultoria Empresarial` |
| Chave de deduplicação | `NID` da parcela |
| Cliente | pelo nome: `Entidade` → `tradingName`, com `companyName` de reserva |

Três decisões que valem explicação:

**Uma linha por `NID`.** O relatório exportado repete parcelas inteiras — a mesma
sai duas, três, até cinco vezes, idêntica nas 23 colunas. Somar como veio inflou o
recebimento em R$ 129 mil na primeira exportação. Parcelamento de verdade não se
perde nisso, porque cada parcela tem NID próprio: `"1 de 5"` e `"2 de 5"` da mesma
fatura continuam sendo duas linhas, com vencimentos diferentes.

**Casamento só por nome.** O `NID` do relatório identifica a *parcela*, não o
cliente — casar por ele encontraria o cliente errado por coincidência de número. A
coluna `Entidade` traz o Nome do cadastro, e é por isso que a v1.6.2 vinha antes:
com `tradingName`, 2.651 de 2.658 parcelas casam direto; com `companyName`, 5.

**Só Consultoria Empresarial.** Recrutamento (Formatar RH) e a assinatura de BI
(Simple) são receita do mesmo cliente, mas as horas desta tela são só de
consultoria — somar os três distorceria o recebimento por hora de quem contrata RH.

O que fica de fora por qualquer um dos dois motivos — escopo ou cliente não
encontrado — aparece no detalhe da área com a contagem e o valor. Nada é descartado
em silêncio.

Como o arquivo do financeiro não tem time nem grupo de usuário, esses dois filtros
ficam desabilitados nas abas de recebimento: repartir R$ por time seria inventar.

> Ao exportar, filtre por **data de vencimento**, não por "finalizada em". A
> competência aqui é o vencimento; filtrar pela finalização deixa de fora a parcela
> que vence dentro da janela mas foi baixada fora dela.

### Leitura dos CSV

Os dois relatórios do financeiro são lidos como **texto cru** (`XLSX.read(texto,
{ type: 'string', raw: true })`), e quem converte é `normalizeNumber` e
`normalizeDate`. Deixar o SheetJS adivinhar o tipo de cada célula, que era o que
acontecia até a v1.8.0, corrompia os dois campos que mais importam:

| No arquivo | O que o SheetJS entregava | Efeito |
|---|---|---|
| `1.300,00` | `1.3` | o ponto de milhar vira decimal e os centavos somem |
| `900,00` | `90000` | sem ponto de milhar, a vírgula some e o valor multiplica por 100 |
| `01/12/2024` | 12 de janeiro de 2024 | dia e mês trocam sempre que o dia cabe como mês |

Não era um caso de borda: atingia 45% das parcelas de recebimento e 93% das de
pagamento, e inflava o recebimento de R$ 10,0 mi para R$ 18,6 mi. As linhas com dia
maior que 12 escapavam, porque não podiam ser confundidas com mês — o que deixava o
defeito com cara de dado irregular, não de bug.

O BOM é removido antes de entregar o texto ao SheetJS: com ele na frente, a primeira
aspa deixa de ser reconhecida como início de campo e o cabeçalho da coluna 1 vira a
chave literal `﻿"Vencimento"`, o que faz o arquivo inteiro entrar vazio. Arquivos em
ANSI são detectados pelo caractere de substituição e relidos como `windows-1252`,
senão os acentos quebram e o nome do cliente deixa de casar com o cadastro.

O `.xlsx` continua pelo caminho binário: lá número é número e data é data, sem texto
para interpretar errado.

## Logos

Coloque os arquivos oficiais em `public/`:

- `logo-branca.png` — tema escuro
- `logo-preta.png` — tema claro

## Ícone da aba

`public/Icone-Aba.png` é a arte de origem. Dela saem, já quadrados e centrados,
`favicon.ico` (16/32/48), `favicon-512.png`, `favicon-dark-512.png` e
`apple-touch-icon.png`, ligados em `index.html`. Como o logo é um traço preto sobre
fundo transparente, a variante branca é servida por `prefers-color-scheme: dark` —
sem ela o ícone desaparece na barra de abas de quem usa o navegador em tema escuro.
Ao trocar a arte, regere os quatro arquivos a partir do novo `Icone-Aba.png`.

## Supabase

1. Crie um projeto no Supabase.
2. Execute `supabase/schema.sql` no SQL Editor.
3. Ative autenticação por e-mail ou provedor corporativo.
4. Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no `.env.local`.

A chave `service_role` nunca deve ser usada no navegador ou no Cloudflare Pages como
variável `VITE_*`.

## Versionamento

Este projeto segue Versionamento Semântico no formato `MAJOR.MINOR.PATCH` (`X.Y.Z`):

- `MAJOR`: alteração incompatível com a versão anterior.
- `MINOR`: funcionalidade nova compatível com o uso existente.
- `PATCH`: correção compatível ou ajuste pequeno.

A versão atual do projeto é `1.10.1`.
