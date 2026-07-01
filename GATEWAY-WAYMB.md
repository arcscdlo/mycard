# Gateway WayMB — Guia de Integração

Documentação prática de como integrar o gateway de pagamentos **WayMB** (MB WAY e
Multibanco, mercado Portugal 🇵🇹) num projeto novo. Baseado na implementação real
deste repositório (`api/transaction.js`, `api/status.js`, `api/webhook.js`).

> **Moeda:** EUR. **Métodos:** `mbway` e `multibanco`.
> **Base URL da API:** `https://api.waymb.com`

---

## 1. Visão geral do fluxo

```
┌──────────┐   POST /api/transaction   ┌─────────────┐   POST /transactions/create   ┌─────────┐
│ Frontend │ ────────────────────────► │  Seu backend │ ────────────────────────────► │  WayMB  │
│ checkout │ ◄──────────────────────── │  (serverless)│ ◄──────────────────────────── │   API   │
└──────────┘   { transactionId, ... }  └─────────────┘   { transactionID, refs... }   └─────────┘
     │                                                                                      │
     │  polling a cada ~4s                                                                  │ paga no app/ATM
     │  GET /api/status?id=...                                                              ▼
     │ ──────────────────────────► backend ──► POST /transactions/info ──► WayMB    ┌──────────────┐
     │ ◄────────────────────────── { status: APPROVED|PENDING|REFUSED }            │ WayMB chama  │
     │                                                                              │ callbackUrl  │
     └────────────────────────────────────────────────────────────────────────────│ POST /webhook│
                                                                                    └──────────────┘
```

Há **dois caminhos** para descobrir que o pagamento foi concluído — use ambos por
redundância:

1. **Webhook** (push): a WayMB chama o `callbackUrl` que você enviar na criação.
2. **Polling de status** (pull): o frontend pergunta ao seu backend de tempos em
   tempos. Útil porque o webhook pode atrasar ou o cliente fechar a aba.

---

## 2. Credenciais e variáveis de ambiente

Cada conta WayMB tem **3 segredos**. Nunca exponha no frontend — eles vivem só no backend.

| Variável                  | Descrição                                    |
| ------------------------- | -------------------------------------------- |
| `WAYMB_CLIENT_ID`         | Client ID da conta                           |
| `WAYMB_CLIENT_SECRET`     | Client Secret da conta                       |
| `WAYMB_ACCOUNT_EMAIL`     | E-mail da conta WayMB que recebe o pagamento |

Este projeto suporta **múltiplas contas** (roteamento por origem do lead). Se você
só precisa de uma conta, ignore a seção de roteamento e use apenas estas três.
Para a segunda conta ("google/b2" aqui) os nomes têm prefixo:

```
WAYMB_GOOGLE_CLIENT_ID
WAYMB_GOOGLE_CLIENT_SECRET
WAYMB_GOOGLE_ACCOUNT_EMAIL
```

Na Vercel: defina-as em **Project → Settings → Environment Variables** (não comite no repo).

---

## 3. Criar transação — `POST /transactions/create`

Esta é a chamada que gera o pagamento. **Sempre feita server-side** (os segredos
não podem ir para o browser).

### Request para a WayMB

```http
POST https://api.waymb.com/transactions/create
Content-Type: application/json
Accept: application/json
```

```json
{
  "client_id": "SEU_CLIENT_ID",
  "client_secret": "SEU_CLIENT_SECRET",
  "account_email": "conta@exemplo.com",
  "amount": 19.90,
  "method": "mbway",
  "currency": "EUR",
  "paymentDescription": "Apple Card - Envio Expresso",
  "callbackUrl": "https://seusite.com/api/webhook",
  "payer": {
    "name": "João Silva",
    "email": "joao@exemplo.com",
    "document": "123456789",
    "phone": "+351912345678"
  }
}
```

**Notas importantes sobre o payload:**

- `amount` é **float em euros** (`19.90`), não cêntimos. O frontend costuma mandar
  cêntimos; converta com `cents / 100`.
- `method`: `"mbway"` ou `"multibanco"`.
- `document` = **NIF** português (9 dígitos, só números).
- `phone` no formato `+351XXXXXXXXX` (telemóvel PT tem 9 dígitos; prefixo `+351`).
- `callbackUrl` é **opcional**. Se você **omitir**, a WayMB **não chama o webhook**
  (útil para transações de teste — não dispara conversões/pixels).

### Resposta da WayMB

Campos relevantes (variam por método):

```jsonc
{
  "transactionID": "abc123def456",   // id da transação (também pode vir como "id")
  // Para multibanco:
  "referenceData": {
    "entity": "21800",
    "reference": "123 456 789",
    "expiresAt": "2026-06-25T12:00:00Z"
  },
  // Para mbway:
  "generatedMBWay": true             // true = push enviado ao app do cliente
}
```

- **MB WAY:** o cliente recebe uma **notificação push** no app MB WAY e confirma lá.
  Não há referência a mostrar — só aguardar.
- **Multibanco:** você mostra **Entidade + Referência + Valor** para o cliente pagar
  no homebanking/ATM. A referência **expira** (`expiresAt`).

### Implementação de referência (Node serverless)

Pontos-chave do `api/transaction.js`:

- **Timeout + retry:** `AbortController` com 15s, até 3 tentativas com backoff
  exponencial (`1s, 2s, 4s`). Erros 4xx **não** são retentados (não adianta).
- **Validação antes de chamar a WayMB:** nome, e-mail, NIF (9 dígitos), telemóvel
  (9 dígitos), valor mínimo (€1,00 = 100 cêntimos).
- **`callbackUrl` dinâmico:** montado a partir do host da request
  (`x-forwarded-host`/`host` + `/api/webhook`), assim funciona em qualquer domínio
  sem hardcode.

```js
const WAYMB_BASE = 'https://api.waymb.com';

const payload = {
  client_id: process.env.WAYMB_CLIENT_ID,
  client_secret: process.env.WAYMB_CLIENT_SECRET,
  account_email: process.env.WAYMB_ACCOUNT_EMAIL,
  amount,                       // float em EUR
  method,                       // 'mbway' | 'multibanco'
  currency: 'EUR',
  paymentDescription: product,
  payer: { name, email, document, phone },
};
if (callbackUrl) payload.callbackUrl = callbackUrl; // opcional

const r = await fetch(`${WAYMB_BASE}/transactions/create`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify(payload),
});
const data = await r.json();
const transactionId = String(data.transactionID || data.id || '');
```

---

## 4. Consultar status — `POST /transactions/info`

Para saber se a transação foi paga, consulte (server-side) passando o `id`:

```http
POST https://api.waymb.com/transactions/info
Content-Type: application/json
```

```json
{ "id": "abc123def456" }
```

Resposta (campos úteis):

```jsonc
{
  "status": "COMPLETED",        // ou PENDING, DECLINED, EXPIRED, ...
  "amount": 19.90,
  "updatedAt": "2026-06-24T15:30:00Z",
  "payer": { "email": "...", "phone": "...", "document": "..." }
}
```

### Normalização de status (recomendado)

A WayMB usa vários verbos; normalize para 3 estados no seu backend:

| Status WayMB                                            | Normalizado |
| ------------------------------------------------------ | ----------- |
| `COMPLETED`, `PAID`, `APPROVED`                        | `APPROVED`  |
| `DECLINED`, `REFUSED`, `CANCELLED`, `EXPIRED`, `FAILED`| `REFUSED`   |
| qualquer outro (incl. erro de rede)                    | `PENDING`   |

> Em caso de erro/timeout ao consultar, **devolva `PENDING`** (HTTP 200), nunca um
> erro — o frontend simplesmente continua o polling.

O frontend faz polling via `GET /api/status?id=<transactionId>` a cada ~4 segundos
e para quando recebe `APPROVED` ou `REFUSED`.

---

## 5. Webhook — `POST /api/webhook` (recebido da WayMB)

A WayMB chama o `callbackUrl` quando o status muda. **Regra de ouro:**

> ⚠️ **O webhook DEVE sempre responder HTTP 200** — mesmo com payload inválido,
> JSON malformado, body vazio ou exceção interna. A WayMB **retenta** a entrega
> até receber 200; após várias falhas seguidas (4xx/5xx) ela **suspende a conta**.

Corpo típico recebido:

```jsonc
{
  "transactionId": "abc123def456",   // pode vir como "id"
  "status": "COMPLETED",
  "amount": 19.90,
  "currency": "EUR",
  "payer": { "name": "...", "email": "...", "document": "...", "phone": "..." }
}
```

Boas práticas implementadas em `api/webhook.js`:

- **Desabilitar o body-parser** do framework (na Vercel: `config.api.bodyParser = false`)
  e ler o corpo cru você mesmo. Assim um JSON malformado **não** faz o runtime
  rejeitar com 400 antes do seu código rodar.
- **GET no mesmo endpoint** retorna 200 — serve de health-check (o painel da WayMB
  testa o URL).
- **Idempotência:** deduplique pelo `transactionId` (ex.: `Map` em memória, ou Vercel
  KV / Redis em escala) para não disparar a mesma conversão duas vezes — webhook e
  polling podem ambos detectar o pagamento.
- **Só agir quando `status === 'COMPLETED'`.** É aí que você libera o produto /
  dispara o Purchase nos pixels (Meta CAPI, TikTok Events API, etc.).

```js
module.exports = async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ok: true });

  let body = await lerCorpo(req);                 // tolerante a malformado
  try {
    const txId = String(body.transactionId || body.id || '');
    const status = String(body.status || '').toUpperCase();
    if (txId && status === 'COMPLETED' && !alreadyFired(txId)) {
      markFired(txId);
      // ... liberar pedido / disparar Purchase server-side ...
    }
  } catch (e) {
    console.error('[webhook] exceção tratada', e.message);
  }
  return res.status(200).json({ ok: true });       // SEMPRE 200
};

module.exports.config = { api: { bodyParser: false } }; // Vercel
```

---

## 6. Frontend (cliente)

O browser **nunca** fala direto com a WayMB. Ele só chama o **seu** backend:

```js
// 1) Criar pagamento
const res = await fetch('/api/transaction', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amount: amountCents,           // cêntimos; backend converte para EUR
    method: 'mbway',               // ou 'multibanco'
    payerName: 'João Silva',
    email: 'joao@exemplo.com',
    phone: '912345678',
    document: '123456789',         // NIF
    productName: 'Apple Card - Envio Expresso',
  }),
});
const result = await res.json();
// result = { success, transactionId, method, amount, currency, status,
//            entity?, reference?, expiresAt?, mbwayPushed?, phone? }

// 2) Mostrar instruções:
//    - mbway      → "confirme no app", aguardar
//    - multibanco → mostrar result.entity / result.reference / result.amount

// 3) Polling de status até aprovar
const poll = setInterval(async () => {
  const r = await fetch('/api/status?id=' + encodeURIComponent(result.transactionId));
  const s = await r.json();
  if (s.status === 'APPROVED') { clearInterval(poll); mostrarSucesso(); }
  if (s.status === 'REFUSED')  { clearInterval(poll); mostrarErro(); }
}, 4000);
```

---

## 7. Checklist para um projeto novo

1. [ ] Obter `client_id`, `client_secret` e `account_email` no painel WayMB.
2. [ ] Definir as 3 variáveis de ambiente no backend (nunca no frontend).
3. [ ] Criar `POST /api/transaction` → chama `POST /transactions/create`
       (validação + timeout/retry + `callbackUrl` dinâmico).
4. [ ] Criar `GET/POST /api/status` → chama `POST /transactions/info` e normaliza o status.
5. [ ] Criar `POST /api/webhook` → **sempre 200**, body-parser desligado, idempotente.
6. [ ] Cadastrar o URL do webhook no painel WayMB (ou enviá-lo via `callbackUrl`).
7. [ ] Frontend: criar transação → mostrar refs/push → fazer polling de status.
8. [ ] Testar sem `callbackUrl` (modo teste) para não disparar conversões reais.

---

## 8. Armadilhas comuns (aprendidas na prática)

- **`amount` em euros, não cêntimos.** Mandar `1990` em vez de `19.90` cobra €1990.
- **Webhook que não responde 200 derruba a conta.** Trate tudo e devolva 200.
- **Webhook e polling disparam o Purchase duas vezes** se você não deduplicar pelo
  `transactionId`.
- **`callbackUrl` ausente = sem webhook.** Ótimo para testes, péssimo se esquecido
  em produção.
- **NIF e telemóvel** são validados como 9 dígitos cada — limpe a máscara antes de enviar.
- **Erro 401 da WayMB** geralmente é credencial errada/conta trocada; trate como 502
  para o cliente (não exponha detalhe) e logue server-side.

---

### Endpoints WayMB usados (resumo)

| Ação              | Método/URL WayMB                          |
| ----------------- | ----------------------------------------- |
| Criar transação   | `POST https://api.waymb.com/transactions/create` |
| Consultar status  | `POST https://api.waymb.com/transactions/info`   |
| Webhook (push)    | a WayMB chama o seu `callbackUrl`         |

### Seus endpoints (proxy backend) usados pelo frontend

| Ação              | Seu endpoint                  |
| ----------------- | ----------------------------- |
| Criar pagamento   | `POST /api/transaction`       |
| Consultar status  | `GET /api/status?id=<txId>`   |
| Receber webhook   | `POST /api/webhook`           |
