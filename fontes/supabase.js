// ============================================================
//  wa-autoresposta — fontes/supabase.js
//  Config e horários vindos de um projeto Supabase (só leitura)
// ============================================================
//
//  Fonte OPCIONAL. O robô funciona sem ela, com os textos fixos
//  passados em `padroes`. Use esta fonte quando a configuração
//  precisar ser editável por um painel sem novo deploy.
//
//  Espera duas tabelas (nomes configuráveis):
//
//    configuracoes ( id text primary key, valor text )
//        uma linha cujo `valor` é o JSON da config do robô,
//        e opcionalmente outra com o abre/fecha manual ('1'/'0').
//
//    horarios ( day text, open text, close text, active bool )
//        um registro por dia da semana.
//
//  Usa o fetch nativo (Node 18+) — nenhuma dependência.
// ============================================================

'use strict';

function criarFonteSupabase(opcoes) {
  const o = opcoes || {};
  const url = String(o.url || '').replace(/\/+$/, '');
  const key = o.key || '';
  if (!url || !key) throw new Error('fonteSupabase: informe `url` e `key`.');

  const tabelaConfig   = o.tabelaConfig   || 'configuracoes';
  const tabelaHorarios = o.tabelaHorarios || 'horarios';
  const idConfig       = o.idConfig       || 'wa_autoreply';
  const idOverride     = o.idOverride     || null; // ex.: 'loja_override'
  const timeoutMs      = o.timeoutMs      || 8000;

  async function get(caminho) {
    const res = await fetch(url + '/rest/v1/' + caminho, {
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' em ' + caminho);
    return res.json();
  }

  // Devolve { config, override } no formato que o robô espera.
  async function carregarConfig() {
    const ids  = idOverride ? [idConfig, idOverride] : [idConfig];
    const rows = await get(tabelaConfig + '?id=in.(' + ids.join(',') + ')&select=id,valor');

    const porId = {};
    for (const r of rows || []) porId[r.id] = r.valor;

    let config = null;
    if (porId[idConfig]) {
      // JSON inválido não pode derrubar o robô: cai nos padrões.
      try { config = JSON.parse(porId[idConfig]); } catch (_) { config = null; }
    }

    const bruto = idOverride ? porId[idOverride] : undefined;
    const override = (bruto === '1' || bruto === '0') ? bruto : null;

    return { config, override };
  }

  async function carregarHorarios() {
    const rows = await get(tabelaHorarios + '?select=day,open,close,active');
    return Array.isArray(rows) ? rows : [];
  }

  return { carregarConfig, carregarHorarios };
}

module.exports = { criarFonteSupabase };
