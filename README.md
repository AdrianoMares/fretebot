# 🚀 FreteAZ Secure API (Render Version)

Esta é a versão otimizada do servidor com:
- Redis cache (5 minutos por cotação)
- Rate-limit (20 req/min por IP)
- CORS restrito
- Helmet + Compression
- Endpoint público `/api/public/quote`

## Deploy

1. Substitua `index.js`, `rateLimit.js`, e `package.json` no seu repositório do GitHub.
2. Faça commit e push:
   ```bash
   git add .
   git commit -m "update: segurança e cache redis"
   git push
   ```
3. O Render fará o deploy automaticamente.

## Teste

- Público: `POST https://fretebot.onrender.com/api/public/quote`
- Privado: `POST https://fretebot.onrender.com/cotacao`
- Health: `GET https://fretebot.onrender.com/health`
