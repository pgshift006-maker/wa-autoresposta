// ============================================================
//  Exemplo 1 — o mínimo que funciona
//  Textos fixos no código, sem banco, sem horário.
//  Rode com: node exemplos/minimo.js  (ver o teste seco no fim)
// ============================================================

const { criarRobo } = require('..');

const robo = criarRobo({
  padroes: {
    loja: 'Pizzaria do Bairro',
    link: 'https://pizzariadobairro.com.br/cardapio',
  },
}).iniciar();

// ── No seu servidor Baileys ──────────────────────────────────
//
// sock.ev.on('messages.upsert', (m) => {
//   if (m.type !== 'notify') return;
//   for (const msg of m.messages) robo.tratarMensagem(sock, msg);
// });
//
// E no seu endpoint de envio manual, para o robô se calar quando
// um atendente humano entra na conversa:
//
// await sock.sendMessage(jid, { text: mensagem });
// robo.registrarMensagemDaLoja(jid);

// ── Teste seco, sem WhatsApp ─────────────────────────────────
if (require.main === module) {
  const sockFalso = {
    presenceSubscribe: async () => {},
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, c) => console.log('\n→ para ' + jid + ':\n' + c.text),
  };

  const mensagemFalsa = {
    key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: { conversation: 'boa noite, vocês estão abertos?' },
  };

  console.log('Estado:', robo.estado());
  robo.tratarMensagem(sockFalso, mensagemFalsa);
}
