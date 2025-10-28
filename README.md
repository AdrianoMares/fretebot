# fretebot v4.5
Alterações:
- ✅ Troca GET → POST em `/preco-prazo`
- ✅ Inclui campo `usuario`
- ✅ Logs mais detalhados
- ✅ Cache e Rate Limit

### Teste local
curl -X POST http://localhost:10000/cotacao   -H "Content-Type: application/json"   -d '{"origem":"29190-014","destino":"01153-000","peso":0.1,"largura":20,"altura":10,"comprimento":25,"valorDeclarado":100}'
