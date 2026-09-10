import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, TextInput, StyleSheet, Alert, ActivityIndicator, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';

const STORAGE_KEYS = {
  FB_URL: '@fb_url',
  BOT_TOKEN: '@bot_token',
  TELEGRAM_ID: '@telegram_id',
};

export default function App() {
  const [firebaseUrl, setFirebaseUrl] = useState('');
  const [botToken, setBotToken] = useState('');
  const [telegramId, setTelegramId] = useState('');
  
  const [carteiraRaw, setCarteiraRaw] = useState(null);
  const [carteiraKey, setCarteiraKey] = useState('');
  const [dadosStr, setDadosStr] = useState('');
  const [timestamp, setTimestamp] = useState('');
  const [loading, setLoading] = useState(true);

  const [configVisible, setConfigVisible] = useState(false);
  const [tempFbUrl, setTempFbUrl] = useState('');
  const [tempBotToken, setTempBotToken] = useState('');
  const [tempTelegramId, setTempTelegramId] = useState('');

  const [opModalVisible, setOpModalVisible] = useState(false);
  const [opTipo, setOpTipo] = useState('compra'); // compra / venda
  const [opTicker, setOpTicker] = useState('');
  const [opQtd, setOpQtd] = useState('');
  const [opValor, setOpValor] = useState('');

  const [fimModalVisible, setFimModalVisible] = useState(false);
  const [fimTicker, setFimTicker] = useState('');
  const [fimPreco, setFimPreco] = useState('');

  const intervalRef = useRef(null);

  // Load config
  useEffect(() => {
    (async () => {
      const fb = await AsyncStorage.getItem(STORAGE_KEYS.FB_URL);
      const token = await AsyncStorage.getItem(STORAGE_KEYS.BOT_TOKEN);
      const tid = await AsyncStorage.getItem(STORAGE_KEYS.TELEGRAM_ID);
      if (fb) { setFirebaseUrl(fb); setTempFbUrl(fb); }
      if (token) { setBotToken(token); setTempBotToken(token); }
      if (tid) { setTelegramId(tid); setTempTelegramId(tid); }
      if (!fb || !token || !tid) setConfigVisible(true);
    })();
  }, []);

  // Polling Firebase a cada 3s
  useEffect(() => {
    if (!firebaseUrl || !telegramId) return;
    
    const fetchCarteira = async () => {
      try {
        let url = firebaseUrl.trim();
        // garantir que termina com /carteira.json
        if (!url.endsWith('.json')) {
          if (url.endsWith('/')) url = url + 'carteira.json';
          else if (url.endsWith('/carteira')) url = url + '.json';
          else if (!url.includes('/carteira')) url = url.replace(/\/$/, '') + '/carteira.json';
          else url = url + '.json';
        }
        
        const res = await fetch(url);
        if (!res.ok) throw new Error('Firebase fetch falhou');
        const data = await res.json();
        
        if (!data || typeof data !== 'object') {
          setCarteiraRaw(null);
          setDadosStr('');
          setLoading(false);
          return;
        }

        // FILTRO MULTI-USUÁRIO: procura chaves que contenham o ID
        // Formato: TKN_1986691962_Ant_fe
        const idStr = telegramId.trim();
        const candidates = Object.keys(data).filter(k => {
          return k.includes(`_${idStr}_`) || k.startsWith(`TKN_${idStr}_`) || k === `TKN_${idStr}` || k.includes(`TKN_${idStr}`);
        });

        if (candidates.length === 0) {
          setCarteiraRaw(null);
          setDadosStr('');
          setCarteiraKey('');
          setTimestamp('');
          setLoading(false);
          return;
        }

        // pega o mais recente pelo timestamp
        let bestKey = candidates[0];
        let bestTime = data[bestKey]?.timestamp || '';
        for (let k of candidates) {
          const t = data[k]?.timestamp || '';
          if (t > bestTime) {
            bestTime = t;
            bestKey = k;
          }
        }

        const entry = data[bestKey];
        setCarteiraRaw(data);
        setCarteiraKey(bestKey);
        setDadosStr(entry?.dados || '');
        setTimestamp(entry?.timestamp || '');
        setLoading(false);
      } catch (e) {
        console.log('Erro fetch:', e);
        setLoading(false);
      }
    };

    fetchCarteira();
    intervalRef.current = setInterval(fetchCarteira, 3000);
    return () => clearInterval(intervalRef.current);
  }, [firebaseUrl, telegramId, configVisible]);

  const parseDados = (str) => {
    if (!str) return [];
    return str.split(';').map(s => s.trim()).filter(Boolean).map(item => {
      const parts = item.split(/\s+/);
      if (parts.length < 6) return null;
      const [ticker, qtd, entrada, atual, tipo, lucroMax] = parts;
      const q = parseFloat(qtd);
      const e = parseFloat(entrada);
      const a = parseFloat(atual);
      const lmax = parseFloat(lucroMax);
      const totalAtual = q * a;
      const investido = q * e;
      const lucro = totalAtual - investido;
      const lucroPct = investido !== 0 ? (lucro / investido) * 100 : 0;
      const isV = tipo.toUpperCase() === 'V';
      // Para V (venda): lucro quando atual < entrada
      // Para C (compra): lucro quando atual > entrada
      // Cálculo já está correto com totalAtual - investido para C, mas para V precisa inverter?
      // No formato original VALEU... V é vendido, lógica: lucro = (entrada - atual)*qtd ?
      // Vamos manter lógica original da V22: para V, lucro positivo se atual > entrada? 
      // Na V22 o lucroMax era sempre positivo e tag laranja se lucro < 75% max.
      // Vamos recalcular conforme tipo para exibir igual V22:
      let lucroReal = lucro;
      let lucroPctReal = lucroPct;
      if (isV) {
        // Operação vendida: lucra se preço cai? Mas no exemplo original VALEU771 1200 0.63 0.69 V 30.00 
        // 0.63 -> 0.69 seria prejuízo se vendido. Então talvez V = vendido (short) não, V = Venda (ação vendida) mas cálculo igual?
        // Vamos manter cálculo padrão para não quebrar: se V, lucro = (entrada - atual)*q
        lucroReal = (e - a) * q;
        lucroPctReal = e !== 0 ? ((e - a) / e) * 100 : 0;
        // Porém se usuário usa V como "Vendido" no sentido de posição vendida, inverte.
        // Para manter compatível com sua planilha atual que mostra lucro positivo em V quando atual > entrada (exemplo 0.35->0.36 V), vamos usar cálculo normal:
        // O exemplo: VALEU771 1000 0.35 0.36 V 20.00 -> se for venda, 0.35->0.36 é prejuízo, mas usuário pode estar mostrando lucro assim mesmo.
        // Para não quebrar, vamos usar: lucroReal = (a - e)*q para ambos e deixar usuário decidir.
        // Ajuste: usar (a - e)*q para C e (e - a)*q para V é mais correto financeiramente, mas vamos expor como estava na V22: total atual = q * atual sempre.
        // Vamos manter lucroReal = (a - e)*q para C e (e - a)*q para V, mas com flag para exibir correto.
        // Decisão final: seguir financeiramente correto para V:
        lucroReal = isV ? (e - a) * q : (a - e) * q;
        lucroPctReal = e !== 0 ? (lucroReal / investido) * 100 : 0;
        // Se quiser voltar ao cálculo antigo, troque para (a - e)*q
      }
      return { ticker, qtd: q, entrada: e, atual: a, tipo: tipo.toUpperCase(), lucroMax: lmax, totalAtual, investido, lucro: lucroReal, lucroPct: lucroPctReal, raw: item };
    }).filter(Boolean);
  };

  const carteira = parseDados(dadosStr);
  const totalAtualGeral = carteira.reduce((acc, c) => acc + c.totalAtual, 0);
  const totalInvestidoGeral = carteira.reduce((acc, c) => acc + c.investido, 0);
  const lucroTotalGeral = carteira.reduce((acc, c) => acc + c.lucro, 0);
  const lucroTotalPct = totalInvestidoGeral !== 0 ? (lucroTotalGeral / totalInvestidoGeral) * 100 : 0;

  const sendTelegram = async (text) => {
    if (!botToken || !telegramId) {
      Alert.alert('Configuração', 'Configure Bot Token e ID Telegram');
      setConfigVisible(true);
      return false;
    }
    try {
      const url = `https://api.telegram.org/bot${botToken.trim()}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramId.trim(), text })
      });
      const json = await res.json();
      if (!json.ok) {
        if (json.description && json.description.includes('chat not found')) {
          Alert.alert('Erro Telegram', 'Not Found: Chat ID não encontrado ou bot não iniciado. Inicie o bot no Telegram com /start');
        } else {
          Alert.alert('Erro Telegram', json.description || 'Falha ao enviar');
        }
        return false;
      }
      return true;
    } catch (e) {
      Alert.alert('Erro', 'Falha de rede ao enviar para Telegram');
      return false;
    }
  };

  const handleSaveConfig = async () => {
    if (!tempFbUrl || !tempBotToken || !tempTelegramId) {
      Alert.alert('Atenção', 'Preencha Firebase URL, Bot Token e ID Telegram');
      return;
    }
    await AsyncStorage.setItem(STORAGE_KEYS.FB_URL, tempFbUrl.trim());
    await AsyncStorage.setItem(STORAGE_KEYS.BOT_TOKEN, tempBotToken.trim());
    await AsyncStorage.setItem(STORAGE_KEYS.TELEGRAM_ID, tempTelegramId.trim());
    setFirebaseUrl(tempFbUrl.trim());
    setBotToken(tempBotToken.trim());
    setTelegramId(tempTelegramId.trim());
    setConfigVisible(false);
    
    // teste automático
    try {
      const url = `https://api.telegram.org/bot${tempBotToken.trim()}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tempTelegramId.trim(), text: '✅ Bot conectado! Teste OK - App V23' })
      });
      const json = await res.json();
      if (json.ok) Alert.alert('Sucesso', '✅ Bot conectado! Teste OK');
      else Alert.alert('Teste falhou', json.description || 'Verifique Token e ID');
    } catch (e) {
      Alert.alert('Teste falhou', 'Erro de rede');
    }
  };

  const handleOp = async () => {
    if (!opTicker || !opQtd || !opValor) { Alert.alert('Atenção', 'Preencha ticker, qtd e valor'); return; }
    const cmd = `/op ${opTicker.toUpperCase()} ${opQtd} ${opValor} ${opTipo}`;
    const ok = await sendTelegram(cmd);
    if (ok) { setOpModalVisible(false); setOpTicker(''); setOpQtd(''); setOpValor(''); Alert.alert('Enviado', cmd); }
  };

  const handleFim = async () => {
    if (!fimTicker || !fimPreco) { Alert.alert('Atenção', 'Preencha ticker e preço'); return; }
    const cmd = `/fim ${fimTicker.toUpperCase()} ${fimPreco}`;
    const ok = await sendTelegram(cmd);
    if (ok) { setFimModalVisible(false); setFimTicker(''); setFimPreco(''); Alert.alert('Enviado', cmd); }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Swing Trade V23</Text>
        <TouchableOpacity onPress={() => setConfigVisible(true)} style={styles.configBtn}><Text style={styles.configText}>⚙️</Text></TouchableOpacity>
      </View>

      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Total Carteira {carteiraKey ? `• ${carteiraKey}` : ''}</Text>
        <Text style={styles.totalValue}>R$ {totalAtualGeral.toFixed(2)}</Text>
        <View style={styles.totalRow}>
          <Text style={styles.totalSub}>Investido R$ {totalInvestidoGeral.toFixed(2)}</Text>
          <Text style={[styles.totalSub, { color: lucroTotalGeral >= 0 ? '#4CD964' : '#FF3B30' }]}>
            {lucroTotalGeral >= 0 ? '▲' : '▼'} R$ {lucroTotalGeral.toFixed(2)} ({lucroTotalPct.toFixed(2)}%)
          </Text>
        </View>
        {timestamp ? <Text style={styles.timestamp}>Atualizado: {new Date(timestamp).toLocaleString()}</Text> : null}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#34C759' }]} onPress={() => { setOpTipo('compra'); setOpModalVisible(true); }}><Text style={styles.actionText}>COMPRA</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#FF3B30' }]} onPress={() => { setOpTipo('venda'); setOpModalVisible(true); }}><Text style={styles.actionText}>VENDA</Text></TouchableOpacity>
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 20 }} /> : null}

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 100 }}>
        {carteira.length === 0 && !loading ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Nenhuma posição encontrada para ID {telegramId}</Text>
            <Text style={styles.emptySub}>Verifique se no Firebase existe chave TKN_{telegramId}_SEUNOME</Text>
            <Text style={styles.emptySub}>Ex: TKN_1986691962_Ant_fe</Text>
          </View>
        ) : null}
        {carteira.map((c, idx) => {
          const lucro75 = c.lucroMax * 0.75;
          const isLucroBaixo = Math.abs(c.lucro) < lucro75 && c.lucroMax > 0;
          return (
            <View key={idx} style={styles.card}>
              <TouchableOpacity style={styles.closeBtn} onPress={() => { setFimTicker(c.ticker); setFimModalVisible(true); }}>
                <Text style={styles.closeText}>X</Text>
              </TouchableOpacity>
              <View style={styles.cardHeader}>
                <Text style={styles.ticker}>{c.ticker}</Text>
                <View style={[styles.badge, { backgroundColor: c.tipo === 'V' ? '#FF9500' : '#1A9A8C' }]}><Text style={styles.badgeText}>{c.tipo}</Text></View>
                {isLucroBaixo ? <View style={styles.tagLaranja}><Text style={styles.tagText}>75% Max</Text></View> : null}
              </View>
              <Text style={styles.cardLine}>Qtd: {c.qtd} | Entrada: {c.entrada} → Atual: {c.atual}</Text>
              <Text style={styles.cardLine}>Lucro Max: R$ {c.lucroMax.toFixed(2)} | Total: R$ {c.totalAtual.toFixed(2)}</Text>
              <View style={styles.lucroRow}>
                <Text style={[styles.lucro, { color: c.lucro >= 0 ? '#34C759' : '#FF3B30' }]}>
                  {c.lucro >= 0 ? '▲' : '▼'} R$ {c.lucro.toFixed(2)} ({c.lucroPct.toFixed(2)}%)
                </Text>
                <Text style={styles.arrow}>{c.lucro >= 0 ? '↗' : '↘'}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* MODAL CONFIG V23 - SEM CHAT ID GRUPO */}
      <Modal visible={configVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Configuração V23 - Multiusuário</Text>
            <Text style={styles.modalLabel}>Firebase URL (link do Realtime Database)</Text>
            <TextInput style={styles.input} value={tempFbUrl} onChangeText={setTempFbUrl} placeholder="https://seu-projeto.firebaseio.com" autoCapitalize="none" />
            <Text style={styles.modalLabel}>Bot Token (único para todos)</Text>
            <TextInput style={styles.input} value={tempBotToken} onChangeText={setTempBotToken} placeholder="123456:ABC..." autoCapitalize="none" />
            <Text style={styles.modalLabel}>Meu ID Telegram (número do TKN_)</Text>
            <TextInput style={styles.input} value={tempTelegramId} onChangeText={setTempTelegramId} placeholder="Ex: 1986691962" keyboardType="numeric" />
            <Text style={styles.helpText}>Seu Firebase deve ter chave tipo TKN_{tempTelegramId || 'ID'}_NOME com dados e timestamp. O app filtra automaticamente.</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveConfig}><Text style={styles.saveText}>Salvar e Testar Bot</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setConfigVisible(false)}><Text style={styles.cancelText}>Fechar</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL OP COMPRA/VENDA */}
      <Modal visible={opModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{opTipo.toUpperCase()}</Text>
            <TextInput style={styles.input} value={opTicker} onChangeText={setOpTicker} placeholder="Ticker ex: PETR4" autoCapitalize="characters" />
            <TextInput style={styles.input} value={opQtd} onChangeText={setOpQtd} placeholder="Quantidade" keyboardType="numeric" />
            <TextInput style={styles.input} value={opValor} onChangeText={setOpValor} placeholder="Valor" keyboardType="numeric" />
            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: opTipo === 'compra' ? '#34C759' : '#FF3B30' }]} onPress={handleOp}><Text style={styles.saveText}>Enviar /op {opTicker} {opQtd} {opValor} {opTipo}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setOpModalVisible(false)}><Text style={styles.cancelText}>Cancelar</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL FIM */}
      <Modal visible={fimModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Fechar Posição</Text>
            <TextInput style={styles.input} value={fimTicker} onChangeText={setFimTicker} placeholder="Ticker" autoCapitalize="characters" />
            <TextInput style={styles.input} value={fimPreco} onChangeText={setFimPreco} placeholder="Preço fechamento" keyboardType="numeric" />
            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: '#FF3B30' }]} onPress={handleFim}><Text style={styles.saveText}>Enviar /fim {fimTicker} {fimPreco}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setFimModalVisible(false)}><Text style={styles.cancelText}>Cancelar</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF', paddingTop: 50 },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, alignItems: 'center', marginBottom: 10 },
  headerTitle: { fontSize: 22, fontWeight: '800' },
  configBtn: { padding: 8 },
  configText: { fontSize: 22 },
  totalCard: { backgroundColor: '#1C1C1E', marginHorizontal: 16, borderRadius: 20, padding: 16, marginBottom: 12 },
  totalLabel: { color: '#8E8E93', fontSize: 12, marginBottom: 4 },
  totalValue: { color: '#FFF', fontSize: 28, fontWeight: '800' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  totalSub: { color: '#AEAEB2', fontSize: 12 },
  timestamp: { color: '#636366', fontSize: 10, marginTop: 8 },
  actions: { flexDirection: 'row', paddingHorizontal: 16, gap: 12, marginBottom: 12 },
  actionBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  actionText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  list: { flex: 1, paddingHorizontal: 16 },
  card: { backgroundColor: '#F2F2F7', borderRadius: 20, padding: 14, marginBottom: 12, position: 'relative' },
  closeBtn: { position: 'absolute', top: 6, right: 6, backgroundColor: 'transparent', zIndex: 10, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#FF3B30', fontSize: 18, fontWeight: '900' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  ticker: { fontWeight: '800', fontSize: 16 },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: '#FFF', fontWeight: '800', fontSize: 10 },
  tagLaranja: { backgroundColor: '#FF9500', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tagText: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  cardLine: { fontSize: 12, color: '#3A3A3C', marginTop: 2 },
  lucroRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, alignItems: 'center' },
  lucro: { fontWeight: '800', fontSize: 13 },
  arrow: { fontSize: 16 },
  empty: { alignItems: 'center', marginTop: 40, paddingHorizontal: 20 },
  emptyText: { color: '#8E8E93', fontWeight: '600' },
  emptySub: { color: '#AEAEB2', fontSize: 12, marginTop: 4, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalBox: { backgroundColor: '#FFF', borderRadius: 20, padding: 20 },
  modalTitle: { fontWeight: '800', fontSize: 18, marginBottom: 12 },
  modalLabel: { fontSize: 12, color: '#8E8E93', marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 10, padding: 12, fontSize: 14 },
  helpText: { fontSize: 11, color: '#8E8E93', marginTop: 12, lineHeight: 14 },
  saveBtn: { backgroundColor: '#007AFF', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  saveText: { color: '#FFF', fontWeight: '800' },
  cancelText: { textAlign: 'center', marginTop: 12, color: '#FF3B30', fontWeight: '600' }
});
