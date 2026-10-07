#!/bin/sh
# Run the launcher straight from the resources folder (no build step), Linux.
cd "$(dirname "$0")" || exit 1
[ -x bin/neutralino-linux_x64 ] || npx -y @neutralinojs/neu@11 update || exit 1
exec bin/neutralino-linux_x64 --load-dir-res --path=. --window-enable-inspector=true
