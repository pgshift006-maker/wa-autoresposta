# wa-autoresposta

Resposta automática à primeira mensagem do cliente no WhatsApp, para servidores que usam [Baileys](https://github.com/WhiskeySockets/Baileys).

**Zero dependências · Node 18+ · 59 testes que rodam sem rede**

Em produção numa hamburgueria: atende o cliente sozinho, sabe se a loja está aberta pelo horário cadastrado, e fica em silêncio quando um atendente humano entra na conversa.

```js
const { criarRobo } = require('./wa-autoresposta');

const robo = criarRobo({
  padroes: { loja: 'Pizzaria do Bairro', link: 'https://.../cardapio' },
}).iniciar();

sock.ev.on('messages.upsert', (m) => {
  if (m.type !== 'notify') return;
  for (const msg of m.messages) robo.tratarMensagem(sock, msg);
});
```

## Instalação

```bash
npm install github:pgshift006-maker/wa-autoresposta
```

Ou copie a pasta para dentro do seu projeto. Não há `npm install` a fazer dentro dela: o pacote não tem dependências.

---

## Por que isto não é um `if` no seu `messages.upsert`

Porque as coisas que fazem o WhatsApp bloquear o número não são óbvias:

- **Ao reconectar, o Baileys entrega toda a fila acumulada** marcada como `notify`. Sem filtrar por idade, o número dispara dezenas de respostas de uma vez — o padrão clássico de banimento. Aqui, mensagem com mais de 60s é descartada.
- **Suas próprias mensagens voltam pelo `upsert`.** Sem tratar isso, o robô responde a si mesmo.
- **Grupo, status, canal e transmissão** chegam pelo mesmo evento.
- **Responder no mesmo instante** denuncia o robô. Aqui há presença, "digitando" e um atraso aleatório.
- **Um humano já respondendo** aquela conversa precisa calar o robô, ou o cliente recebe as duas coisas.

---

## Uso mínimo

```js
const { criarRobo } = require('./wa-autoresposta');

const robo = criarRobo({
  padroes: {
    loja: 'Pizzaria do Bairro',
    link: 'https://pizzariadobairro.com.br/cardapio',
  },
}).iniciar();

sock.ev.on('messages.upsert', (m) => {
  if (m.type !== 'notify') return;
  for (const msg of m.messages) robo.tratarMensagem(sock, msg);
});
```

Passe **todas** as mensagens, inclusive as `fromMe` — é por elas que o robô percebe o atendente entrando na conversa.

No seu endpoint de envio manual, avise o robô:

```js
await sock.sendMessage(jid, { text: mensagem });
robo.registrarMensagemDaLoja(jid);   // cala o robô nesta conversa
```

---

## Configuração editável sem deploy

`carregarConfig` e `carregarHorarios` são chamados a cada 60s em segundo plano. `tratarMensagem` lê só do cache e **nunca espera a rede** — uma consulta lenta não atrasa a resposta ao cliente. Se a consulta falhar, o cache anterior continua valendo.

```js
const { criarFonteSupabase } = require('./wa-autoresposta/fontes/supabase');

const fonte = criarFonteSupabase({
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_KEY,   // a chave anon basta: só lemos
  idConfig: 'wa_autoreply',
  idOverride: 'loja_override',
});

const robo = criarRobo({
  carregarConfig: fonte.carregarConfig,
  carregarHorarios: fonte.carregarHorarios,
  padroes: { loja: 'Pizzaria do Bairro', link: 'https://...' },
}).iniciar();
```

Qualquer outra origem serve — é só devolver os mesmos formatos:

```js
criarRobo({
  carregarConfig:   async () => ({ config: { ativo: true, texto_aberto: '...' }, override: null }),
  carregarHorarios: async () => ([{ day: 'Segunda-feira', open: '11:00', close: '23:00', active: true }]),
});
```

---

## Opções de `criarRobo`

| Opção | Padrão | O que faz |
|---|---|---|
| `padroes` | ver abaixo | Config fixa, usada quando não há config remota |
| `carregarConfig` | — | `async () => ({ config, override })` |
| `carregarHorarios` | — | `async () => [{ day, open, close, active }]` |
| `fuso` | `'America/Sao_Paulo'` | Fuso dos horários |
| `intervaloMs` | `60000` | De quanto em quanto tempo relê a config |
| `prefixoEnv` | `'WA_AUTORESPOSTA'` | Env var que desliga tudo quando vale `0` |
| `aoResponder` | — | Callback `({ jid, texto, aberta, recebido })` |
| `log` | `console` | Objeto com `.log`, `.warn`, `.error` |

### `padroes` / config remota

A config remota usa `snake_case` porque costuma vir de um painel gravada como JSON. Os dois se misturam: o que faltar na remota cai no padrão.

| Padrão | Config remota | Valor | O que faz |
|---|---|---|---|
| `loja` | `loja` | `'Nossa loja'` | Substitui `{{loja}}` |
| `link` | `link_cardapio` | `''` | Substitui `{{link}}` |
| `textoAberto` | `texto_aberto` | ver `PADROES` | Mensagem com a loja aberta |
| `textoFechado` | `texto_fechado` | ver `PADROES` | Mensagem com a loja fechada |
| `modo` | `modo` | `'primeira'` | `'primeira'` ou `'saudacoes'` |
| `palavras` | `palavras` | lista embutida | Gatilhos do modo `saudacoes` |
| `responderFechado` | `responder_fechado` | `true` | Responder fora do horário |
| `ignorar` | `ignorar` | `[]` | Números que o robô nunca responde |
| `cooldownH` | `cooldown_h` | `12` | Horas até saudar o mesmo contato de novo |
| `handoffH` | `handoff_h` | `2` | Horas de silêncio depois que a loja falou |
| `idadeMaxS` | `idade_max_s` | `60` | Idade máxima da mensagem |
| `tetoMin` | `teto_min` | `20` | Teto de respostas por minuto |
| `delayMinS` / `delayMaxS` | `delay_min_s` / `delay_max_s` | `2` / `4` | Segundos "digitando" |

`palavras` e `ignorar` aceitam array ou string separada por vírgula.

**Variáveis nos textos:** `{{loja}}`, `{{link}}` e `{{abre}}` — este último vira `"amanhã às 11:00"`, calculado dos horários.

---

## Horário de funcionamento

```js
{ day: 'Segunda-feira', open: '11:00', close: '23:00', active: true }
```

- `close` menor que `open` significa virada de meia-noite (`20:00`–`02:00`).
- `active: false` fecha o dia inteiro.
- `override` `'1'` ou `'0'` é o abre/fecha manual e **vence o horário**.
- **Sem dado de horário, o robô assume ABERTA** e manda a saudação normal. Afirmar "estamos fechados" para o cliente de uma loja aberta é pior do que uma saudação genérica.

O fuso é explícito de propósito: servidor em nuvem roda em UTC, e às 21h de Brasília o processo já acha que virou o dia.

---

## Diagnóstico

```js
app.get('/whatsapp/autoresposta', (_req, res) => res.json(robo.estado()));
```

```json
{ "ativo": true, "config_carregada": true, "loja_aberta": false,
  "proxima_abertura": "amanhã às 11:00", "modo": "primeira",
  "cooldown_h": 12, "handoff_h": 2,
  "contatos_em_cooldown": 14, "conversas_com_atendente": 3,
  "previa": "Olá! 👋 ..." }
```

Mostra o que o robô **realmente carregou**, não o que está salvo na tela do painel.

---

## Desligar

1. `WA_AUTORESPOSTA=0` no ambiente — vence tudo, inclusive a config remota. É o freio de mão.
2. `ativo: false` na config remota.
3. `robo.parar()` no código.

---

## Limites que você deve conhecer

**O estado vive em memória.** Reiniciar o processo zera o cooldown e o handoff, e um contato pode ser saudado de novo. É a troca para não exigir banco. Se isso importar, use `aoResponder` para persistir e reidrate `_saudados` na subida.

**O Baileys não é oficial.** Volume alto de mensagens automáticas para números que nunca falaram com você aumenta o risco de bloqueio. Os limites daqui reduzem, não eliminam. Para volume alto, o caminho é a API oficial da Meta.

**Um robô por processo.** `criarRobo` devolve instâncias independentes, mas cada uma serve um `sock`.

---

## API

| Método | O que faz |
|---|---|
| `criarRobo(opcoes)` | Cria o robô |
| `.iniciar()` | Liga a atualização periódica e a limpeza. Devolve o robô |
| `.parar()` | Desliga os timers |
| `.tratarMensagem(sock, msg)` | Chame para cada mensagem do `upsert` |
| `.registrarMensagemDaLoja(jid)` | Avisa que um humano falou nesta conversa |
| `.estado()` | Retrato para diagnóstico |
| `.montarMensagem()` | O texto que sairia agora |
| `.lojaAberta()` | `true` / `false` / `null` |
| `.atualizar()` | Força a releitura da config |

Também exportados: `PADROES`, `mensagem` (leitura do Baileys) e `horario` (fuso e horário), úteis à parte.
