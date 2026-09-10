# Dashboard Conselho Formatar

Dashboard de indicadores operacionais. Reuniões e tarefas vêm da API do Formatar Hub;
o relatório de pagamentos continua sendo importado manualmente (a API não expõe pagamentos).

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
| Endpoints usados | `GET /meetings`, `GET /tasks`, `GET /customers` |
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

Como a janela inteira leva uns 16 minutos, a primeira carga é fatiada da mais
recente para a mais antiga, e cada fase encadeia a seguinte em segundo plano:

| Fase | Período | Pronto em |
|---|---|---|
| 1 | últimos 6 meses | ~4,5 min |
| 2 | restante do ano corrente | ~6,5 min |
| 3 | ano anterior | ~16 min |

Fases vazias são descartadas, e é isso que faz o começo do ano funcionar sem regra
especial: em janeiro os "últimos 6 meses" já invadem o ano anterior e a fase 2 some.

O que a tela exibe é decidido pela **cobertura**, gravada junto do cache: ela só
avança quando a fase fecha em *todos* os recursos. Sem isso a tela mostraria
reuniões cheias e zero tarefas no intervalo entre uma e outra. Pela mesma razão, um
`Pagamentos.csv` com meses fora da cobertura não estica a linha do tempo — as linhas
ficam no cache e entram quando a fase correspondente terminar.

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

A versão atual do projeto é `1.5.0`.
