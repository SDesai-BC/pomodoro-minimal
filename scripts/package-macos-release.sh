#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Minimal Pomodoro"
VERSION="1.0.0"
BUNDLE_ID="com.pomodoro.minimal"
APP_BUNDLE="$ROOT_DIR/dist/$APP_NAME.app"
RELEASE_DIR="$ROOT_DIR/dist/release"

DMG_NAME="Minimal-Pomodoro-$VERSION.dmg"
PKG_NAME="Minimal-Pomodoro-$VERSION.pkg"
ZIP_NAME="Minimal-Pomodoro-$VERSION-macOS.zip"

echo "==> Step 1: Building Universal macOS App Bundle..."
SKIP_INSTALL=1 zsh "$ROOT_DIR/scripts/build-macos-app.sh"

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

echo "==> Step 2: Creating Drag-and-Drop Disk Image ($DMG_NAME)..."
DMG_STAGE="$ROOT_DIR/dist/dmg-stage"
rm -rf "$DMG_STAGE"
mkdir -p "$DMG_STAGE"
cp -R "$APP_BUNDLE" "$DMG_STAGE/$APP_NAME.app"
ln -s /Applications "$DMG_STAGE/Applications"

hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$DMG_STAGE" \
  -ov \
  -format UDZO \
  "$RELEASE_DIR/$DMG_NAME" >/dev/null 2>&1
rm -rf "$DMG_STAGE"

echo "==> Step 3: Creating Native macOS Installer Package ($PKG_NAME)..."
PKG_STAGE="$ROOT_DIR/dist/pkg-stage"
PKG_ROOT="$PKG_STAGE/root"
PKG_SCRIPTS="$ROOT_DIR/dist/pkg-scripts"
rm -rf "$PKG_STAGE" "$PKG_SCRIPTS"
mkdir -p "$PKG_ROOT" "$PKG_SCRIPTS"

cp -R "$APP_BUNDLE" "$PKG_ROOT/$APP_NAME.app"

cat > "$PKG_SCRIPTS/postinstall" << 'EOF'
#!/bin/sh
if [ -d "/Applications/Minimal Pomodoro.app" ]; then
  /usr/bin/xattr -cr "/Applications/Minimal Pomodoro.app" 2>/dev/null || true
fi
exit 0
EOF
chmod +x "$PKG_SCRIPTS/postinstall"

pkgbuild --analyze --root "$PKG_ROOT" "$PKG_STAGE/component.plist" >/dev/null 2>&1
plutil -replace 0.BundleIsRelocatable -bool NO "$PKG_STAGE/component.plist"

pkgbuild \
  --root "$PKG_ROOT" \
  --component-plist "$PKG_STAGE/component.plist" \
  --install-location "/Applications" \
  --scripts "$PKG_SCRIPTS" \
  --identifier "$BUNDLE_ID.pkg" \
  --version "$VERSION" \
  "$PKG_STAGE/component.pkg" >/dev/null 2>&1

productbuild \
  --package "$PKG_STAGE/component.pkg" \
  --identifier "$BUNDLE_ID.installer" \
  --version "$VERSION" \
  "$RELEASE_DIR/$PKG_NAME" >/dev/null 2>&1

rm -rf "$PKG_STAGE" "$PKG_SCRIPTS"

echo "==> Step 4: Creating Signed Archive ($ZIP_NAME) with ditto..."
ditto -c -k --sequesterRsrc --keepParent "$APP_BUNDLE" "$RELEASE_DIR/$ZIP_NAME"

echo "==> Step 5: Generating SHA-256 Checksums..."
(
  cd "$RELEASE_DIR"
  shasum -a 256 "$DMG_NAME" "$PKG_NAME" "$ZIP_NAME" > SHA256SUMS.txt
)

echo ""
echo "Release artifacts generated in $RELEASE_DIR:"
ls -lh "$RELEASE_DIR"
echo ""
cat "$RELEASE_DIR/SHA256SUMS.txt"
