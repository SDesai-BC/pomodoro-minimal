#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Minimal Pomodoro"
BUNDLE_DIR="$ROOT_DIR/dist/$APP_NAME.app"
CONTENTS_DIR="$BUNDLE_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
WEB_RES_DIR="$RESOURCES_DIR/web"
ICONSET_DIR="$ROOT_DIR/dist/AppIcon.iconset"
WEB_ICONS_DIR="$ROOT_DIR/icons"

echo "1. Generating app icons (PWA + macOS .icns)..."
mkdir -p "$WEB_ICONS_DIR" "$ICONSET_DIR" "$MACOS_DIR" "$WEB_RES_DIR/src" "$WEB_RES_DIR/icons"
swift "$ROOT_DIR/macos/GenerateIcons.swift" "$WEB_ICONS_DIR" "$ICONSET_DIR"
iconutil -c icns "$ICONSET_DIR" -o "$RESOURCES_DIR/AppIcon.icns"
rm -rf "$ICONSET_DIR"

echo "2. Bundling web assets into $APP_NAME.app..."
cp "$ROOT_DIR/index.html" "$WEB_RES_DIR/"
cp "$ROOT_DIR/styles.css" "$WEB_RES_DIR/"
cp "$ROOT_DIR/manifest.webmanifest" "$WEB_RES_DIR/"
cp "$ROOT_DIR/src/"*.js "$WEB_RES_DIR/src/"
cp "$WEB_ICONS_DIR/"*.png "$WEB_RES_DIR/icons/"

cat > "$CONTENTS_DIR/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Minimal Pomodoro</string>
  <key>CFBundleExecutable</key>
  <string>MinimalPomodoro</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>com.pomodoro.minimal</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Minimal Pomodoro</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSUserNotificationAlertStyle</key>
  <string>alert</string>
</dict>
</plist>
EOF

echo "3. Compiling native macOS binary (Swift + WKWebView + UserNotifications)..."
swiftc -O \
  "$ROOT_DIR/macos/PomodoroApp.swift" \
  -o "$MACOS_DIR/MinimalPomodoro" \
  -framework Cocoa \
  -framework WebKit \
  -framework UserNotifications

echo "4. Signing macOS application bundle..."
codesign --force --deep --sign - "$BUNDLE_DIR"

echo "5. Installing to Applications..."
if [ -w "/Applications" ]; then
  rm -rf "/Applications/$APP_NAME.app"
  cp -R "$BUNDLE_DIR" "/Applications/$APP_NAME.app"
  echo "Installed to /Applications/$APP_NAME.app"
else
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/$APP_NAME.app"
  cp -R "$BUNDLE_DIR" "$HOME/Applications/$APP_NAME.app"
  echo "Installed to $HOME/Applications/$APP_NAME.app"
fi

echo "Done! Built at: $BUNDLE_DIR"
