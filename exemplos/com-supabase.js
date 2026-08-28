// ============================================================
//  Exemplo 2 — configuração editável por painel, via Supabase
//  Os textos, o horário e o liga/desliga passam a ser mudados
//  sem novo deploy: o robô relê a cada 60 segundos.
// ============================================================

const { criarRobo } = require('..');
const { criarFonteSupabase } = require('../fontes/supabase');

const fonte = criarFonteSupabase({
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_KEY,   // a chave `anon` basta: só lemos
  idConfig: 'wa_autoreply',        // linha da tabela `configuracoes`
  idOverride: 'loja_override',     // abre/fecha manual: '1' | '0' | ausente
});

const robo = criarRobo({
  fuso: 'America/Sao_Paulo',
  carregarConfig: fonte.carregarConfig,
  carregarHorarios: fonte.carregarHorarios,
  // Valem enquanto a linha do painel não existir
  padroes: {
    loja: 'Pizzaria do Bairro',
    link: 'https://pizzariadobairro.com.br/cardapio',
  },
  // Opcional: registre num log próprio cada resposta enviada
  aoResponder: ({ jid, aberta }) => {
    console.log('respondi', jid, aberta === false ? '(fechada)' : '(aberta)');
  },
}).iniciar();

// ── Endpoint de diagnóstico (Express) ────────────────────────
// Mostra a config que o robô REALMENTE carregou, não a que está
// salva na tela do painel. É a diferença entre achar que salvou
// e saber que salvou.
//
// app.get('/whatsapp/autoresposta', (_req, res) => res.json(robo.estado()));

module.exports = robo;
