# Diagnóstico e Instruções de Deploy

## Causa do erro "Falha de ligação ao gerar o pagamento"

O erro ocorre porque o `checkout.html` faz uma chamada `fetch('api/stripe-transaction', ...)` que precisa de um **servidor Node.js** para ser processada. Os arquivos em `/api/*.js` são **funções serverless** (estilo Vercel/Next.js) e **não funcionam** quando o projeto é hospedado num servidor de ficheiros estáticos (Apache, Nginx, cPanel, etc.).

Quando o browser tenta chamar `api/stripe-transaction` num hosting estático, recebe um erro 404 ou de rede — e o `catch` do JavaScript exibe a mensagem:

> *"Falha de ligação ao gerar o pagamento. Verifique a sua internet e tente novamente."*

---

## Solução: Deploy no Vercel (recomendado)

Este projeto foi **desenhado para o Vercel**. Os arquivos `vercel.json` e `package.json` foram adicionados a este ZIP para que o deploy funcione corretamente.

### Passo 1 — Criar conta no Vercel

Aceda a [vercel.com](https://vercel.com) e crie uma conta gratuita (pode usar GitHub, GitLab ou e-mail).

### Passo 2 — Fazer upload do projeto

1. No dashboard do Vercel, clique em **"Add New Project"**
2. Escolha **"Deploy from CLI"** ou faça upload via GitHub
3. Se preferir sem GitHub: instale o Vercel CLI com `npm i -g vercel` e corra `vercel` na pasta do projeto

### Passo 3 — Configurar as variáveis de ambiente

No painel do projeto no Vercel, vá a **Settings → Environment Variables** e adicione:

| Variável | Descrição |
|---|---|
| `STRIPE_SECRET_KEY` | Chave secreta do Stripe (começa com `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Secret do webhook do Stripe (começa com `whsec_...`) |
| `SUPABASE_URL` | URL do projeto Supabase (ex.: `https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de serviço do Supabase |
| `TIKTOK_ACCESS_TOKEN` | Token de acesso da TikTok Events API |
| `FB_ACCESS_TOKEN` | Token de acesso da Meta Conversions API |
| `FB_PIXEL_ID` | ID do pixel Meta (já definido no código como `1698181571306790`) |
| `VENDAS_TOKEN` | Token de acesso ao endpoint `/api/vendas` (qualquer string secreta) |

### Passo 4 — Configurar o webhook do Stripe

No painel do Stripe, em **Developers → Webhooks**, adicione um endpoint:
- URL: `https://SEU-DOMINIO.vercel.app/api/stripe-webhook`
- Eventos: `payment_intent.succeeded`, `payment_intent.payment_failed`

---

## Alternativa: Hosting com suporte a Node.js

Se preferir não usar o Vercel, pode usar qualquer hosting com suporte a Node.js:

- **Railway** ([railway.app](https://railway.app)) — gratuito, fácil
- **Render** ([render.com](https://render.com)) — gratuito com limitações
- **DigitalOcean App Platform** — pago

Nestes casos, será necessário criar um servidor Express para servir os endpoints. Contacte o suporte para assistência.

---

## Não é possível usar hosting estático (cPanel, Hostinger, etc.)

Hosting estático **não executa JavaScript no servidor**. Os ficheiros `/api/*.js` precisam de um runtime Node.js. Não há forma de fazer este projeto funcionar num hosting estático sem reescrever toda a lógica de pagamento.
