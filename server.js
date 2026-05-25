const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

app.get('/', (req, res) => {
  res.send('Сервер Nook Chat успешно запущен и работает!');
});

// Хранилище онлайн-пользователей (Связка: ID сокета -> Никнейм)
const onlineUsers = {};

io.on('connection', (socket) => {
  console.log('Новый системный коннект!');

  // Когда пользователь ввел ник и нажал "Войти"
  socket.on('userJoined', (nick) => {
    onlineUsers[socket.id] = nick; // Записываем в память сервера
    io.emit('updateOnlineList', Object.values(onlineUsers)); // Рассылаем всем массив ников
  });

  socket.on('chatMessage', (data) => {
    socket.broadcast.emit('message', data);
  });

  socket.on('move', (data) => {
    socket.broadcast.emit('move', data);
  });

  // Когда пользователь закрывает вкладку браузера
  socket.on('disconnect', () => {
    if (onlineUsers[socket.id]) {
      delete onlineUsers[socket.id]; // Удаляем из памяти
      io.emit('updateOnlineList', Object.values(onlineUsers)); // Обновляем список у оставшихся
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер слушает порт ${PORT}`);
});
