const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose'); 
const bcrypt = require('bcryptjs');   

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ ---
const MONGO_URI = 'mongodb+srv://nookadmin:aIgQ5nkwI0wTDVlY@nookcluster.vukngte.mongodb.net/?appName=NookCluster';

mongoose.connect(MONGO_URI)
  .then(() => console.log('Успешно подключились к MongoDB!'))
  .catch(err => console.error('Ошибка подключения к базе:', err));

const userSchema = new mongoose.Schema({
  nick: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  avatar: { type: String, default: '' }
});
const User = mongoose.model('User', userSchema);

const users = {};

function sendOnlineList(room) {
  const usersInRoom = Object.values(users)
    .filter(u => u.room === room)
    .map(u => u.nick);
  io.to(room).emit('updateOnlineList', usersInRoom);
}

app.get('/', (req, res) => {
  res.send('Сервер Nook Chat успешно запущен!');
});

io.on('connection', (socket) => {
  
  socket.on('register', async (data, callback) => {
    try {
      const existingUser = await User.findOne({ nick: data.nick });
      if (existingUser) return callback({ success: false, message: 'Этот ник уже занят!' });
      
      const hashedPassword = await bcrypt.hash(data.password, 10);
      const newUser = new User({ nick: data.nick, password: hashedPassword, avatar: data.avatar || '' });
      await newUser.save();
      
      callback({ success: true, message: 'Регистрация прошла успешно!' });
    } catch (error) {
      callback({ success: false, message: 'Ошибка сервера при регистрации.' });
    }
  });

  socket.on('login', async (data, callback) => {
    try {
      const user = await User.findOne({ nick: data.nick });
      if (!user) return callback({ success: false, message: 'Такого пользователя не существует!' });
      
      const isMatch = await bcrypt.compare(data.password, user.password);
      if (!isMatch) return callback({ success: false, message: 'Неверный пароль!' });
      
      callback({ success: true, avatar: user.avatar });
    } catch (error) {
      callback({ success: false, message: 'Ошибка сервера при входе.' });
    }
  });

  socket.on('joinRoom', ({ nick, room, avatar, x, y }) => {
    // Если пользователь уже был в комнате — значит он переходит в другую локацию
    if (users[socket.id] && users[socket.id].room) {
      const oldRoom = users[socket.id].room;
      socket.leave(oldRoom);
      sendOnlineList(oldRoom);
      io.to(oldRoom).emit('userLeft', nick);
      
      // Лог для старой комнаты: юзер ушел
      io.to(oldRoom).emit('systemMessage', { text: `Пользователь ${nick} перешел в другую комнату` });
    }

    users[socket.id] = { nick, room, avatar, x: x || 50, y: y || 50 };
    socket.join(room);
    sendOnlineList(room);

    const usersInRoom = Object.values(users).filter(u => u.room === room);
    socket.emit('roomState', usersInRoom);
    socket.to(room).emit('userSpawned', users[socket.id]);
    
    // Лог для новой комнаты: юзер вошел
    socket.to(room).emit('systemMessage', { text: `Пользователь ${nick} вошел в комнату` });
  });

  socket.on('chatMessage', (data) => {
    if (users[socket.id]) {
      socket.to(users[socket.id].room).emit('message', data);
    }
  });

  socket.on('privateMessage', (data) => {
    const sender = users[socket.id];
    if (!sender) return;

    const targetEntry = Object.entries(users).find(([id, u]) => u.nick === data.to);

    if (targetEntry) {
      const targetSocketId = targetEntry[0];
      const msgPayload = { from: sender.nick, to: data.to, text: data.text, avatar: sender.avatar };
      io.to(targetSocketId).emit('privateMessage', msgPayload);
      socket.emit('privateMessage', msgPayload);
    } else {
      socket.emit('systemMessage', { text: `Пользователь ${data.to} не найден или не в сети.` });
    }
  });

  socket.on('move', (data) => {
    if (users[socket.id]) {
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
      
      // Лог полного выхода из чата (закрыл вкладку или нажал логаут)
      io.to(room).emit('systemMessage', { text: `Пользователь ${nick} покинул чат` });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер слушает порт ${PORT}`));
