// ============================================================
//  wa-autoresposta — lib/mensagem.js
//  Leitura das mensagens que chegam do Baileys
// ============================================================
//
//  Isolado do resto porque é a parte que mais muda quando o
//  WhatsApp inventa um formato novo de mensagem. Nada aqui
//  conhece configuração, horário ou envio.
// ============================================================

'use strict';

// Remove o sufixo de dispositivo (5511999999999:12@s.whatsapp.net)
// para que todos os aparelhos do mesmo contato contem como um só.
function normalizarJid(jid) {
  return String(jid || '').replace(/:\d+(?=@)/, '');
}

// Só conversa individual. Grupo, status, canal e transmissão ficam de fora.
// `@lid` é o endereçamento novo do WhatsApp para contatos individuais.
function conversaIndividual(jid) {
  const j = String(jid || '');
  if (!j) return false;
  if (j.endsWith('@g.us'))       return false; // grupo
  if (j.endsWith('@newsletter')) return false; // canal
  if (j.endsWith('@broadcast'))  return false; // status e transmissões
  return j.endsWith('@s.whatsapp.net') || j.endsWith('@lid');
}

// messageTimestamp vem como número ou como Long do protobuf.
// Devolve milissegundos, ou 0 quando não dá para saber.
function timestampMs(msg) {
  const t = msg && msg.messageTimestamp;
  if (typeof t === 'number') return t * 1000;
  if (t && typeof t.toNumber === 'function') return t.toNumber() * 1000;
  const n = Number((t && t.low) || t || 0);
  return Number.isFinite(n) && n > 0 ? n * 1000 : 0;
}

// Extrai o texto de qualquer formato que o cliente possa mandar.
// Devolve '' para reação, protocolo, áudio e figurinha — que não são conversa.
function extrairTexto(message, profundidade) {
  const nivel = profundidade || 0;
  if (!message || nivel > 3) return '';
  const m = message;

  // Envelopes que embrulham a mensagem real
  const interno = (m.ephemeralMessage && m.ephemeralMessage.message)
               || (m.viewOnceMessage && m.viewOnceMessage.message)
               || (m.viewOnceMessageV2 && m.viewOnceMessageV2.message)
               || (m.viewOnceMessageV2Extension && m.viewOnceMessageV2Extension.message)
               || (m.documentWithCaptionMessage && m.documentWithCaptionMessage.message);
  if (interno) return extrairTexto(interno, nivel + 1);

  return (
    m.conversation ||
    (m.extendedTextMessage        && m.extendedTextMessage.text) ||
    (m.imageMessage               && m.imageMessage.caption) ||
    (m.videoMessage               && m.videoMessage.caption) ||
    (m.buttonsResponseMessage     && m.buttonsResponseMessage.selectedDisplayText) ||
    (m.listResponseMessage        && m.listResponseMessage.title) ||
    (m.templateButtonReplyMessage && m.templateButtonReplyMessage.selectedDisplayText) ||
    ''
  );
}

// Minúsculas, sem acento, sem pontuação — para comparar palavras.
function normalizarTexto(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Casa palavra inteira, para "oi" não disparar dentro de "coisa".
function ehSaudacao(texto, palavras) {
  const t = normalizarTexto(texto);
  if (!t) return false;
  for (const bruta of palavras || []) {
    const p = normalizarTexto(bruta);
    if (!p) continue;
    if (t === p) return true;
    const escapada = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('(^|\\s)' + escapada + '(\\s|$)').test(t)) return true;
  }
  return false;
}

module.exports = {
  normalizarJid,
  conversaIndividual,
  timestampMs,
  extrairTexto,
  normalizarTexto,
  ehSaudacao,
};
