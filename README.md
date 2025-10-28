# 🚀 FreteBot v3.2 (Cache Local + JSON Estruturado)

## ⚙️ O que há de novo
- 🧠 **Cache de sessão local:** Login é feito apenas uma vez e cookies são salvos em `cookies.json`.
- 📦 **Resultados em JSON estruturado:** Cada frete contém `servico`, `prazo`, `valor`.
- 🧱 **Executa Puppeteer localmente no Render (sem Browserless).**

## 🧩 Endpoint
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

## 🧰 Retorno
```json
{
  "sucesso": true,
  "fretes": [
    { "servico": "Serviço 1", "prazo": "4-6 dias úteis", "valor": 43.86 }
  ]
}
```

---
© 2025 FreteBot - Cache Local + JSON Estruturado
