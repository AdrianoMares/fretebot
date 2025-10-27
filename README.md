# FreteBot (Browserless + Puppeteer)

API que faz login no PostaJá, preenche a calculadora e retorna os valores de frete.

## Requisição

POST /cotacao (JSON)
{
  "origem": "29190-014",
  "destino": "01153-000",
  "peso": 0.1,
  "largura": 20,
  "altura": 10,
  "comprimento": 25,
  "valorDeclarado": 100
}

## Resposta (exemplo)

{
  "fretes": [
    { "servico": "SEDEX", "valor": 43.86, "prazo": "4-6 dias úteis" },
    { "servico": "PAC", "valor": 23.46, "prazo": "8-10 dias úteis" },
    { "servico": "Pac Mini", "valor": 15.85, "prazo": "11-13 dias úteis" },
    { "servico": "Jadlog", "valor": 10.18, "prazo": "3-5 dias úteis" }
  ]
}

## Variáveis de ambiente

POSTAJA_EMAIL, POSTAJA_SENHA, BROWSERLESS_TOKEN e PORT (10000).
