// Запасний шлях завантаження: players.js оголошує `const players` у глобальній
// області, а не на window. Цей файл підключається після players.js і licenses.js
// (лише якщо fetch не спрацював) і передає дані панелі.
window.__siyaRegistry = {
  players: typeof players !== "undefined" ? players : null,
  licenses: window.licenses || null,
};
