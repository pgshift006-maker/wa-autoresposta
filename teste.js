// ============================================================
//  wa-autoresposta — teste.js
//  Sem rede, sem WhatsApp, sem dependência. Rode: node teste.js
// ============================================================

'use strict';

const { criarRobo } = require('./index');
const horario = require('./lib/horario');

let falhas = 0, total = 0;
function checa(nome, ok, extra) {
  total++;
  console.log((ok ? '  ok   ' : '  FALHA') + ' | ' + nome + (extra ? '  [' + extra + ']' : ''));
  if (!ok) falhas++;
}
function secao(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 54 - t.length))); }

// Sock falso: guarda o que seria enviado.
function criarSock() {
  const enviados = [];
  return {
    enviados,
    presenceSubscribe: async () => {},
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, c) => { enviados.push({ jid, texto: c.text }); },
  };
}

const agoraS = () => Math.floor(Date.now() / 1000);
function msg(jid, texto, opts) {
  const o = opts || {};
  return {
    key: { remoteJid: jid, fromMe: !!o.fromMe },
    messageTimestamp: o.ts === undefined ? agoraS() : o.ts, // 0 é proposital em um dos casos
    message: o.message || { conversation: texto },
  };
}

// Robô sem espera, para o teste não levar minutos.
function robo(config, horarios, override) {
  const r = criarRobo({
    padroes: { loja: 'Loja Teste', link: 'https://exemplo.test/menu', delayMinS: 0, delayMaxS: 0 },
    log: { log(){}, warn(){}, error(){} },
  });
  r._remoto.config   = Object.assign({ delay_min_s: 0, delay_max_s: 0 }, config || {});
  r._remoto.horarios = horarios || null;
  r._remoto.override = override === undefined ? null : override;
  return r;
}

(async () => {

secao('Guardas: o que NÃO pode ser respondido');
{
  const s = criarSock(), r = robo();
  const naoResponde = async (nome, m) => {
    const antes = s.enviados.length;
    await r.tratarMensagem(s, m);
    checa(nome, s.enviados.length === antes);
  };
  await naoResponde('grupo (@g.us)',              msg('120363@g.us', 'oi'));
  await naoResponde('status@broadcast',           msg('status@broadcast', 'oi'));
  await naoResponde('canal (@newsletter)',        msg('123@newsletter', 'oi'));
  await naoResponde('lista de transmissão',       msg('123@broadcast', 'oi'));
  await naoResponde('mensagem da própria loja',   msg('5511900000001@s.whatsapp.net', 'oi', { fromMe: true }));
  await naoResponde('mensagem de 1h atrás',       msg('5511900000002@s.whatsapp.net', 'oi', { ts: agoraS() - 3600 }));
  await naoResponde('mensagem sem timestamp',     msg('5511900000003@s.whatsapp.net', 'oi', { ts: 0 }));
  await naoResponde('reação (sem texto)',         msg('5511900000004@s.whatsapp.net', '', { message: { reactionMessage: { text: '👍' } } }));
  await naoResponde('áudio (sem texto)',          msg('5511900000005@s.whatsapp.net', '', { message: { audioMessage: { seconds: 3 } } }));
  await naoResponde('só espaços em branco',       msg('5511900000006@s.whatsapp.net', '    '));
}

secao('Caso feliz e formatos de mensagem');
{
  const s = criarSock(), r = robo();
  await r.tratarMensagem(s, msg('5511911111111@s.whatsapp.net', 'bom dia'));
  checa('primeira mensagem é respondida', s.enviados.length === 1);
  const t = s.enviados[0].texto;
  checa('usa o nome da loja', /Loja Teste/.test(t));
  checa('usa o link', /exemplo\.test/.test(t));
  checa('não sobra placeholder', !/\{\{/.test(t));

  await r.tratarMensagem(s, msg('5511922222222@s.whatsapp.net', null, { message: { extendedTextMessage: { text: 'olá' } } }));
  checa('extendedTextMessage', s.enviados.length === 2);
  await r.tratarMensagem(s, msg('5511933333333@s.whatsapp.net', null, { message: { ephemeralMessage: { message: { conversation: 'oi' } } } }));
  checa('mensagem temporária (ephemeral)', s.enviados.length === 3);
  await r.tratarMensagem(s, msg('5511944444444@s.whatsapp.net', null, { message: { imageMessage: { caption: 'oi, quanto custa?' } } }));
  checa('legenda de imagem', s.enviados.length === 4);
  await r.tratarMensagem(s, msg('5511955555555@s.whatsapp.net', null, { message: { viewOnceMessageV2: { message: { conversation: 'oi' } } } }));
  checa('visualização única', s.enviados.length === 5);
}

secao('Cooldown e handoff');
{
  const s = criarSock(), r = robo();
  const jid = '5511911111111@s.whatsapp.net';
  await r.tratarMensagem(s, msg(jid, 'oi'));
  const depoisDaPrimeira = s.enviados.length;
  await r.tratarMensagem(s, msg(jid, 'quero pedir'));
  checa('2ª mensagem do mesmo contato não repete', s.enviados.length === depoisDaPrimeira);
  await r.tratarMensagem(s, msg('5511911111111:47@s.whatsapp.net', 'oi de outro aparelho'));
  checa('outro aparelho do mesmo contato respeita o cooldown', s.enviados.length === depoisDaPrimeira);

  const r2 = robo(), s2 = criarSock();
  r2.registrarMensagemDaLoja('5511977777777@s.whatsapp.net');
  await r2.tratarMensagem(s2, msg('5511977777777@s.whatsapp.net', 'oi'));
  checa('conversa com atendente humano fica em silêncio', s2.enviados.length === 0);

  const r3 = robo({ cooldown_h: 0 }), s3 = criarSock();
  await r3.tratarMensagem(s3, msg('5511966666666@s.whatsapp.net', 'oi'));
  await r3.tratarMensagem(s3, msg('5511966666666@s.whatsapp.net', 'oi'));
  checa('cooldown 0 responde sempre (útil em teste)', s3.enviados.length === 2);
}

secao('Teto por minuto');
{
  const s = criarSock(), r = robo({ teto_min: 5 });
  await Promise.all(Array.from({ length: 30 }, (_, i) =>
    r.tratarMensagem(s, msg('55119' + (10000000 + i) + '@s.whatsapp.net', 'oi'))));
  checa('rajada de 30 respeita o teto de 5', s.enviados.length <= 5, s.enviados.length + ' enviadas');
}

secao('Modo "só saudações"');
{
  const s = criarSock(), r = robo({ modo: 'saudacoes' });
  const testa = async (texto, esperado, nome) => {
    const antes = s.enviados.length;
    await r.tratarMensagem(s, msg('5511' + Math.floor(Math.random() * 1e9) + '@s.whatsapp.net', texto));
    checa(nome, (s.enviados.length > antes) === esperado);
  };
  await testa('Bom dia!',                    true,  '"Bom dia!" responde');
  await testa('OLÁ, tem cardápio?',          true,  'acento e maiúscula não atrapalham');
  await testa('a nota fiscal veio errada',   false, 'texto que não é saudação não responde');
  await testa('que coisa estranha',          false, '"coisa" não dispara pela palavra "oi"');
  await testa('boi',                         false, '"boi" não dispara pela palavra "oi"');

  const s2 = criarSock(), r2 = robo({ modo: 'saudacoes', palavras: 'xispirito, abracadabra' });
  await r2.tratarMensagem(s2, msg('5511900000009@s.whatsapp.net', 'abracadabra'));
  checa('lista de palavras personalizada funciona', s2.enviados.length === 1);
  await r2.tratarMensagem(s2, msg('5511900000010@s.whatsapp.net', 'bom dia'));
  checa('fora da lista personalizada não responde', s2.enviados.length === 1);
}

secao('Números ignorados');
{
  const s = criarSock(), r = robo({ ignorar: '11 98888-7777, (11) 97777-6666' });
  checa('máscara vira só dígitos', r.cfg().ignorados.join() === '11988887777,11977776666');
  await r.tratarMensagem(s, msg('5511988887777@s.whatsapp.net', 'oi'));
  checa('número ignorado não recebe resposta', s.enviados.length === 0);
  await r.tratarMensagem(s, msg('5511911112222@s.whatsapp.net', 'oi'));
  checa('número fora da lista recebe normal', s.enviados.length === 1);
}

secao('Horário de funcionamento');
{
  const HOJE = horario.DIAS_PT[horario.agoraNoFuso('America/Sao_Paulo').dia];
  const sempre  = [{ day: HOJE, open: '00:00', close: '23:59', active: true }];
  const nunca   = [{ day: HOJE, open: '03:00', close: '03:01', active: true }];
  const inativo = [{ day: HOJE, open: '00:00', close: '23:59', active: false }];

  checa('janela do dia inteiro → aberta',  robo(null, sempre).lojaAberta() === true);
  checa('janela de 1 min às 03:00 → fechada', robo(null, nunca).lojaAberta() === false);
  checa('dia inativo → fechada',           robo(null, inativo).lojaAberta() === false);
  checa('sem horários → indefinido (null)', robo(null, []).lojaAberta() === null);
  checa('dia ausente da tabela → null',    robo(null, [{ day: 'Diadeteste', open: '1:00', close: '2:00', active: true }]).lojaAberta() === null);
  checa('override "1" vence o horário',    robo(null, nunca,  '1').lojaAberta() === true);
  checa('override "0" vence o horário',    robo(null, sempre, '0').lojaAberta() === false);
  checa('acento no nome do dia não quebra',
    robo(null, [{ day: 'sabado', open: '00:00', close: '23:59', active: true }]).lojaAberta() !== undefined);

  // Virada de meia-noite
  const { minutos } = horario.agoraNoFuso('America/Sao_Paulo');
  const hh = String(Math.floor(((minutos - 60) + 1440) % 1440 / 60)).padStart(2, '0');
  const viraNoite = [{ day: HOJE, open: hh + ':00', close: '03:00', active: true }];
  checa('janela que cruza a meia-noite inclui agora',
    robo(null, viraNoite).lojaAberta() === true, 'abre ' + hh + ':00, fecha 03:00');

  const s = criarSock(), r = robo(null, sempre, '0');
  const m = r.montarMensagem();
  checa('loja fechada usa o texto de fechada', /fechados/.test(m.texto));
  checa('{{abre}} é substituído', !/\{\{abre\}\}/.test(m.texto));
  checa('sem horário conhecido NÃO afirma que está fechado', !/fechados/.test(robo(null, []).montarMensagem().texto));

  await r.tratarMensagem(s, msg('5511900000011@s.whatsapp.net', 'oi'));
  checa('responder_fechado padrão (true) responde fechado', s.enviados.length === 1);

  const s2 = criarSock(), r2 = robo({ responder_fechado: false }, sempre, '0');
  await r2.tratarMensagem(s2, msg('5511900000012@s.whatsapp.net', 'oi'));
  checa('responder_fechado:false fica em silêncio', s2.enviados.length === 0);
}

secao('Configuração e desligamento');
{
  checa('config remota sobrepõe o padrão',
    robo({ loja: 'Outra Loja' }).cfg().loja === 'Outra Loja');
  checa('campo ausente cai no padrão',
    robo({ loja: 'Outra Loja' }).cfg().link === 'https://exemplo.test/menu');
  checa('campo desconhecido não quebra',
    robo({ campo_do_futuro: 42 }).cfg().ativo === true);
  checa('ativo:false desliga', robo({ ativo: false }).cfg().ativo === false);

  process.env.WA_AUTORESPOSTA = '0';
  checa('env var =0 vence a config remota', robo({ ativo: true }).cfg().ativo === false);
  delete process.env.WA_AUTORESPOSTA;

  checa('horas viram milissegundos',
    robo({ cooldown_h: 3, handoff_h: 1 }).cfg().cooldownMs === 10800000);
  checa('palavras em string viram lista',
    Array.isArray(robo({ palavras: 'a, b, c' }).cfg().palavras) &&
    robo({ palavras: 'a, b, c' }).cfg().palavras.length === 3);

  const r = robo();
  checa('estado() devolve o retrato', typeof r.estado().previa === 'string' && 'loja_aberta' in r.estado());
}

secao('Falha da fonte de configuração');
{
  const r = criarRobo({
    padroes: { loja: 'Loja Teste', link: 'x', delayMinS: 0, delayMaxS: 0 },
    carregarConfig: async () => { throw new Error('rede caiu'); },
    log: { log(){}, warn(){}, error(){} },
  });
  r._remoto.config = { loja: 'Config Antiga' };
  r._remoto.ok = true;
  await r.atualizar();
  checa('config anterior sobrevive à falha de rede', r.cfg().loja === 'Config Antiga');

  const s = criarSock();
  const r2 = criarRobo({ padroes: { delayMinS: 0, delayMaxS: 0 }, log: { log(){}, warn(){}, error(){} } });
  await r2.tratarMensagem(s, { key: null });
  checa('mensagem malformada não derruba o robô', true);
  await r2.tratarMensagem(null, msg('5511900000013@s.whatsapp.net', 'oi'));
  checa('sock nulo não derruba o robô', true);
}

secao('Config recarregada antes de responder');
{
  // O caso real: o dono fecha a loja no painel e o cliente manda mensagem
  // logo em seguida. Sem recarregar, o robô responderia com o cache antigo
  // e diria que a loja está aberta.
  let chamadas = 0;
  let estaAberta = true;
  const HOJE = horario.DIAS_PT[horario.agoraNoFuso('America/Sao_Paulo').dia];
  const r = criarRobo({
    padroes: { loja: 'Loja Teste', link: 'x', delayMinS: 0, delayMaxS: 0 },
    frescorMs: 0, // qualquer mensagem dispara a recarga
    carregarConfig: async () => {
      chamadas++;
      return { config: { delay_min_s: 0, delay_max_s: 0 }, override: estaAberta ? '1' : '0' };
    },
    carregarHorarios: async () => ([{ day: HOJE, open: '00:00', close: '23:59', active: true }]),
    log: { log(){}, warn(){}, error(){} },
  });
  await r.atualizar();
  checa('parte com a loja aberta', r.lojaAberta() === true);

  // dono fecha a loja — o cache do robô ainda diz aberta
  estaAberta = false;
  checa('cache ainda desatualizado antes da mensagem', r.lojaAberta() === true);

  const s = criarSock();
  await r.tratarMensagem(s, msg('5511900000020@s.whatsapp.net', 'oi'));
  checa('recarregou a config ao receber a mensagem', chamadas >= 2, chamadas + ' leituras');
  checa('respondeu com a loja FECHADA, nao com o cache antigo',
    s.enviados.length === 1 && /fechados/.test(s.enviados[0].texto));

  // responder_fechado:false deve calar E nao gastar o cooldown do contato
  let fechada2 = false;
  const r2 = criarRobo({
    padroes: { loja: 'L', link: 'x', delayMinS: 0, delayMaxS: 0 },
    frescorMs: 0,
    carregarConfig: async () => ({ config: { responder_fechado: false, delay_min_s: 0, delay_max_s: 0 }, override: fechada2 ? '0' : '1' }),
    carregarHorarios: async () => ([{ day: HOJE, open: '00:00', close: '23:59', active: true }]),
    log: { log(){}, warn(){}, error(){} },
  });
  await r2.atualizar();
  fechada2 = true;
  const s2 = criarSock();
  const jid2 = '5511900000021@s.whatsapp.net';
  await r2.tratarMensagem(s2, msg(jid2, 'oi'));
  checa('loja fechou e responder_fechado:false calou o robô', s2.enviados.length === 0);
  checa('contato NAO ficou marcado como saudado', !r2._saudados.has(jid2));
}

secao('Isolamento entre instâncias');
{
  const a = robo(), b = robo();
  const sa = criarSock(), sb = criarSock();
  const jid = '5511900000014@s.whatsapp.net';
  await a.tratarMensagem(sa, msg(jid, 'oi'));
  await b.tratarMensagem(sb, msg(jid, 'oi'));
  checa('dois robôs não compartilham estado', sa.enviados.length === 1 && sb.enviados.length === 1);
}

console.log('\n' + (falhas === 0
  ? 'TODOS OS ' + total + ' TESTES PASSARAM'
  : falhas + ' de ' + total + ' TESTES FALHARAM'));
process.exit(falhas === 0 ? 0 : 1);

})();
