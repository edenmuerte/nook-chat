self.addEventListener('install', (e) => {
    console.log('[Service Worker] Установлен');
});

// Ловим пуш от серверов Apple/Google
self.addEventListener('push', function(event) {
    let data = {};
    if (event.data) {
        data = event.data.json();
    }

    const title = data.title || 'Nook Chat';
    const options = {
        body: data.body || 'У вас новое сообщение',
        icon: data.icon || 'https://cdn-icons-png.flaticon.com/512/1041/1041916.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/1041/1041916.png',
        vibrate: [200, 100, 200], // Вибрация для Android
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// Ловим клик по самому уведомлению (чтобы открыть чат)
self.addEventListener('notificationclick', function(event) {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(function(clientList) {
            // Если чат уже открыт во вкладке - просто фокусируемся на ней
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if (client.url.includes('/') && 'focus' in client) {
                    return client.focus();
                }
            }
            // Если приложение закрыто - открываем его
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});

self.addEventListener('fetch', (e) => {
    // Просто пропускаем все запросы, нам SW нужен только для галочки PWA
});
