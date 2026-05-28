const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose'); 
const bcrypt = require('bcryptjs');   
const path = require('path'); // НОВОЕ: модуль для путей

const webpush = require('web-push');

// Вставь сюда ключи
const vapidPublicKey = 'BA6TSlaJJJegLh5anQFoGhNJDx6PXenQnnBovXttARPVH0gpZ4VqLZfN_sF2vuBEKOUtIQj1khPl6QIA6-dlQic';
const vapidPrivateKey = '8hUixGe5f3NB34spUqdaTQIyzRbl2u9kpcrSL51tx9Y';

// Почта нужна сервисам Google/Apple для связи с разработчиком в случае проблем
webpush.setVapidDetails(
    'mailto:eden.muerte@gmail.com', 
    vapidPublicKey, 
    vapidPrivateKey
);

// Хранилище подписок в памяти (Ник -> Объект подписки)
const pushSubscriptions = new Map();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ВСТАВЬ СВОЙ ПАРОЛЬ ОТ BAZY DANYH
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

// --- НОВОЕ: РАЗДАЧА ФРОНТЕНДА ПРЯМО С РЕНДЕРА ---
// Говорим серверу, что файлы index.html, manifest.json и sw.js лежат в этой же папке
app.use(express.static(__dirname));

// При заходе на главную страницу отдаем наш чат
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
// ------------------------------------------------

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
    if (users[socket.id] && users[socket.id].room) {
      const oldRoom = users[socket.id].room;
      socket.leave(oldRoom);
      sendOnlineList(oldRoom);
      io.to(oldRoom).emit('userLeft', nick);
      io.to(oldRoom).emit('systemMessage', { text: `Пользователь ${nick} перешел в другую комнату` });
    }

    users[socket.id] = { nick, room, avatar, x: x || 50, y: y || 50 };
    socket.join(room);
    sendOnlineList(room);

    const usersInRoom = Object.values(users).filter(u => u.room === room);
    socket.emit('roomState', usersInRoom);
    socket.to(room).emit('userSpawned', users[socket.id]);
    
    socket.to(room).emit('systemMessage', { text: `Пользователь ${nick} вошел в комнату` });
  });

  socket.on('changeAvatar', async (newAvatarUrl, callback) => {
    try {
      const currentUser = users[socket.id];
      if (!currentUser) return callback({ success: false, message: 'Пользователь не авторизован.' });
      await User.updateOne({ nick: currentUser.nick }, { avatar: newAvatarUrl });
      currentUser.avatar = newAvatarUrl;
      io.to(currentUser.room).emit('move', { nick: currentUser.nick, avatar: newAvatarUrl, x: currentUser.x, y: currentUser.y });
      callback({ success: true });
    } catch (error) {
      callback({ success: false, message: 'Ошибка сервера при обновлении аватара.' });
    }
  });

  socket.on('chatMessage', (data) => {
    if (users[socket.id]) {
      socket.to(users[socket.id].room).emit('message', data);
    }
    // --- НОВЫЙ КОД: Рассылка пушей ВСЕМ ---
    const payload = JSON.stringify({
        title: data.nick, // Заголовок - имя отправителя
        body: data.text,  // Текст сообщения
        icon: 'https://cdn-icons-png.flaticon.com/512/1041/1041916.png'
    });

    // Проходимся по всем сохраненным подпискам
    pushSubscriptions.forEach((subscription, targetNick) => {
         // Отправляем всем, кроме автора сообщения
         if (targetNick !== data.nick) {
            webpush.sendNotification(subscription, payload)
                .catch(err => {
                    console.error(`Ошибка пуша для ${targetNick}:`, err);
                    // Если Apple/Google говорят, что токен протух (ошибка 410), удаляем его
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        pushSubscriptions.delete(targetNick);
                    }
                });
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
    // --- НОВЫЙ КОД: Пуш-уведомление адресату ---
    // Получаем подписку конкретного человека, которому пишем
    const targetSub = pushSubscriptions.get(data.to);
        
    // Если получатель когда-то разрешал пуши, отправляем:
    if (targetSub) {
        // В зависимости от того, как у тебя на сервере передается автор (data.from или socket.nick)
         const senderNick = data.from || 'Кто-то'; 

         const payload = JSON.stringify({
            title: `Шепот от ${senderNick} 🤫`,
            body: data.text,
            icon: 'https://cdn-icons-png.flaticon.com/512/1041/1041916.png'
        });

        webpush.sendNotification(targetSub, payload)
            .catch(err => {
                console.error(`Ошибка отправки пуша для ${data.to}:`, err);
                // Если токен устарел (пользователь удалил PWA), чистим память сервера
                if (err.statusCode === 410 || err.statusCode === 404) {
                    pushSubscriptions.delete(data.to);
                }
            });
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

  socket.on('typing', (isTyping) => {
    if (users[socket.id]) {
      socket.to(users[socket.id].room).emit('userTyping', {
        nick: users[socket.id].nick,
        isTyping: isTyping
      });
    }
  });

  // Ловим подписку на пуши от клиента
  socket.on('subscribeToPush', (data) => {
        if (data.nick && data.subscription) {
            pushSubscriptions.set(data.nick, data.subscription);
            console.log(`[Push] Подписка оформлена для пользователя: ${data.nick}`);
        }
  });

  // Обработка всплывающих эмодзи
  socket.on('emojiReaction', (data) => {
      // Пересылаем эмодзи всем пользователям в той же комнате
      io.to(data.room).emit('emojiReaction', data);
  });

  socket.on('disconnect', () => {
    if (users[socket.id]) {
      const { nick, room } = users[socket.id];
      delete users[socket.id];
      sendOnlineList(room);
      io.to(room).emit('userLeft', nick);
      io.to(room).emit('systemMessage', { text: `Пользователь ${nick} покинул чат` });
    }
  });
});

// --- ИСПРАВЛЕННЫЙ ПОРТ ДЛЯ РЕНДЕРА ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Сервер слушает порт ${PORT}`));
