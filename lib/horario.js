// ============================================================
//  wa-autoresposta — lib/horario.js
//  Loja aberta ou fechada, no fuso certo
// ============================================================
//
//  Servidor em nuvem quase sempre roda em UTC. Sem fixar o fuso,
//  às 21h de Brasília o processo já acha que virou o dia e passa
//  a responder "estamos fechados" com a loja cheia. Por isso nada
//  aqui usa getDay() ou getHours() do relógio local.
//
//  Formato esperado de cada horário (o mesmo que o painel grava):
//    { day: 'Segunda-feira', open: '11:00', close: '23:00', active: true }
// ============================================================

'use strict';

const DIAS_PT = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

function _chave(nome) {
  return String(nome || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Devolve { dia: 0..6, minutos: 0..1439 } no fuso pedido.
function agoraNoFuso(fuso) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso || 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = {};
  for (const parte of fmt.formatToParts(new Date())) p[parte.type] = parte.value;
  const hora = Number(p.hour) === 24 ? 0 : Number(p.hour); // meia-noite às vezes vem como "24"
  const d = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  return { dia: d.getUTCDay(), minutos: hora * 60 + Number(p.minute) };
}

function _doDia(horarios, indiceDia, dias) {
  const alvo = _chave((dias || DIAS_PT)[indiceDia]);
  return (horarios || []).find(h => _chave(h.day) === alvo) || null;
}

function _emMinutos(hhmm, padrao) {
  const partes = String(hhmm || '').split(':');
  const h = Number(partes[0]), m = Number(partes[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return padrao;
  return h * 60 + m;
}

// true = aberta, false = fechada, null = não deu para saber.
//
// O null é importante: sem dado de horário é melhor tratar como
// aberta e mandar a saudação normal do que afirmar ao cliente que
// a loja está fechada quando ela pode estar funcionando.
//
// `override` ('1' | '0' | null) é o abre/fecha manual: vence o horário.
function lojaAberta(horarios, opcoes) {
  const o = opcoes || {};
  if (o.override === '1') return true;
  if (o.override === '0') return false;

  if (!horarios || !horarios.length) return null;

  const { dia, minutos } = agoraNoFuso(o.fuso);
  const h = _doDia(horarios, dia, o.dias);
  if (!h) return null;
  if (!h.active) return false;

  const abre  = _emMinutos(h.open, 0);
  const fecha = _emMinutos(h.close, 0);
  return fecha > abre
    ? (minutos >= abre && minutos < fecha)
    : (minutos >= abre || minutos < fecha); // vira a meia-noite
}

// "hoje às 18:00" / "amanhã às 11:00" / "na sexta-feira às 11:00"
// Sem dado suficiente, devolve o texto de reserva ('em breve').
function proximaAbertura(horarios, opcoes) {
  const o = opcoes || {};
  const reserva = o.reserva || 'em breve';
  if (!horarios || !horarios.length) return reserva;

  const { dia, minutos } = agoraNoFuso(o.fuso);
  for (let i = 0; i < 8; i++) {
    const h = _doDia(horarios, (dia + i) % 7, o.dias);
    if (!h || !h.active) continue;
    const abre = _emMinutos(h.open, -1);
    if (abre < 0) continue;
    if (i === 0 && abre <= minutos) continue; // hoje a abertura já passou
    if (i === 0) return 'hoje às ' + h.open;
    if (i === 1) return 'amanhã às ' + h.open;
    return 'na ' + String(h.day || '').toLowerCase() + ' às ' + h.open;
  }
  return reserva;
}

module.exports = { agoraNoFuso, lojaAberta, proximaAbertura, DIAS_PT };
