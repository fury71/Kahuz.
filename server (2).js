const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname + '/public'));

// Savollar: q=savol, a=variantlar, c=to'g'ri javob indeksi, t=soniya
const QUESTIONS = [
  { q: "O'zbekistonning poytaxti qaysi shahar?", a: ['Toshkent', 'Samarqand', 'Buxoro', 'Xiva'], c: 0, t: 15 },
  { q: "Alisher Navoiy qaysi asrda yashagan?", a: ['XIII asr', 'XV asr', 'XVII asr', 'XIX asr'], c: 1, t: 20 },
  { q: "2 + 2 × 2 nimaga teng?", a: ['8', '6', '4', '10'], c: 1, t: 15 },
  { q: "Suvning kimyoviy formulasi qaysi?", a: ['CO2', 'O2', 'H2O', 'NaCl'], c: 2, t: 15 },
  { q: "Amir Temur qaysi shaharni poytaxt qilgan?", a: ['Buxoro', 'Toshkent', 'Xiva', 'Samarqand'], c: 3, t: 15 },
  { q: "Kompyuterning \"miyasi\" deb nomlanadigan qism qaysi?", a: ['Monitor', 'Protsessor', 'Sichqoncha', 'Klaviatura'], c: 1, t: 20 },
];

const games = {};
const players = (g) => Object.values(g.players);
const board = (g) =>
  players(g).sort((a, b) => b.score - a.score).map(({ name, avatar, score }) => ({ name, avatar, score }));

function ask(g) {
  g.qi++;
  if (g.qi >= QUESTIONS.length) return io.to(g.pin).emit('over', board(g));
  const q = QUESTIONS[g.qi];
  g.open = true; g.start = Date.now(); g.counts = [0, 0, 0, 0];
  players(g).forEach((p) => { p.ans = null; p.gain = 0; });
  io.to(g.pin).emit('question', { n: g.qi + 1, total: QUESTIONS.length, q: q.q, a: q.a, t: q.t });
  clearTimeout(g.timer);
  g.timer = setTimeout(() => reveal(g), q.t * 1000);
}

function reveal(g) {
  if (!g.open) return;
  g.open = false; clearTimeout(g.timer);
  const q = QUESTIONS[g.qi];
  for (const [id, p] of Object.entries(g.players))
    io.to(id).emit('result', { correct: p.ans === q.c, gain: p.gain, score: p.score });
  io.to(g.host).emit('reveal', { c: q.c, counts: g.counts, top: board(g), last: g.qi === QUESTIONS.length - 1 });
}

io.on('connection', (s) => {
  s.on('create', () => {
    let pin; do pin = String(Math.floor(100000 + Math.random() * 900000)); while (games[pin]);
    games[pin] = { pin, host: s.id, players: {}, qi: -1, open: false, counts: [0, 0, 0, 0] };
    s.pin = pin; s.join(pin); s.emit('created', pin);
  });

  s.on('join', ({ pin, name, avatar }) => {
    const g = games[pin];
    if (!g) return s.emit('err', "PIN topilmadi");
    if (!name) return s.emit('err', "Ismingizni yozing");
    if (g.qi >= 0) return s.emit('err', "O'yin boshlanib bo'lgan");
    g.players[s.id] = { name: name.slice(0, 16), avatar: String(avatar).slice(0, 30), score: 0, ans: null, gain: 0 };
    s.pin = pin; s.join(pin); s.emit('joined');
    io.to(g.host).emit('lobby', players(g).map(({ name, avatar }) => ({ name, avatar })));
  });

  s.on('next', () => {
    const g = games[s.pin];
    if (g && g.host === s.id && !g.open) ask(g);
  });

  s.on('answer', (i) => {
    const g = games[s.pin], p = g && g.players[s.id];
    if (!p || !g.open || p.ans !== null || ![0, 1, 2, 3].includes(i)) return;
    const q = QUESTIONS[g.qi];
    p.ans = i; g.counts[i]++;
    // tezroq javob = ko'proq ball (maks. 1000)
    p.gain = i === q.c ? Math.round(1000 * (1 - (Date.now() - g.start) / (q.t * 1000) / 2)) : 0;
    p.score += p.gain;
    io.to(g.host).emit('answered', players(g).filter((x) => x.ans !== null).length);
    if (players(g).every((x) => x.ans !== null)) reveal(g);
  });

  s.on('disconnect', () => {
    const g = games[s.pin];
    if (!g) return;
    if (g.host === s.id) { clearTimeout(g.timer); io.to(g.pin).emit('err', "Ustoz chiqib ketdi"); delete games[s.pin]; }
    else if (g.players[s.id] && g.qi < 0) {
      delete g.players[s.id];
      io.to(g.host).emit('lobby', players(g).map(({ name, avatar }) => ({ name, avatar })));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Kahuz! ishga tushdi: http://localhost:' + PORT));
