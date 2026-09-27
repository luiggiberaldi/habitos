#!/usr/bin/env python3
"""Despliega una Edge Function vía Management API (multipart/form-data).

Uso:
    deploy-function.py <project-ref> <slug> <dir-funcion> [--verify-jwt true|false]

Sigue el patrón de mgmt.py (surrogate custom.supabase-mgmt vía authd).
Valida la convención documentada en references/edge-functions.md.
"""
import json
import mimetypes
import os
import sys
import urllib.request

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request  # noqa: E402

CRED = "custom.supabase-mgmt"
HOSTS = ("api.supabase.com",)
BASE = "https://api.supabase.com"
BOUNDARY = "----habitos-deploy-boundary"


def part_headers(name: str, filename: str | None = None) -> bytes:
    h = f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="{name}"'
    if filename:
        ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        h += f'; filename="{filename}"\r\nContent-Type: {ctype}'
    else:
        h += "\r\nContent-Type: application/json"
    return (h + "\r\n\r\n").encode()


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__, file=sys.stderr)
        return 2
    ref, slug, fundir = sys.argv[1], sys.argv[2], sys.argv[3]
    verify_jwt = True
    for i, a in enumerate(sys.argv[4:], 4):
        if a == "--verify-jwt":
            verify_jwt = sys.argv[i + 1].lower() == "true"

    body = b""
    metadata = {"entrypoint_path": "index.ts", "name": slug, "verify_jwt": verify_jwt}
    body += part_headers("metadata") + json.dumps(metadata).encode() + b"\r\n"
    for fname in sorted(os.listdir(fundir)):
        fpath = os.path.join(fundir, fname)
        if not os.path.isfile(fpath):
            continue
        with open(fpath, "rb") as f:
            body += part_headers("file", fname) + f.read() + b"\r\n"
    body += f"--{BOUNDARY}--\r\n".encode()

    url = f"{BASE}/v1/projects/{ref}/functions/deploy?slug={slug}"
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={BOUNDARY}")
    add_surrogate_to_request(req, CRED, allowed_hosts=HOSTS)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            print(resp.status, resp.read().decode()[:500])
            return 0
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:500]}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
