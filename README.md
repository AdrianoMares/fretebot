# fretebot v4.4
Inclui:
- Campo `usuario` obrigatório para `/preco-prazo`
- Logs detalhados
- Cache de token e rate limit 1 req/s

### Teste local
curl -X POST http://localhost:10000/cotacao   -H "Content-Type: application/json"   -d '{"origem":"29190-014","destino":"01153-000","peso":0.1,"largura":20,"altura":10,"comprimento":25,"valorDeclarado":100}'
