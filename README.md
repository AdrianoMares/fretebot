# fretebot v4.2

Fluxo: recebe um JSON simples, enriquece campos, faz login na API do PostaJá, chama `/preco-prazo` e retorna resultado em JSON estruturado.

## Requisição esperada (POST /cotacao)
```json
{
  "origem": "29190-014",
  "destino": "01153-000",
  "peso": 0.1,
  "largura": 20,
  "altura": 10,
  "comprimento": 25,
  "valorDeclarado": 100
}
```

Campos opcionais:
- `servicos`: array ou string (ex: `["03220","03298","04227",".package","economico"]`). Default igual ao exemplo se não informado.

## Variáveis de ambiente
Veja `.env.example` e configure:
- `BACK_BASE` (default: `https://back.clubepostaja.com.br`)
- `PJ_EMAIL`, `PJ_SENHA` (obrigatórias)
- `PORT` (default: 10000)
- `TOKEN_CACHE` (default: `./token-cache.json`)
- `RATE_MIN_INTERVAL_MS` (default: 1000)

## Execução local
```bash
npm install
cp .env.example .env
# Edite .env com suas credenciais
npm start
```

Teste:
```bash
curl -X POST http://localhost:10000/cotacao \
  -H "Content-Type: application/json" \
  -d '{
    "origem": "29190-014",
    "destino": "01153-000",
    "peso": 0.1,
    "largura": 20,
    "altura": 10,
    "comprimento": 25,
    "valorDeclarado": 100
  }'
```

## Observações
- Token JWT é armazenado em arquivo e reutilizado até expirar.
- Rate limit de 1 requisição/segundo para chamadas externas.
- Se a API do PostaJá mudar o formato do retorno, o `normalizeCotacaoResponse` tenta montar uma lista `[ { servico, valor, prazo } ]`. Caso não consiga, retorna `{ raw: <resposta original> }`.
