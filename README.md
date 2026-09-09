# Dashboard Conselho Formatar

## Desenvolvimento

```bash
npm install
npm run dev
```

## Build Cloudflare Pages

- Build command: `npm run build`
- Output directory: `dist`
- Framework preset: `Vite`

## Supabase

1. Crie um projeto no Supabase.
2. Execute `supabase/schema.sql` no SQL Editor.
3. Ative autenticação por e-mail ou provedor corporativo.
4. Copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

O estado do dashboard deve ser associado ao usuário autenticado. A chave `service_role` nunca deve ser usada no navegador ou no Cloudflare Pages como variável `VITE_*`.

## Publicação no GitHub

```bash
git init
git add .
git commit -m "Inicializa dashboard de indicadores"
git branch -M main
git remote add origin https://github.com/USUARIO/REPOSITORIO.git
git push -u origin main
```

## Versionamento

Este projeto segue Versionamento Semântico no formato `MAJOR.MINOR.PATCH` (`X.Y.Z`):

- `MAJOR`: alteração incompatível com a versão anterior.
- `MINOR`: funcionalidade nova compatível com o uso existente.
- `PATCH`: correção compatível ou ajuste pequeno.

A versão atual do projeto é `0.1.1`.