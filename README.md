# fretebot v6.0
Servidor Node.js para cotação de fretes no PostaJá
- Endpoints: POST /api/cotacao (privado, x-api-key) e POST /api/public/cotacao (público, 3/min IP)
- Cache opcional em Redis por parâmetros (TTL configurável)
- Intervalo mínimo entre chamadas ao upstream
- Taxas configuráveis em config.json

## Execução
1) Crie .env baseado em .env.example
2) npm i
3) npm start
