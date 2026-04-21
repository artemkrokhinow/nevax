#!/bin/bash

# Build script for macOS
# Run this on a Mac to create .dmg installer

echo "🚀 Building Nevax for macOS..."

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ Error: This script must be run on macOS"
    exit 1
fi

# Check dependencies
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Install from https://nodejs.org/"
    exit 1
fi

if ! command -v cargo &> /dev/null; then
    echo "❌ Rust not found. Install from https://rustup.rs/"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm not found"
    exit 1
fi

echo "📦 Installing dependencies..."
npm install

echo "🔨 Building application..."
npm run build:tauri

echo ""
echo "✅ Build complete!"
echo ""
echo "📍 Installer location:"
echo "   src-tauri/target/release/bundle/dmg/Nevax_0.1.0_x64.dmg"
echo ""
echo "📝 To install:"
echo "   1. Open the .dmg file"
echo "   2. Drag Nevax to Applications folder"
echo "   3. If 'App is damaged' warning appears, run:"
echo "      sudo xattr -rd com.apple.quarantine /Applications/Nevax.app"
echo ""
