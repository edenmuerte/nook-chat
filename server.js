const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, { cors: { origin: "*" } });

app.get('/', (req, res) => {
  res.send('Сервер Nook Chat успешно запущен и работает!');
});

// Хранилище: ID сокета -> { nick: 'Имя', room: 'ID_комнаты' }
const users = {};

// Вспомогательная функция для обновления списка онлайна в конкретной комнате
function sendOnlineList(room) {
  const usersInRoom = Object.values(users)
    .filter(u => u.room === room)
    .map(u => u.nick);
  io.to(room).emit('updateOnlineList', usersInRoom);
}

io.on('connection', (socket) => {
  console.log('Новый коннект!');

  // Когда пользователь заходит или меняет комнату
  socket.on('joinRoom', ({ nick, room }) => {
    // Если пользователь уже был в другой комнате, выходим из неё
    if (users[socket.id] && users[socket.id].room) {
      const oldRoom = users[socket.id].room;
      socket.leave(oldRoom);
      sendOnlineList(oldRoom); // Обновляем список онлайна там, откуда он ушел
      io.to(oldRoom).emit('userLeft', nick); // Говорим старой комнате удалить его аватарку
    }

    // Записываем новые данные и присоединяем к новой комнате
    users[socket.id] = { nick, room };
    socket.join(room);

    // Обновляем список онлайна в новой комнате
    sendOnlineList(room);
  });

  // Рассылаем сообщения ТОЛЬКО в текущую комнату пользователя
  socket.on('chatMessage', (data) => {
    if (users[socket.id]) {
      socket.to(users[socket.id].room).emit('message', data);
    }
  });

  // Рассылаем координаты ТОЛЬКО в текущую комнату
  socket.on('move', (data) => {
    if (users[socket.id]) {
      socket.to(users[socket.id].room).emit('move', data);
    }
  });

  // Когда пользователь закрывает вкладку
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
