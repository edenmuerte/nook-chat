const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, { cors: { origin: "*" } });

app.get('/', (req, res) => {
  res.send('Сервер Nook Chat успешно запущен и работает!');
});

// Хранилище теперь помнит всё: ID сокета -> { nick, room, avatar, x, y }
const users = {};

function sendOnlineList(room) {
  const usersInRoom = Object.values(users)
    .filter(u => u.room === room)
    .map(u => u.nick);
  io.to(room).emit('updateOnlineList', usersInRoom);
}

io.on('connection', (socket) => {
  console.log('Новый коннект!');

  socket.on('joinRoom', ({ nick, room, avatar, x, y }) => {
    // Если был в другой комнате - выходим
    if (users[socket.id] && users[socket.id].room) {
      const oldRoom = users[socket.id].room;
      socket.leave(oldRoom);
      sendOnlineList(oldRoom);
      io.to(oldRoom).emit('userLeft', nick);
    }

    // Запоминаем ВСЮ информацию (если координат нет, ставим центр 50x50)
    users[socket.id] = { nick, room, avatar, x: x || 50, y: y || 50 };
    socket.join(room);

    sendOnlineList(room);

    // 1. Отправляем НОВИЧКУ снимок всех, кто уже стоит в этой комнате
    const usersInRoom = Object.values(users).filter(u => u.room === room);
    socket.emit('roomState', usersInRoom);

    // 2. Говорим СТАРИЧКАМ в комнате, что появился новичок, чтобы они его отрисовали
    socket.to(room).emit('userSpawned', users[socket.id]);
  });

  socket.on('chatMessage', (data) => {
    if (users[socket.id]) {
      socket.to(users[socket.id].room).emit('message', data);
    }
  });

  socket.on('move', (data) => {
    if (users[socket.id]) {
      // Обновляем координаты в памяти сервера, чтобы новые люди видели актуальную позицию
      users[socket.id].x = data.x;
      users[socket.id].y = data.y;
      users[socket.id].avatar = data.avatar;
      
      socket.to(users[socket.id].room).emit('move', data);
    }
  });

  socket.on('disconnect', () => {
    if (users[socket.id]) {
      const { nick, room } = users[socket.id];
      delete users[socket.id];
      sendOnlineList(room);
      io.to(room).emit('userLeft', nick);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер слушает порт ${PORT}`));
