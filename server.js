const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// rooms: { roomId: { p1: ws, p2: ws, choices: {p1: null, p2: null}, scores: {p1:0, p2:0} } }
const rooms = {};

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const beats = { 'ჭა': 'მაკრატელი', 'მაკრატელი': 'ქვა', 'ქვა': 'ჭა' };

function getResult(c1, c2) {
  if (c1 === c2) return 'draw';
  if (beats[c1] === c2) return 'p1';
  return 'p2';
}

function send(ws, data) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
}

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.role = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // CREATE ROOM
    if (msg.type === 'create') {
      const roomId = generateRoomId();
      rooms[roomId] = { p1: ws, p2: null, choices: { p1: null, p2: null }, scores: { p1: 0, p2: 0 } };
      ws.roomId = roomId;
      ws.role = 'p1';
      send(ws, { type: 'created', roomId });
    }

    // JOIN ROOM
    else if (msg.type === 'join') {
      const room = rooms[msg.roomId];
      if (!room) return send(ws, { type: 'error', message: 'ოთახი არ მოიძებნა!' });
      if (room.p2) return send(ws, { type: 'error', message: 'ოთახი სავსეა!' });

      room.p2 = ws;
      ws.roomId = msg.roomId;
      ws.role = 'p2';

      send(room.p1, { type: 'start', role: 'p1' });
      send(room.p2, { type: 'start', role: 'p2' });
    }

    // CHOOSE
    else if (msg.type === 'choose') {
      const room = rooms[ws.roomId];
      if (!room) return;
      const role = ws.role;
      room.choices[role] = msg.choice;

      // notify opponent that this player has chosen (without revealing)
      const opponent = role === 'p1' ? room.p2 : room.p1;
      send(opponent, { type: 'opponent_chose' });
      send(ws, { type: 'you_chose' });

      // both chosen → reveal
      if (room.choices.p1 && room.choices.p2) {
        const result = getResult(room.choices.p1, room.choices.p2);
        if (result === 'p1') room.scores.p1++;
        else if (result === 'p2') room.scores.p2++;

        const payload = {
          type: 'reveal',
          p1choice: room.choices.p1,
          p2choice: room.choices.p2,
          result,
          scores: { ...room.scores }
        };
        send(room.p1, payload);
        send(room.p2, payload);

        // reset choices
        room.choices = { p1: null, p2: null };
      }
    }

    // RESET SCORES
    else if (msg.type === 'reset') {
      const room = rooms[ws.roomId];
      if (!room) return;
      room.scores = { p1: 0, p2: 0 };
      room.choices = { p1: null, p2: null };
      const payload = { type: 'reset_done' };
      send(room.p1, payload);
      send(room.p2, payload);
    }
  });

  ws.on('close', () => {
    const room = rooms[ws.roomId];
    if (!room) return;
    const opponent = ws.role === 'p1' ? room.p2 : room.p1;
    send(opponent, { type: 'opponent_left' });
    delete rooms[ws.roomId];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
