# Для друга с Mac 🍎

## Способ 1: Собрать самому (Быстро)

### Что нужно:
- Mac с macOS 10.13 или новее
- Интернет
- 10 минут времени

### Шаги:

1. **Установить Node.js**
   - Открой Safari
   - Перейди на https://nodejs.org
   - Скачай версию 20.x LTS
   - Установи (два клика)

2. **Установить Rust**
   - Открой Terminal (Приложения → Утилиты → Терминал)
   - Вставь команду:
     ```bash
     curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
     ```
   - Нажми Enter, потом 1, потом Enter
   - Перезапусти Terminal

3. **Скопировать проект**
   - Скопируй папку `lite-client` на флешку или отправь через Telegram/Dropbox
   - Перенеси папку на Mac (например, в Documents)

4. **Собрать**
   ```bash
   cd Documents/lite-client
   npm install
   npm run build:tauri
   ```

5. **Найти установщик**
   - Открой Finder
   - Перейди в `Documents/lite-client/src-tauri/target/release/bundle/dmg/`
   - Файл `Nevax_0.1.0_x64.dmg` - это установщик!

6. **Установить**
   - Двойной клик по .dmg
   - Перетащи Nevax в Applications
   - Готово!

---

## Способ 2: GitHub Actions (Если есть GitHub)

1. Залей код на GitHub
2. Подожди 10 минут
3. Скачай готовый .dmg из Releases

---

## Если появится ошибка "App is damaged"

Открой Terminal и выполни:
```bash
sudo xattr -rd com.apple.quarantine /Applications/Nevax.app
```

Введи пароль Mac (не отображается при вводе) и нажми Enter.

---

## Звонки Windows ↔ Mac

Работают автоматически! Просто:
1. Оба должны быть подключены к серверу
2. Использовать одинаковые ID
3. Нажать Call

WebRTC соединяет напрямую, независимо от платформы.
