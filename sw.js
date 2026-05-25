self.addEventListener('install', (e) => {
    console.log('[Service Worker] Установлен');
});

self.addEventListener('fetch', (e) => {
    // Просто пропускаем все запросы, нам SW нужен только для галочки PWA
});
