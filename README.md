# fretebot v4.3
Versão simplificada sem subpastas, login HTTP, cache de token, e rate limit de 1 req/s.

## Uso
POST /cotacao com corpo:
{
  "origem": "29190-014",
  "destino": "01153-000",
  "peso": 0.1,
  "largura": 20,
  "altura": 10,
  "comprimento": 25,
  "valorDeclarado": 100
}
