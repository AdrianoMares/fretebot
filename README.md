
# FreteBot v5.0

Servidor Node (Render) que:
- Faz **login no Posta Já** e guarda o token em cache (arquivo local ou **Redis** se disponível);
- Expõe **/cotacao** para cotações em tempo real;
- **Aplica margens** conforme `config.json` (`taxes` multiplicador ou `taxas` em %);
- Usa **rate limit** e **cache de resposta** em Redis (opcional).

## Variáveis de Ambiente (.env)
```
PORT=10000
BACK_BASE=https://back.clubepostaja.com.br
POSTAJA_USUARIO=seu_usuario
POSTAJA_SENHA=sua_senha

# Opcional (enable cache Redis)
REDIS_URL=rediss://:senha@host:port
REDIS_PREFIX=fretebot:
REDIS_TTL_SECONDS=300
```

## Rotas
- `POST /cotacao` — body: { cepOrigem, cepDestino, peso, valor, largura, altura, comprimento }
  - Response: serviços com prazo e **preço final com taxa aplicada** (sem expor margens).

## Deploy no Render
1. Faça push destes arquivos no GitHub.
2. Configure as variáveis de ambiente (Settings → Environment).
3. Build & Deploy.
