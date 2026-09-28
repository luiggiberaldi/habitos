#!/usr/bin/env bash
# Respaldo de la carpeta de Senda (~/workspace/habitos) a Google Drive.
# - Genera un zip sin node_modules/.next/.git/.cache/.vercel
# - Solo sube si el contenido cambio desde el ultimo respaldo (hash sha256)
# - La primera vez crea el archivo en la carpeta "Respaldos Senda"; despues lo actualiza (mismo id y enlace)
# Uso: respaldo-senda-drive.sh [--forzar]
set -euo pipefail

REPO="$HOME/workspace/habitos"
WORK="$HOME/.respaldo-senda"
ESTADO="$WORK/estado.json"
ZIP="$WORK/senda-respaldo.zip"
NOMBRE="senda-respaldo.zip"
FORZAR=0
[ "${1:-}" = "--forzar" ] && FORZAR=1

mkdir -p "$WORK"
command -v zip >/dev/null || { echo "ERR: falta zip" >&2; exit 1; }
command -v hatch_gws_cli >/dev/null || { echo "ERR: falta hatch_gws_cli" >&2; exit 1; }

rm -f "$ZIP"
cd "$REPO"
zip -qr "$ZIP" . -x 'node_modules/*' '.next/*' '.git/*' '.cache/*' '.vercel/*' >/dev/null
HASH="$(sha256sum "$ZIP" | awk '{print $1}')"
TAMANO="$(du -h "$ZIP" | cut -f1)"

CARPETA_ID=""
ARCHIVO_ID=""
ULTIMO_HASH=""
[ -f "$ESTADO" ] && {
  CARPETA_ID="$(python3 -c "import json;print(json.load(open('$ESTADO')).get('carpeta_id',''))" 2>/dev/null || true)"
  ARCHIVO_ID="$(python3 -c "import json;print(json.load(open('$ESTADO')).get('archivo_id',''))" 2>/dev/null || true)"
  ULTIMO_HASH="$(python3 -c "import json;print(json.load(open('$ESTADO')).get('hash',''))" 2>/dev/null || true)"
}

# Carpeta "Respaldos Senda" (crear si falta)
if [ -z "$CARPETA_ID" ]; then
  CARPETA_ID="$(hatch_gws_cli drive files list --params '{"q":"name = '\''Respaldos Senda'\'' and mimeType = '\''application/vnd.google-apps.folder'\'' and trashed=false","pageSize":1,"fields":"files(id)"}' --format json 2>/dev/null | python3 -c "import json,sys; f=json.load(sys.stdin).get('files',[]); print(f[0]['id'] if f else '')")"
fi
if [ -z "$CARPETA_ID" ]; then
  CARPETA_ID="$(hatch_gws_cli drive files create --params '{"ignoreDefaultVisibility":true}' --json '{"name":"Respaldos Senda","mimeType":"application/vnd.google-apps.folder","parents":["root"]}' --format json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")"
fi
[ -z "$CARPETA_ID" ] && { echo "ERR: no se pudo resolver la carpeta en Drive" >&2; exit 1; }

# Si no hay cambios y no se fuerza, no subir
if [ "$FORZAR" = "0" ] && [ "$HASH" = "$ULTIMO_HASH" ] && [ -n "$ARCHIVO_ID" ]; then
  echo "{\"ok\":true,\"accion\":\"sin_cambios\",\"hash\":\"$HASH\",\"tamano\":\"$TAMANO\"}"
  exit 0
fi

# Archivo existente (buscar si falta el id)
if [ -z "$ARCHIVO_ID" ]; then
  ARCHIVO_ID="$(hatch_gws_cli drive files list --params "{\"q\":\"name = '$NOMBRE' and '$CARPETA_ID' in parents and trashed=false\",\"pageSize\":1,\"fields\":\"files(id)\"}" --format json 2>/dev/null | python3 -c "import json,sys; f=json.load(sys.stdin).get('files',[]); print(f[0]['id'] if f else '')")"
fi

if [ -n "$ARCHIVO_ID" ]; then
  hatch_gws_cli drive files update --params "{\"fileId\":\"$ARCHIVO_ID\"}" --upload "$ZIP" --format json >/dev/null 2>&1 \
    || { echo "ERR: fallo la actualizacion del respaldo" >&2; exit 1; }
  ACCION="actualizado"
else
  ARCHIVO_ID="$(hatch_gws_cli drive +upload "$ZIP" --parent "$CARPETA_ID" --name "$NOMBRE" --format json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")"
  [ -z "$ARCHIVO_ID" ] && { echo "ERR: fallo la subida del respaldo" >&2; exit 1; }
  ACCION="creado"
fi

python3 - "$ESTADO" "$CARPETA_ID" "$ARCHIVO_ID" "$HASH" <<'PY'
import json,sys
json.dump({"carpeta_id":sys.argv[2],"archivo_id":sys.argv[3],"hash":sys.argv[4]}, open(sys.argv[1],"w"))
PY

echo "{\"ok\":true,\"accion\":\"$ACCION\",\"hash\":\"$HASH\",\"tamano\":\"$TAMANO\"}"
