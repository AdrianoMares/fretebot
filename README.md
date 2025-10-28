# 🚀 FreteBot (Render - Puppeteer Local Final)

Servidor Node.js com Puppeteer rodando 100% localmente no Render.

## ⚙️ Variáveis de ambiente
```
POSTAJA_EMAIL=seu@email.com
POSTAJA_SENHA=sua_senha
CHROME_PATH=/opt/render/project/.chrome/chrome/linux-127.0.6533.88/chrome
PUPPETEER_SKIP_DOWNLOAD=false
PORT=10000
```

## 🧱 Deploy no Render
1. Faça upload desses arquivos no seu repositório GitHub.
2. Crie um novo **Web Service** no Render.
3. Configure as variáveis de ambiente acima.
4. Deploy automático — o log mostrará:
   ```bash
   Downloading Chrome...
   Chrome downloaded to /opt/render/project/.chrome
   ```

## 🧩 Endpoint de cotação
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

---
© 2025 FreteBot - Puppeteer Local Final
