#!/bin/bash
set -eo pipefail
if [ "$(id -u)" = 0 ]; then
    mkdir -p /data/cfd
    chown 10001:10001 /data/cfd
    exec setpriv --reuid=10001 --regid=10001 --init-groups --no-new-privs "$0" "$@"
fi
echo 'Loading pinned OpenFOAM runtime'
# OpenFOAM's interactive environment script includes optional shell probes
# whose nonzero status is not a runtime failure; check actual binaries below.
set +e
source /usr/lib/openfoam/openfoam2312/etc/bashrc
set -e
command -v simpleFoam >/dev/null
echo 'Starting authenticated CFD service'
export HOME=/home/cfd
exec python -m uvicorn backend.app.openfoam_service:factory --factory --host 0.0.0.0 --port "${PORT:-8080}" --workers 1 --no-proxy-headers
