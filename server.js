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

// Логика чата
io.on('connection', (socket) => {
  console.log('Новый пользователь зашел в Nook!');

  // Когда кто-то пишет сообщение, пересылаем его всем остальным
  socket.on('chatMessage', (data) => {
    socket.broadcast.emit('message', data);
  });

  socket.on('disconnect', () => {
    console.log('Пользователь покинул Nook');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер слушает порт ${PORT}`);
});
