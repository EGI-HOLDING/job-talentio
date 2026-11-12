import os
import signal
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

MAX_INPUT = 5 * 1024 * 1024
MAX_OUTPUT = 20 * 1024 * 1024

# High macro security and no link updates for untrusted office files.
PROFILE = b'''<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>
  </item>
  <item oor:path="/org.openoffice.Office.Writer/Content/Update">
    <prop oor:name="Link" oor:op="fuse"><value>0</value></prop>
  </item>
</oor:items>
'''


def render(raw, extension):
    with tempfile.TemporaryDirectory(prefix="taka-cv-", dir="/tmp") as directory:
        root = Path(directory)
        source = root / ("input." + extension)
        profile = root / "profile"
        (profile / "user").mkdir(parents=True)
        (profile / "user" / "registrymodifications.xcu").write_bytes(PROFILE)
        source.write_bytes(raw)
        process = subprocess.Popen(
            ["soffice", "-env:UserInstallation=" + profile.as_uri(), "--headless",
             "--nologo", "--nodefault", "--norestore", "--convert-to", "pdf:writer_pdf_Export",
             "--outdir", directory, str(source)],
            cwd=directory, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, start_new_session=True,
        )
        try:
            if process.wait(timeout=25):
                return None
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            return None
        pdf = root / "input.pdf"
        if not pdf.is_file() or pdf.stat().st_size > MAX_OUTPUT:
            return None
        result = pdf.read_bytes()
        return result if result.startswith(b"%PDF-") else None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        self.connection.settimeout(8)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            extension = self.headers.get("X-Document-Format")
            if self.path != "/render" or not (0 < length <= MAX_INPUT) or extension not in ("doc", "docx"):
                return self.send_error(400)
            raw = self.rfile.read(length)
            signature = b"PK\x03\x04" if extension == "docx" else b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
            if len(raw) != length or not raw.startswith(signature):
                return self.send_error(400)
            pdf = render(raw, extension)
            if pdf is None:
                return self.send_error(422)
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(len(pdf)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(pdf)
        except (ValueError, OSError):
            self.close_connection = True


HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
