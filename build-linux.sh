#!/bin/sh
# Package the Linux build: dist/assetto-launcher-linux_x64.tar.gz holding the
# Neutralino binary and resources.neu. Portable: unpack anywhere and run
# ./assetto-launcher-linux_x64 (the launcher's settings are kept next to it).
cd "$(dirname "$0")" || exit 1
[ -x bin/neutralino-linux_x64 ] || npx -y @neutralinojs/neu@11 update || exit 1
npx -y @neutralinojs/neu@11 build --release || exit 1
chmod +x dist/assetto-launcher/assetto-launcher-linux_x64
rm -f dist/assetto-launcher-linux_x64.tar.gz
tar -czf dist/assetto-launcher-linux_x64.tar.gz -C dist \
  assetto-launcher/assetto-launcher-linux_x64 assetto-launcher/resources.neu || exit 1
echo "Built dist/assetto-launcher-linux_x64.tar.gz"
