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
injetando o header `x-secret-key` no servidor. A chave nunca chega ao navegador.

## Integração com o Hub

| Item | Valor |
|---|---|
| Upstream | `https://hub.formatar.com.br/v1` |
| Autenticação | header `x-secret-key` |
| Endpoints usados | `GET /meetings`, `GET /tasks`, `GET /customers` |
| Janela sincronizada | 1º de janeiro do ano anterior até hoje (móvel) |

A sincronização roda automaticamente ao abrir o dashboard, de forma incremental
(`updatedAt[$gte]` a partir do último sync). O botão **Recarregar janela completa**,
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

O nome `Authorization` também é aceito, por compatibilidade. Depois de criar o
segredo é necessário um novo deploy para que a função passe a enxergá-lo. Sem a
variável, o dashboard abre normalmente e a engrenagem indica que a conexão não
está configurada.

`functions/api/[[path]].js` é a Pages Function que faz o proxy: aceita apenas `GET`
e apenas os recursos `meetings`, `tasks` e `customers`.

## Logos

Coloque os arquivos oficiais em `public/`:

- `logo-branca.png` — tema escuro
- `logo-preta.png` — tema claro

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

A versão atual do projeto é `1.4.0`.
