#!/bin/sh
set -eu

repository="yoloyash/overtchat"
connector_version="0.3.1"
server=""
pair_code=""
connector_name=""
upgrade="false"

usage() {
  echo "Usage:" >&2
  echo "  install-connector.sh --server URL --pair-code CODE [--name NAME]" >&2
  echo "  install-connector.sh --upgrade" >&2
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
    --upgrade)
      upgrade="true"
      shift
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [ "$upgrade" = "true" ]; then
  [ -z "$server" ] && [ -z "$pair_code" ] && [ -z "$connector_name" ] || {
    usage
    exit 2
  }
else
  [ -n "$server" ] && [ -n "$pair_code" ] || { usage; exit 2; }
fi
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

for command in awk cp curl sed sha256sum install systemctl; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command not found: $command" >&2
    exit 1
  }
done

wait_for_stable_service() {
  attempts=0
  active_streak=0
  while [ "$attempts" -lt 15 ]; do
    attempts=$((attempts + 1))
    if systemctl --user is-active --quiet overtchat-connector.service; then
      active_streak=$((active_streak + 1))
      if [ "$active_streak" -ge 3 ]; then
        return 0
      fi
    else
      active_streak=0
    fi
    [ "$attempts" -ge 15 ] || sleep 1
  done
  return 1
}

wait_for_stopped_service() {
  attempts=0
  while [ "$attempts" -lt 15 ]; do
    if ! systemctl --user is-active --quiet overtchat-connector.service; then
      return 0
    fi
    attempts=$((attempts + 1))
    [ "$attempts" -ge 15 ] || sleep 1
  done
  return 1
}

if [ "$upgrade" = "true" ]; then
  unit_definition=$(systemctl --user cat overtchat-connector.service 2>/dev/null) || {
    echo "The existing overtchat-connector.service user service was not found." >&2
    echo "Set up the connector from OvertChat Settings -> Connections first." >&2
    exit 1
  }
  expected_exec_start="ExecStart=\"${HOME:?}/.local/bin/overtchat-connector\" \"run\""
  unit_exec_start=$(printf '%s\n' "$unit_definition" | sed -n '/^[[:space:]]*ExecStart=/p')
  [ "$unit_exec_start" = "$expected_exec_start" ] || {
    echo "The connector service does not use the installer-managed Host Connector command." >&2
    echo "Back up custom service state manually before upgrading." >&2
    exit 1
  }
  effective_exec_start=$(
    systemctl --user show overtchat-connector.service \
      --property=ExecStart --value
  ) || {
    echo "Unable to inspect the connector service command." >&2
    exit 1
  }
  case "$effective_exec_start" in
    "{ path=${HOME:?}/.local/bin/overtchat-connector ; argv[]=${HOME:?}/.local/bin/overtchat-connector run ; "*) ;;
    *)
      echo "The connector service's effective command is not installer-managed." >&2
      echo "Back up custom service state manually before upgrading." >&2
      exit 1
      ;;
  esac
  case "$unit_definition" in
    *Environment=*|*EnvironmentFile=*)
      echo "The connector service has a custom environment that this upgrader cannot safely inspect." >&2
      echo "Back up custom service state manually before upgrading." >&2
      exit 1
      ;;
  esac
  service_manager_environment=$(systemctl --user show-environment) || {
    echo "Unable to inspect the systemd user service environment." >&2
    exit 1
  }
  case "$service_manager_environment" in
    *OVERTCHAT_CONNECTOR_CONFIG=*|*OVERTCHAT_CONNECTOR_STATE=*|*OVERTCHAT_CONNECTOR_TIMELINES=*|*OVERTCHAT_CONNECTOR_LOCK=*)
      echo "The systemd user manager has custom Host Connector paths." >&2
      echo "Back up those custom paths manually before upgrading." >&2
      exit 1
      ;;
  esac
  [ "${OVERTCHAT_CONNECTOR_CONFIG+x}" != "x" ] &&
    [ "${OVERTCHAT_CONNECTOR_STATE+x}" != "x" ] &&
    [ "${OVERTCHAT_CONNECTOR_TIMELINES+x}" != "x" ] &&
    [ "${OVERTCHAT_CONNECTOR_LOCK+x}" != "x" ] || {
      echo "Remove local OVERTCHAT_CONNECTOR_* path overrides before upgrading." >&2
      exit 1
    }

  connector_config="${HOME:?}/.config/overtchat/connector.json"
  [ -f "$connector_config" ] || {
    echo "No existing Host Connector pairing was found at $connector_config." >&2
    echo "Set up the connector from OvertChat Settings -> Connections first." >&2
    exit 1
  }

  connector_id=$(
    sed -n 's/.*"connectorId"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9_-][A-Za-z0-9_-]*\)".*/\1/p' \
      "$connector_config"
  )
  case "$connector_id" in
    ""|*[!A-Za-z0-9_-]*)
      echo "Unable to read a safe connectorId from $connector_config." >&2
      exit 1
      ;;
  esac
  [ "${#connector_id}" -le 128 ] || {
    echo "The connectorId in $connector_config is too long." >&2
    exit 1
  }

  connector_state="${HOME:?}/.config/overtchat/connector-$connector_id.state.json"
fi

asset="overtchat-connector-linux-$architecture"
release_url="https://github.com/$repository/releases/download/connector-v$connector_version"
temporary_directory=$(mktemp -d)
staged_install_path=""
previous_stage_path=""
state_stage_path=""
upgrade_transaction_active="false"
upgrade_had_state="false"
upgrade_service_stopped="false"
binary_backup_ready="false"
binary_may_have_changed="false"
state_backup_ready="false"
state_may_have_changed="false"

rollback_upgrade() {
  [ "$upgrade_transaction_active" = "true" ] || return 0
  upgrade_transaction_active="false"
  trap '' HUP INT TERM
  if [ "$state_may_have_changed" = "true" ] ||
    [ "$binary_may_have_changed" = "true" ]; then
    systemctl --user stop overtchat-connector.service >/dev/null 2>&1 &&
      wait_for_stopped_service || return 1
  fi
  if [ "$state_may_have_changed" = "true" ]; then
    if [ "$upgrade_had_state" = "true" ] &&
      [ "$state_backup_ready" = "true" ]; then
      mv -f "$state_backup_path" "$connector_state" || return 1
    elif [ "$upgrade_had_state" = "false" ]; then
      rm -f "$connector_state" || return 1
    else
      return 1
    fi
  elif [ "$state_backup_ready" = "true" ]; then
    rm -f "$state_backup_path" || return 1
  fi
  if [ "$binary_may_have_changed" = "true" ]; then
    if [ "$binary_backup_ready" = "true" ]; then
      mv -f "$previous_path" "$install_path" || return 1
    else
      return 1
    fi
  elif [ "$binary_backup_ready" = "true" ]; then
    rm -f "$previous_path" || return 1
  fi
  if [ "$upgrade_service_stopped" = "true" ] &&
    systemctl --user start overtchat-connector.service &&
    wait_for_stable_service; then
    upgrade_service_stopped="false"
    return 0
  fi
  return 1
}

cleanup() {
  if [ "$upgrade_transaction_active" = "true" ]; then
    rollback_upgrade ||
      echo "Rollback did not return the previous Host Connector to a stable running state." >&2
  fi
  rm -rf "$temporary_directory"
  [ -z "$staged_install_path" ] || rm -f "$staged_install_path"
  [ -z "$previous_stage_path" ] || rm -f "$previous_stage_path"
  [ -z "$state_stage_path" ] || rm -f "$state_stage_path"
}

trap cleanup EXIT
trap 'exit 1' HUP INT TERM

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

if [ "$upgrade" = "true" ]; then
  previous_path="$install_path.previous"
  state_backup_path="$connector_state.previous"
  had_state="false"

  [ -f "$install_path" ] || {
    echo "The existing Host Connector binary was not found at $install_path." >&2
    exit 1
  }
  [ ! -e "$previous_path" ] || {
    echo "A Host Connector binary rollback file already exists at $previous_path." >&2
    echo "Move it aside after checking whether it came from an interrupted upgrade." >&2
    exit 1
  }
  [ ! -e "$connector_state" ] || [ -f "$connector_state" ] || {
    echo "The Host Connector state path is not a regular file: $connector_state" >&2
    exit 1
  }
  [ ! -e "$state_backup_path" ] || {
    echo "A Host Connector state rollback file already exists at $state_backup_path." >&2
    echo "Move it aside after checking whether it contains state from an interrupted upgrade." >&2
    exit 1
  }

  staged_install_path=$(mktemp "$install_directory/.overtchat-connector.new.XXXXXX")
  install -m 0755 "$temporary_directory/$asset" "$staged_install_path"
  staged_actual=$(sha256sum "$staged_install_path" | awk '{ print $1 }')
  [ "$staged_actual" = "$expected" ] || {
    echo "The staged Host Connector failed checksum verification." >&2
    exit 1
  }

  upgrade_service_stopped="true"
  upgrade_transaction_active="true"
  if ! systemctl --user stop overtchat-connector.service; then
    echo "Unable to stop the existing Host Connector safely; nothing was upgraded." >&2
    exit 1
  fi
  wait_for_stopped_service || {
    echo "The existing Host Connector did not stop; nothing was upgraded." >&2
    exit 1
  }

  previous_stage_path=$(
    mktemp "$install_directory/.overtchat-connector.previous.XXXXXX"
  ) || {
    echo "Unable to stage the existing Host Connector binary for rollback." >&2
    exit 1
  }
  if ! cp -p "$install_path" "$previous_stage_path" ||
    ! mv -f "$previous_stage_path" "$previous_path"; then
    echo "Unable to back up the existing Host Connector binary; nothing was upgraded." >&2
    exit 1
  fi
  previous_stage_path=""
  binary_backup_ready="true"

  if [ -f "$connector_state" ]; then
    state_stage_path=$(mktemp "$connector_state.previous.XXXXXX") || {
      echo "Unable to stage the Host Connector state for rollback." >&2
      exit 1
    }
    if ! cp -p "$connector_state" "$state_stage_path" ||
      ! mv -f "$state_stage_path" "$state_backup_path"; then
      echo "Unable to back up the Host Connector state; nothing was upgraded." >&2
      exit 1
    fi
    state_stage_path=""
    had_state="true"
    state_backup_ready="true"
  fi
  upgrade_had_state=$had_state

  state_may_have_changed="true"
  if ! "$staged_install_path" preflight; then
    echo "The new Host Connector could not safely open the existing pairing and state." >&2
    if rollback_upgrade; then
      echo "The previous Host Connector and its state were restored and restarted." >&2
    else
      echo "Rollback did not return the previous Host Connector to a stable running state." >&2
    fi
    exit 1
  fi

  # Both paths are in install_directory, so promotion is one atomic rename.
  binary_may_have_changed="true"
  if ! mv -f "$staged_install_path" "$install_path"; then
    echo "Unable to promote the new Host Connector binary." >&2
    exit 1
  fi
  staged_install_path=""

  start_succeeded="false"
  if systemctl --user start overtchat-connector.service; then
    start_succeeded="true"
  fi

  service_active="false"
  if [ "$start_succeeded" = "true" ] && wait_for_stable_service; then
    service_active="true"
  fi

  if [ "$service_active" = "true" ]; then
    upgrade_transaction_active="false"
    rm -f "$previous_path"
    [ "$had_state" = "false" ] || rm -f "$state_backup_path"
    echo "OvertChat Host Connector upgraded to $connector_version. The existing pairing was preserved."
  else
    echo "The upgraded Host Connector did not start." >&2
    if rollback_upgrade; then
      echo "The previous Host Connector and its state were restored and restarted." >&2
    else
      echo "Rollback did not return the previous Host Connector to a stable running state." >&2
    fi
    exit 1
  fi
elif [ -n "$connector_name" ]; then
  install -m 0755 "$temporary_directory/$asset" "$install_path"
  "$install_path" install \
    --server "$server" \
    --pair-code "$pair_code" \
    --name "$connector_name"
else
  install -m 0755 "$temporary_directory/$asset" "$install_path"
  "$install_path" install \
    --server "$server" \
    --pair-code "$pair_code"
fi

if [ "$upgrade" = "false" ] && command -v loginctl >/dev/null 2>&1; then
  linger=$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)
  if [ "$linger" != "yes" ] && ! loginctl enable-linger "$(id -un)" >/dev/null 2>&1; then
    echo "Warning: enable user lingering to keep the connector running after logout:" >&2
    echo "  sudo loginctl enable-linger $(id -un)" >&2
  fi
fi

if [ "$upgrade" = "false" ]; then
  echo "OvertChat Host Connector installed."
fi
