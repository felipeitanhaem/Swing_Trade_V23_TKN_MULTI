# Swing Trade V23 - Multiusuario TKN

## O que mudou da V22.1
- Config só: Firebase URL + Bot Token + ID Telegram (ex: 1986691962)
- Leitura Firebase: /carteira.json -> filtra chave que contém seu ID
  Ex: TKN_1986691962_Ant_fe para ID 1986691962
- Se múltiplas chaves mesmo ID, pega timestamp mais recente

## Como usar
1. Push para main -> Actions builda APK
2. No app, ⚙️ configure:
   - Firebase URL: https://seu-projeto.firebaseio.com
   - Bot Token: 123456:ABC...
   - Meu ID Telegram: 1986691962
3. Firebase estrutura:
{
  "TKN_1986691962_Ant_fe": {
    "dados": "VALEU771 1000 0.35 0.36 V 20.00; ...",
    "timestamp": "2026-09-09T16:38:20.701091"
  }
}

## Comandos Telegram mantidos
- /op TICKER QTD VALOR compra|venda
- /fim TICKER PRECO
Enviados para seu próprio ID via Bot API.
