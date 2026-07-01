# Guia de Setup / Handoff

Site estático (`site/`) + funções serverless (`api/`), feito para deploy na **Vercel**.
Pagamentos via **Stripe** (MB WAY + Multibanco). Registo de vendas no **Supabase** (Postgres).
Tracking: **TikTok**, **Meta** e **Google Ads**.

> ✅ **Nenhuma credencial está no código.** Todos os segredos ficam em variáveis de ambiente (abaixo).

---

## ⚠️ ANTES DE USAR O ZIP

1. **Apague a pasta `.vercel/`** — ela vincula ao projeto Vercel do dono anterior.
   Se não apagar, um `vercel deploy` publicaria no projeto errado.
2. (Opcional) Apague `.git/` se não quiser o histórico de commits.
3. Não há ficheiro `.env` no ZIP — as credenciais são configuradas na Vercel (passo 1).

---

## 1. Variáveis de ambiente (Vercel → Settings → Environment Variables)

### Stripe — gateway de pagamento
| Variável | Valor |
|----------|-------|
| `STRIPE_SECRET_KEY` | `sk_live_...` da sua conta Stripe |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (ver passo 3) |

### Supabase — banco de vendas
| Variável | Valor |
|----------|-------|
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (`eyJ...`) |

> Dica: dá para integrar o Supabase pelo **Vercel Marketplace**, que injeta estas variáveis automaticamente.

### TikTok — pixel + Conversions API
| Variável | Valor |
|----------|-------|
| `TIKTOK_PIXEL_CODE` | o teu pixel code |
| `TIKTOK_ACCESS_TOKEN` | o teu access token |

### Meta / Facebook — pixel(s) + CAPI
| Variável | Valor |
|----------|-------|
| `FB_PIXELS` | JSON: `[{"id":"PIXEL_ID","token":"EAA..."}]` (1 ou mais pixels) |

### Relatório de vendas
| Variável | Valor |
|----------|-------|
| `VENDAS_TOKEN` | um token à tua escolha (acesso a `/api/vendas?token=...`) |

---

## 2. Banco de dados (Supabase) — criar a tabela

No Supabase → **SQL Editor**, corre:

```sql
create table if not exists public.vendas (
  id bigint generated always as identity primary key,
  transaction_id text unique not null,
  conta text,
  gclid boolean,
  ios_host boolean,
  value numeric,
  currency text default 'EUR',
  method text,
  status text default 'PENDING',
  payer_name text,
  payer_email text,
  payer_document text,
  source text,
  gateway text default 'stripe',
  created_at timestamptz default now(),
  paid_at timestamptz
);
create index if not exists vendas_status_idx  on public.vendas(status);
create index if not exists vendas_paid_at_idx on public.vendas(paid_at);
```

---

## 3. Webhook do Stripe

Stripe Dashboard → **Developers → Webhooks → Add endpoint**:
- **URL:** `https://SEU-DOMINIO/api/stripe-webhook`
- **Eventos:** `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.processing`
- Copia o **Signing secret** (`whsec_...`) para `STRIPE_WEBHOOK_SECRET`.

Também: no Stripe, **ativa MB WAY e Multibanco** em Settings → Payment methods.

---

## 4. Valores fixos no código a trocar pelos teus

| O quê | Onde |
|-------|------|
| Pixel TikTok | `site/tracker.js` (`ttq.load(...)`) e `api/tt.js` (fallback) |
| Meta pixels | `site/tracker.js` (`FB_PIXEL_IDS`) e `api/fb.js` (fallback) |
| Google Ads (ID + label da conversão) | `site/tracker.js` (`GADS_ID`, `GADS_PURCHASE_LABEL`) |
| Domínio `applecardpt.com` | `api/_stripe.js` (`RETURN_URL`), `api/stripe-webhook.js`, `site/tracker.js` (emails) |

---

## 5. Endpoints (referência)

| Endpoint | Função |
|----------|--------|
| `POST /api/stripe-transaction` | cria o pagamento (MB WAY/Multibanco) |
| `GET /api/stripe-status?id=pi_...` | consulta o estado (polling) |
| `POST /api/stripe-webhook` | confirmação do Stripe (venda + Purchase) |
| `GET /api/vendas?token=...` | relatório de vendas (nº e receita) |
