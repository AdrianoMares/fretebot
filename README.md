# Fretebot v4.1 (login via HTTP + token cache + 1 req/s)

## O que inclui
- Login direto via POST `https://back.clubepostaja.com.br/auth/login` com `usuario` e `senha`.
- Cache de token JWT local em `local-cache/token.json` (reutiliza até expirar).
- Limite de requisições: 1 por segundo (Bottleneck).
- Endpoint HTTP `/cotacao` para receber o payload e retornar resultado JSON estruturado.
- Fallbacks e tratamento básico de erros.

## Variáveis de ambiente (no Render)
- `POSTA_USUARIO` (ou POSTA_USER) — e-mail/usário do conta PostaJá.
- `POSTA_SENHA` (ou POSTA_PASS) — senha.
- `BACK_BASE` — opcional, default `https://back.clubepostaja.com.br`
- `PORT` — opcional.

## Uso
Enviar POST para `/cotacao` com JSON no mesmo esquema que você já usa.

## Observações
- O código tenta automaticamente fazer login e armazenar token. Caso não encontre o token no payload da resposta, lança erro.
- Evita usar Puppeteer / Browserless e faz a integração via HTTP.
