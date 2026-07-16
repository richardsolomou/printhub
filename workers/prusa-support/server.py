import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

MAX_BODY_BYTES = int(os.environ.get("MAX_BODY_BYTES", str(512 * 1024 * 1024)))
PROCESS_TIMEOUT_SECONDS = int(os.environ.get("PROCESS_TIMEOUT_SECONDS", "1200"))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def do_POST(self):
        if self.path != "/supports":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(400, "invalid content length")
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_error(413, "project is too large")
            return

        with tempfile.TemporaryDirectory(prefix="printhub-support-") as directory:
            input_path = os.path.join(directory, "input.3mf")
            output_path = os.path.join(directory, "supports.stl")
            with open(input_path, "wb") as project:
                project.write(self.rfile.read(length))
            try:
                result = subprocess.run(
                    ["/usr/local/bin/printhub-support", input_path, output_path],
                    capture_output=True,
                    check=False,
                    timeout=PROCESS_TIMEOUT_SECONDS,
                )
            except subprocess.TimeoutExpired:
                self.send_error(504, "support generation timed out")
                return
            if result.returncode != 0:
                message = result.stderr.decode("utf-8", errors="replace").strip()[-4000:]
                self.send_error(422, message or "support generation failed")
                return
            try:
                elevation = float(result.stdout.decode("utf-8", errors="replace").strip().splitlines()[-1])
            except (ValueError, IndexError):
                self.send_error(502, "worker returned invalid elevation metadata")
                return
            with open(output_path, "rb") as support_file:
                output = support_file.read()

        self.send_response(200)
        self.send_header("Content-Type", "model/stl")
        self.send_header("Content-Length", str(len(output)))
        self.send_header("X-Model-Elevation", str(elevation))
        self.end_headers()
        self.wfile.write(output)

    def log_message(self, format, *args):
        print(f"{self.address_string()} {format % args}", flush=True)


HTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()
