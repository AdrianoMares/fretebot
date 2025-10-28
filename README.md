# 🚀 FreteBot v3.3 (Timeout Estendido + Re-tentativa + JSON Estruturado)

## ⚙️ Melhorias
- ⏱ **Timeout aumentado para 120s** (Render pode ser lento no primeiro boot).
- 🔁 **Re-tentativa automática** de login e detecção inteligente da rota correta.
- 🧭 **Compatível com /home, /login ou /entrar** automaticamente.
- 🧠 **Cache local de cookies** — evita login repetido.
- 📊 **Respostas estruturadas em JSON** (serviço, valor, prazo).

## 🧩 Exemplo de retorno
```json
{
  "sucesso": true,
  "fretes": [
    { "servico": "Serviço 1", "prazo": "4-6 dias úteis", "valor": 43.86 },
    { "servico": "Serviço 2", "prazo": "8-10 dias úteis", "valor": 23.46 }
  ]
}
```

---
© 2025 FreteBot v3.3
