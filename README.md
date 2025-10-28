# 🚀 FreteBot (Render - Puppeteer Local)

Servidor Node.js para calcular fretes automaticamente no site Clube PostaJá.

## ⚙️ Configuração

### Variáveis de ambiente (Render)
```
POSTAJA_EMAIL=seu@email.com
POSTAJA_SENHA=sua_senha
PORT=10000
PUPPETEER_SKIP_DOWNLOAD=false
```

### Deploy no Render
1. Suba os arquivos no GitHub.
2. Crie um novo serviço **Web Service** no Render.
3. Configure o **Start Command** como:
   ```bash
   npm start
   ```
4. O Render instalará o Chrome automaticamente durante o build.

---
**Endpoint:** `POST /cotacao`  
**Exemplo JSON:**
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

---
© 2025 FreteBot - Render Puppeteer Local
