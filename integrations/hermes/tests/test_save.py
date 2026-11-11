import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("margin_save", Path(__file__).parents[1] / "margin-save/scripts/save.py")
save = importlib.util.module_from_spec(spec)
spec.loader.exec_module(save)


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.redirect = False
        self.status = 201
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                owner.requests.append((self.path, self.headers.get("Authorization"), json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
                if owner.redirect:
                    self.send_response(307)
                    self.send_header("Location", "/must-not-receive-token")
                else:
                    self.send_response(owner.status)
                self.end_headers()
                self.wfile.write(json.dumps({"id": "synthetic-item", "created": owner.status == 201}).encode())
            def log_message(self, *_):
                pass
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.env = patch.dict(os.environ, {"MARGIN_URL": f"http://127.0.0.1:{self.server.server_port}", "MARGIN_SUBMISSION_TOKEN": "synthetic-test-token"})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def run_save(self, args):
        output, error = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(error):
            code = save.main(args)
        self.assertNotIn("synthetic-test-token", output.getvalue() + error.getvalue())
        return code, output.getvalue(), error.getvalue()

    def test_title_and_explicit_details_are_private_submission_payload(self):
        code, out, _ = self.run_save(["A book", "--kind", "book", "--author", "A writer", "--tag", "Design", "--tag", "Code"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out), {"id": "synthetic-item", "created": True})
        self.assertEqual(self.requests, [("/api/integrations/items", "Bearer synthetic-test-token", {"title": "A book", "kind": "book", "author": "A writer", "tags": ["Design", "Code"]})])

    def test_url_duplicate_receipt(self):
        self.status = 200
        code, out, _ = self.run_save(["https://example.com/?a=1&b=2"])
        self.assertEqual(code, 0)
        self.assertFalse(json.loads(out)["created"])
        self.assertEqual(self.requests[0][2], {"url": "https://example.com/?a=1&b=2"})

    def test_redirect_never_replays_credentials(self):
        self.redirect = True
        code, _, _ = self.run_save(["A book"])
        self.assertEqual(code, 1)
        self.assertEqual(len(self.requests), 1)

    def test_config_check_does_not_submit(self):
        self.assertEqual(self.run_save(["--check-config"])[0], 0)
        self.assertEqual(self.requests, [])

    def test_invalid_connection_and_missing_token_do_not_submit(self):
        for url in ["http://remote.example", "https://user:pass@margin.example", "https://margin.example/dashboard", "https://margin.example/?secret=bad", "https://margin.example:bad"]:
            with patch.dict(os.environ, {"MARGIN_URL": url}):
                self.assertEqual(self.run_save(["A book"])[0], 2)
        with patch.dict(os.environ, {"MARGIN_SUBMISSION_TOKEN": ""}):
            self.assertEqual(self.run_save(["A book"])[0], 2)
        self.assertEqual(self.requests, [])

    def test_auth_failure_stops_without_retry(self):
        self.status = 401
        code, _, error = self.run_save(["A book"])
        self.assertEqual(code, 1)
        self.assertIn("submission token", error)
        self.assertEqual(len(self.requests), 1)


if __name__ == "__main__":
    unittest.main()
