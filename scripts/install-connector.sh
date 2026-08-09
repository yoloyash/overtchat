#!/bin/sh
set -eu

repository="yoloyash/overtchat"
connector_version="0.1.0"
server=""
pair_code=""
connector_name=""

usage() {
  echo "Usage: install-connector.sh --server URL --pair-code CODE [--name NAME]" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --pair-code)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      pair_code=$2
      shift 2
      ;;
    --server)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      server=$2
      shift 2
      ;;
    --name)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      connector_name=$2
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

[ -n "$server" ] && [ -n "$pair_code" ] || { usage; exit 2; }
[ "$(uname -s)" = "Linux" ] || {
  echo "The OvertChat Host Connector currently supports Linux." >&2
  exit 1
}

case "$(uname -m)" in
  x86_64|amd64) architecture="amd64" ;;
  aarch64|arm64) architecture="arm64" ;;
  *)
    echo "Unsupported CPU architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

for command in curl sha256sum install systemctl; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command not found: $command" >&2
    exit 1
  }
done

asset="overtchat-connector-linux-$architecture"
release_url="https://github.com/$repository/releases/download/connector-v$connector_version"
temporary_directory=$(mktemp -d)
trap 'rm -rf "$temporary_directory"' EXIT HUP INT TERM

curl --proto '=https' --tlsv1.2 -fsSLo "$temporary_directory/$asset" \
  "$release_url/$asset"
curl --proto '=https' --tlsv1.2 -fsSLo "$temporary_directory/checksums.txt" \
  "$release_url/connector-checksums.txt"

expected=$(
  awk -v asset="$asset" '$2 == asset || $2 == "*" asset { print $1; exit }' \
    "$temporary_directory/checksums.txt"
)
[ -n "$expected" ] || {
  echo "The release checksum for $asset is missing." >&2
  exit 1
}
actual=$(sha256sum "$temporary_directory/$asset" | awk '{ print $1 }')
[ "$actual" = "$expected" ] || {
  echo "The Host Connector download failed checksum verification." >&2
  exit 1
}

install_directory="${HOME:?}/.local/bin"
install_path="$install_directory/overtchat-connector"
mkdir -p "$install_directory"
install -m 0755 "$temporary_directory/$asset" "$install_path"

if [ -n "$connector_name" ]; then
  "$install_path" install \
    --server "$server" \
    --pair-code "$pair_code" \
    --name "$connector_name"
else
  "$install_path" install \
    --server "$server" \
    --pair-code "$pair_code"
fi

if command -v loginctl >/dev/null 2>&1; then
  linger=$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)
  if [ "$linger" != "yes" ] && ! loginctl enable-linger "$(id -un)" >/dev/null 2>&1; then
    echo "Warning: enable user lingering to keep the connector running after logout:" >&2
    echo "  sudo loginctl enable-linger $(id -un)" >&2
  fi
fi

echo "OvertChat Host Connector installed."
