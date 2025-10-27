# FreteBot (Browserless)

- Porta: usa `PORT` do ambiente (Render fornece). Default 10000.
- Env obrigatórios:
  - `BROWSERLESS_TOKEN`
  - `POSTAJA_EMAIL`
  - `POSTAJA_SENHA`

## Endpoint

POST `/cotacao`

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

Resposta:

```json
{
  "fretes": [
    { "servico": "SEDEX", "valor": 22.31, "prazo": "1–3 dias úteis" },
    { "servico": "PAC", "valor": 19.38, "prazo": "5–7 dias úteis" }
  ]
}
```

> Observação: mapeamento de campos da resposta do backend do Posta Já foi feito de forma robusta, mas se alterarem os nomes/chaves, ajuste a função `mapRespostaPrecoPrazo`.
