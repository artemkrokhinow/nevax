# Nevax - Secure P2P Voice & Video Calls

Toxic green themed peer-to-peer calling application with WebRTC.

## Features

- **Voice Calls** - Opus codec, echo cancellation, noise suppression
- **Video Calls** - WebRTC video with picture-in-picture
- **Text Chat** - Real-time messaging during calls
- **Contacts** - Online status, quick dial
- **Call History** - Recent calls log
- **Connection Stats** - Ping, bitrate, packet loss monitoring
- **Cross-Platform** - Windows, macOS, Linux

## Download

### Windows
Download `.exe` installer from [Releases](../../releases)

### macOS

#### Option 1: Download Pre-built .dmg (Easiest)
Download `Nevax_0.1.0_x64.dmg` from [Releases](../../releases)

1. Open the `.dmg` file
2. Drag Nevax to Applications folder
3. Launch from Applications

**If you get "App is damaged" warning:**
```bash
sudo xattr -rd com.apple.quarantine /Applications/Nevax.app
```

#### Option 2: Build on Mac (For Friends)
1. Install prerequisites:
   - Node.js 20+ (from https://nodejs.org or `brew install node`)
   - Rust (from https://rustup.rs)

2. Build:
   ```bash
   cd lite-client
   npm install
   npm run build:tauri
   ```

3. Find installer at:
   ```
   src-tauri/target/release/bundle/dmg/Nevax_0.1.0_x64.dmg
   ```

**Requirements:** macOS 10.13+ (Intel or Apple Silicon)

### Linux
Download `.AppImage` from [Releases](../../releases)

## Building from Source

### Prerequisites
- Node.js 20+
- Rust

### Windows
```bash
npm install
npm run build:tauri
```

### macOS
```bash
npm install
npm run build:tauri
# Output: src-tauri/target/release/bundle/dmg/*.dmg
```

### Linux
```bash
sudo apt-get install libgtk-3-dev libwebkit2gtk-4.0-dev
npm install
npm run build:tauri
```

## Development

```bash
npm run dev
```

## Architecture

- **Frontend**: HTML5 + CSS3 + Vanilla JS
- **Backend**: Tauri (Rust)
- **Signaling**: Socket.IO (separate server)
- **Media**: WebRTC with STUN/TURN

## Cross-Platform Calls

Windows ↔ macOS ↔ Linux - all work together!
- Same signaling server
- WebRTC peer-to-peer
- TURN servers for NAT traversal

## GitHub Actions Auto-Build

This project has automatic builds for all platforms via GitHub Actions:
- Windows `.exe` (NSIS installer)
- macOS `.dmg` (Drag to Applications)
- Linux `.AppImage` (Portable)

See `.github/workflows/build.yml`

## Troubleshooting

### macOS "App is damaged"
Run in Terminal:
```bash
sudo xattr -rd com.apple.quarantine /Applications/Nevax.app
```

### No microphone access
Make sure to allow microphone when prompted. Check System Preferences → Security & Privacy → Microphone.

### Connection issues
- Check that both users are connected to the same signaling server
- Verify firewall allows the application
- Try using TURN servers (configured by default)

## License

MIT
