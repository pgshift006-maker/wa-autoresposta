// ============================================================
//  wa-autoresposta — index.js
//  Resposta automática à primeira mensagem, para Baileys
// ============================================================
//
//  Sem dependências. Node 18+ (usa fetch nativo nas fontes).
//
//  Uso mínimo:
//    const { criarRobo } = require('./wa-autoresposta');
//    const robo = criarRobo({ padroes: { loja: 'Minha Loja', link: 'https://...' } });
//    sock.ev.on('messages.upsert', m => {
//      if (m.type !== 'notify') return;
//      for (const msg of m.messages) robo.tratarMensagem(sock, msg);
//    });
//
//  Ver README.md para configuração remota, horários e exemplos.
//
//  Por que as guardas importam:
//    Responder rápido demais, responder em grupo, ou responder em
//    rajada é o padrão que faz o WhatsApp bloquear o número. Cada
//    filtro em `tratarMensagem` existe por um motivo concreto —
//    não remova nenhum sem ler o comentário que o acompanha.
// ============================================================

'use strict';

const msgs    = require('./lib/mensagem');
const horario = require('./lib/horario');

const PADROES = {
  loja: 'Nossa loja',
  link: '',
  textoAberto:
    'Olá! 👋 Aqui é o *{{loja}}*.\n\n' +
    'Recebemos a sua mensagem e um atendente já vai te responder.\n\n' +
    'Enquanto isso, veja o cardápio completo e faça seu pedido por aqui:\n{{link}}',
  textoFechado:
    'Olá! 👋 Aqui é o *{{loja}}*.\n\n' +
    'No momento estamos *fechados* e não estamos recebendo pedidos.\n' +
    'Voltamos a atender {{abre}}.\n\n' +
    'Você já pode dar uma olhada no cardápio e se programar:\n{{link}}',
  modo: 'primeira',        // 'primeira' | 'saudacoes'
  palavras: [
    'oi', 'ola', 'opa', 'eae', 'e ai', 'salve', 'boa', 'bom dia', 'boa tarde',
    'boa noite', 'tudo bem', 'td bem', 'blz', 'beleza', 'cardapio', 'menu',
    'pedido', 'quero pedir', 'fazer pedido', 'delivery', 'entrega', 'aberto',
    'abriu', 'ta aberto', 'funcionando', 'atendendo', 'informacao', 'informacoes',
  ],
  responderFechado: true,
  ignorar: [],
  cooldownH: 12,   // não saúda o mesmo contato de novo por 12h
  handoffH: 2,     // cala 2h numa conversa onde a loja já falou
  idadeMaxS: 60,   // mensagem mais velha que isso é fila acumulada
  tetoMin: 20,     // teto de respostas por minuto
  delayMinS: 2,    // "digitando" antes de enviar
  delayMaxS: 4,
};

// ── Normalização da config remota ────────────────────────────
// A config que chega de fora usa snake_case, porque costuma vir
// gravada como JSON por um painel. Aqui vira o formato interno.
function _num(v, padrao) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : padrao;
}

function _bool(v, padrao) {
  if (typeof v === 'boolean') return v;
  if (v === '1' || v === 'true')  return true;
  if (v === '0' || v === 'false') return false;
  return padrao;
}

function _lista(v, padrao) {
  if (Array.isArray(v)) {
    const l = v.map(x => String(x).trim()).filter(Boolean);
    return l.length ? l : padrao;
  }
  if (typeof v === 'string' && v.trim()) {
    const l = v.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
    return l.length ? l : padrao;
  }
  return padrao;
}

function criarRobo(opcoes) {
  const o   = opcoes || {};
  const log = o.log || console;
  const pad = Object.assign({}, PADROES, o.padroes || {});
  const fuso = o.fuso || 'America/Sao_Paulo';
  const prefixoEnv = o.prefixoEnv || 'WA_AUTORESPOSTA';
  const intervaloMs = o.intervaloMs || 60 * 1000;

  // ── Cache do que vem de fora ───────────────────────────────
  // `tratarMensagem` lê só daqui e NUNCA espera a rede: uma consulta
  // lenta não pode atrasar a resposta ao cliente.
  const remoto = { config: null, horarios: null, override: null, ok: false, atualizadoEm: 0 };

  // ── Estado por contato ─────────────────────────────────────
  // Em memória: reiniciar o processo zera e um contato pode ser
  // saudado de novo. Troca consciente para não exigir banco.
  const saudados  = new Map(); // jid → quando foi saudado
  const atendente = new Map(); // jid → quando a loja falou
  let   envios    = [];        // para o teto por minuto
  let   timerCfg  = null;
  let   timerLimp = null;

  function cfg() {
    const r = remoto.config || {};
    return {
      // Ex.: WA_AUTORESPOSTA=0 desliga tudo, mesmo com o painel dizendo ativo.
      ativo: process.env[prefixoEnv] !== '0'
             && (typeof r.ativo === 'boolean' ? r.ativo : true),
      loja: r.loja || pad.loja,
      link: r.link_cardapio || r.link || pad.link,
      textoAberto:  r.texto_aberto  || pad.textoAberto,
      textoFechado: r.texto_fechado || pad.textoFechado,
      modo: r.modo === 'saudacoes' ? 'saudacoes' : (r.modo === 'primeira' ? 'primeira' : pad.modo),
      palavras: _lista(r.palavras, pad.palavras),
      responderFechado: _bool(r.responder_fechado, pad.responderFechado),
      ignorados: _lista(r.ignorar, pad.ignorar).map(n => String(n).replace(/\D/g, '')).filter(Boolean),
      cooldownMs: _num(r.cooldown_h,  pad.cooldownH)  * 3600000,
      handoffMs:  _num(r.handoff_h,   pad.handoffH)   * 3600000,
      idadeMaxMs: _num(r.idade_max_s, pad.idadeMaxS)  * 1000,
      tetoPorMin: _num(r.teto_min,    pad.tetoMin),
      delayMinMs: _num(r.delay_min_s, pad.delayMinS)  * 1000,
      delayMaxMs: _num(r.delay_max_s, pad.delayMaxS)  * 1000,
    };
  }

  function lojaAberta() {
    return horario.lojaAberta(remoto.horarios, { fuso, override: remoto.override });
  }

  function proximaAbertura() {
    return horario.proximaAbertura(remoto.horarios, { fuso });
  }

  // Sem dado de horário assume ABERTA: dizer "estamos fechados"
  // para o cliente de uma loja aberta é pior que a saudação genérica.
  function montarMensagem(c) {
    const conf   = c || cfg();
    const aberta = lojaAberta();
    const modelo = aberta === false ? conf.textoFechado : conf.textoAberto;
    return {
      aberta,
      texto: String(modelo)
        .replace(/\{\{loja\}\}/g, conf.loja)
        .replace(/\{\{link\}\}/g, conf.link)
        .replace(/\{\{abre\}\}/g, proximaAbertura()),
    };
  }

  async function atualizar() {
    if (!o.carregarConfig && !o.carregarHorarios) return;
    try {
      const [c, h] = await Promise.all([
        o.carregarConfig   ? o.carregarConfig()   : null,
        o.carregarHorarios ? o.carregarHorarios() : null,
      ]);
      if (c) {
        remoto.config   = c.config !== undefined ? c.config : c;
        if (c.override !== undefined) remoto.override = c.override;
      }
      if (h) remoto.horarios = h;
      remoto.atualizadoEm = Date.now();
      if (!remoto.ok) { remoto.ok = true; log.log('[wa-auto] configuração carregada.'); }
    } catch (err) {
      // Mantém o cache anterior: melhor config velha que nenhuma.
      if (remoto.ok) {
        remoto.ok = false;
        log.warn('[wa-auto] falha ao atualizar config:', err.message, '— usando o último valor conhecido.');
      }
    }
  }

  function dentroDoTeto(agora, teto) {
    envios = envios.filter(t => agora - t < 60000);
    return envios.length < teto;
  }

  // Registra que a LOJA falou com este contato, para o robô se calar
  // quando um humano assume. Chame também no seu endpoint de envio.
  function registrarMensagemDaLoja(jid) {
    const j = msgs.normalizarJid(jid);
    if (j) atendente.set(j, Date.now());
  }

  async function tratarMensagem(sock, msg) {
    try {
      const c = cfg();
      if (!c.ativo || !sock) return;

      const jidBruto = msg && msg.key && msg.key.remoteJid;
      const jid      = msgs.normalizarJid(jidBruto);

      // 1. Mensagem da própria loja → não responde, mas anota o handoff.
      //    Antes de qualquer outra saída, senão o robô nunca percebe
      //    que o atendente entrou na conversa.
      if (msg && msg.key && msg.key.fromMe) { registrarMensagemDaLoja(jidBruto); return; }

      // 2. Grupo, status, canal ou transmissão
      if (!msgs.conversaIndividual(jidBruto)) return;

      // 3. Mensagem antiga. Ao reconectar, o Baileys entrega a fila
      //    acumulada como 'notify'; sem este filtro a loja dispara
      //    dezenas de respostas em rajada.
      const agora = Date.now();
      const ts    = msgs.timestampMs(msg);
      if (!ts || agora - ts > c.idadeMaxMs) return;

      // 4. Sem texto (reação, protocolo, áudio, figurinha)
      const texto = msgs.extrairTexto(msg && msg.message, 0).trim();
      if (!texto) return;

      // 5. Número na lista de exceções
      const digitos = jid.replace(/\D/g, '');
      if (c.ignorados.some(n => digitos.endsWith(n))) return;

      // 6. Modo "só saudações"
      if (c.modo === 'saudacoes' && !msgs.ehSaudacao(texto, c.palavras)) return;

      // 7. Já respondido dentro da janela de cooldown
      const saudadoEm = saudados.get(jid);
      if (saudadoEm && agora - saudadoEm < c.cooldownMs) return;

      // 8. Atendente humano ativo nesta conversa
      const lojaFalouEm = atendente.get(jid);
      if (lojaFalouEm && agora - lojaFalouEm < c.handoffMs) return;

      // 9. Teto global por minuto
      if (!dentroDoTeto(agora, c.tetoPorMin)) {
        log.warn('[wa-auto] teto de', c.tetoPorMin, 'respostas/min atingido — ignorando', jid);
        return;
      }

      // Marca ANTES de enviar: duas mensagens do mesmo contato chegando
      // juntas não podem gerar duas respostas enquanto o envio acontece.
      saudados.set(jid, agora);
      envios.push(agora);

      // Config velha manda mensagem errada: quem acabou de fechar a loja
      // ainda seria anunciado como aberto até a próxima atualização.
      // Recarrega aqui, mas SEM esperar por ela agora — a espera acontece
      // junto com o "digitando" logo abaixo, que já é de segundos. Assim
      // o texto sai com o dado fresco e o cliente não espera nada a mais.
      // `!= null` e não `||`: frescorMs = 0 significa "sempre recarregar",
      // e com `||` viraria o padrão de 15s.
      const frescorMs = o.frescorMs != null ? o.frescorMs : 15000;
      const refresco = (Date.now() - remoto.atualizadoEm >= frescorMs)
        ? atualizar()
        : Promise.resolve();

      // Presença e digitação antes do envio. Responder no mesmo
      // instante é o que denuncia o robô.
      const destino = msg.key.remoteJid;
      try { await sock.presenceSubscribe(destino); } catch (_) {}
      await new Promise(r => setTimeout(r, 600));
      try { await sock.sendPresenceUpdate('composing', destino); } catch (_) {}
      const espera = c.delayMaxMs > c.delayMinMs
        ? c.delayMinMs + Math.random() * (c.delayMaxMs - c.delayMinMs)
        : c.delayMinMs;
      await Promise.all([refresco, new Promise(r => setTimeout(r, espera))]);
      try { await sock.sendPresenceUpdate('paused', destino); } catch (_) {}

      // Só agora monta o texto, com a configuração mais recente.
      const cAtual = cfg();
      const { texto: mensagem, aberta } = montarMensagem(cAtual);

      // Loja fechada e configurado para não responder fora do horário.
      // A decisão fica aqui, depois do refresco: é o ponto em que sabemos
      // de verdade se a loja está aberta.
      if (aberta === false && !cAtual.responderFechado) {
        saudados.delete(jid);          // não foi saudado — não gasta o cooldown
        envios.pop();
        return;
      }

      await sock.sendMessage(destino, { text: mensagem });
      log.log('[wa-auto] 🤖 resposta (' + (aberta === false ? 'fechada' : 'aberta') + ') enviada →', jid);
      if (typeof o.aoResponder === 'function') {
        try { o.aoResponder({ jid, texto: mensagem, aberta, recebido: texto }); } catch (_) {}
      }
    } catch (err) {
      // Nunca deixa a auto-resposta derrubar o handler de mensagens
      log.error('[wa-auto] erro:', (err && err.message) || err);
    }
  }

  function iniciar() {
    atualizar();
    if (o.carregarConfig || o.carregarHorarios) {
      timerCfg = setInterval(atualizar, intervaloMs);
      if (timerCfg.unref) timerCfg.unref();
    }
    timerLimp = setInterval(() => {
      const c = cfg(), agora = Date.now();
      for (const [j, t] of saudados)  { if (agora - t > c.cooldownMs) saudados.delete(j); }
      for (const [j, t] of atendente) { if (agora - t > c.handoffMs)  atendente.delete(j); }
    }, 30 * 60 * 1000);
    if (timerLimp.unref) timerLimp.unref();
    return robo;
  }

  function parar() {
    if (timerCfg)  { clearInterval(timerCfg);  timerCfg = null; }
    if (timerLimp) { clearInterval(timerLimp); timerLimp = null; }
    return robo;
  }

  // Retrato do robô agora — bom para expor num endpoint de diagnóstico.
  function estado() {
    const c = cfg();
    const previa = montarMensagem(c);
    return {
      ativo: c.ativo,
      config_carregada: remoto.ok,
      loja_aberta: previa.aberta,       // true | false | null
      proxima_abertura: proximaAbertura(),
      modo: c.modo,
      cooldown_h: c.cooldownMs / 3600000,
      handoff_h: c.handoffMs / 3600000,
      contatos_em_cooldown: saudados.size,
      conversas_com_atendente: atendente.size,
      previa: previa.texto,
    };
  }

  const robo = {
    iniciar, parar, tratarMensagem, registrarMensagemDaLoja,
    estado, cfg, lojaAberta, proximaAbertura, montarMensagem, atualizar,
    // Escapes para teste e diagnóstico
    _remoto: remoto, _saudados: saudados, _atendente: atendente,
  };
  return robo;
}

module.exports = { criarRobo, PADROES, mensagem: msgs, horario };
