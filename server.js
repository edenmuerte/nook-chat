const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose'); // Библиотека для базы данных
const bcrypt = require('bcryptjs');   // Библиотека для шифрования паролей

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ ---
// ВСТАВЬ СВОЙ ПАРОЛЬ ВОТ СЮДА:
const MONGO_URI = 'mongodb+srv://nookadmin:aIgQ5nkwI0wTDVlY@nookcluster.vukngte.mongodb.net/?appName=NookCluster';

mongoose.connect(MONGO_URI)
  .then(() => console.log('Успешно подключились к MongoDB!'))
  .catch(err => console.error('Ошибка подключения к базе:', err));

// --- СХЕМА ПОЛЬЗОВАТЕЛЯ ---
// Так выглядит структура записи в нашей базе
const userSchema = new mongoose.Schema({
  nick: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  avatar: { type: String, default: '' }
});
const User = mongoose.model('User', userSchema);

// Хранилище онлайна: ID сокета -> { nick, room, avatar, x, y }
const users = {};

function sendOnlineList(room) {
  const usersInRoom = Object.values(users)
    .filter(u => u.room === room)
    .map(u => u.nick);
  io.to(room).emit('updateOnlineList', usersInRoom);
}

app.get('/', (req, res) => {
  res.send('Сервер Nook Chat успешно запущен и работает с базой данных!');
});

io.on('connection', (socket) => {
  console.log('Новый коннект!');

  // --- РЕГИСТРАЦИЯ НОВОГО ПОЛЬЗОВАТЕЛЯ ---
  socket.on('register', async (data, callback) => {
    try {
      // Ищем, нет ли уже такого ника
      const existingUser = await User.findOne({ nick: data.nick });
      if (existingUser) {
        return callback({ success: false, message: 'Этот ник уже занят!' });
      }
      
      // Шифруем пароль перед сохранением
      const hashedPassword = await bcrypt.hash(data.password, 10);
      
      // Создаем новую запись в базе
      const newUser = new User({
        nick: data.nick,
        password: hashedPassword,
        avatar: data.avatar || ''
      });
      await newUser.save();
      
      callback({ success: true, message: 'Регистрация прошла успешно!' });
    } catch (error) {
      console.error(error);
      callback({ success: false, message: 'Ошибка сервера при регистрации.' });
    }
  });

  // --- ВХОД (АВТОРИЗАЦИЯ) ---
  socket.on('login', async (data, callback) => {
    try {
      // Ищем пользователя в базе
      const user = await User.findOne({ nick: data.nick });
      if (!user) {
        return callback({ success: false, message: 'Такого пользователя не существует!' });
      }
      
      // Сравниваем введенный пароль с зашифрованным в базе
      const isMatch = await bcrypt.compare(data.password, user.password);
      if (!isMatch) {
        return callback({ success: false, message: 'Неверный пароль!' });
      }
      
      // Если всё ок, отдаем ссылку на аватарку
      callback({ success: true, avatar: user.avatar });
    } catch (error) {
      console.error(error);
      callback({ success: false, message: 'Ошибка сервера при входе.' });
    }
  });

  // --- ЛОГИКА КОМНАТ И ЧАТА (осталась без изменений) ---
  socket.on('joinRoom', ({ nick, room, avatar, x, y }) => {
    if (users[socket.id] && users[socket.id].room) {
      const oldRoom = users[socket.id].room;
      socket.leave(oldRoom);
      sendOnlineList(oldRoom);
      io.to(oldRoom).emit('userLeft', nick);
    }

    users[socket.id] = { nick, room, avatar, x: x || 50, y: y || 50 };
    socket.join(room);
    sendOnlineList(room);

    const usersInRoom = Object.values(users).filter(u => u.room === room);
    socket.emit('roomState', usersInRoom);
    socket.to(room).emit('userSpawned', users[socket.id]);
  });

  socket.on('chatMessage', (data) => {
    if (users[socket.id]) {
      socket.to(users[socket.id].room).emit('message', data);
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
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер слушает порт ${PORT}`));
