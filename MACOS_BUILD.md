# macOS Build Instructions

## Для твоего друга с Mac 💻

### Вариант 1: Собрать самому (рекомендуется)

1. **Скачать исходники:**
   ```bash
   git clone https://github.com/yourusername/nevax.git
   cd nevax
   ```
   Или просто скопируй папку `lite-client` на Mac.

2. **Установить Node.js:**
   - Скачай с https://nodejs.org/ (версия 20+)
   - Или через Homebrew: `brew install node`

3. **Установить Rust:**
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source $HOME/.cargo/env
   ```

4. **Собрать:**
   ```bash
   cd lite-client
   chmod +x build-mac.sh
   ./build-mac.sh
   ```

5. **Найти .dmg:**
   ```
   src-tauri/target/release/bundle/dmg/Nevax_0.1.0_x64.dmg
   ```

### Вариант 2: GitHub Actions (Автоматическая сборка)

1. Залей код на GitHub
2. Перейди в Actions → Build
3. Скачай артефакт `Nevax-macOS`

### Установка на Mac

1. Открой `.dmg` файл
2. Перетащи Nevax в Applications
3. Если появится ошибка "App is damaged":
   ```bash
   sudo xattr -rd com.apple.quarantine /Applications/Nevax.app
   ```

### Совместимость

- ✅ macOS 10.13 (High Sierra) и новее
- ✅ Intel Mac
- ✅ Apple Silicon (M1/M2/M3) - через Rosetta 2

### Звонки Windows ↔ Mac

Звонки между Windows и Mac работают! Оба подключаются к одному signaling серверу.
