#!/usr/bin/env python3
"""Add one private item to Margin using its add-only submission token."""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def connection():
    raw = os.environ.get("MARGIN_URL", "").strip()
    token = os.environ.get("MARGIN_SUBMISSION_TOKEN", "").strip()
    try:
        url = urllib.parse.urlsplit(raw)
        local = url.hostname in {"localhost", "127.0.0.1", "::1"}
        valid = (url.scheme == "https" or url.scheme == "http" and local) and url.hostname and url.port != 0
        if not valid or url.username or url.password or url.query or url.fragment or url.path not in {"", "/"}:
            raise ValueError()
    except ValueError:
        raise ValueError("Set MARGIN_URL to your Margin site address (HTTPS, or HTTP on localhost), without /dashboard.") from None
    if not token or any(ord(c) < 33 or ord(c) > 126 for c in token):
        raise ValueError("Set MARGIN_SUBMISSION_TOKEN locally using the submission token from Margin Settings → Telegram & Hermes.")
    return raw.rstrip("/") + "/api/integrations/items", token


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", help="One URL or book/media title")
    parser.add_argument("--title", help="Explicit title when saving a URL")
    parser.add_argument("--author")
    parser.add_argument("--kind", choices=["book", "article", "paper", "video", "movie", "anime", "manga", "game", "other"])
    parser.add_argument("--tag", action="append", default=[])
    parser.add_argument("--note")
    parser.add_argument("--check-config", action="store_true", help="Validate local configuration without making a request")
    args = parser.parse_args(argv)
    try:
        endpoint, token = connection()
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    if args.check_config:
        print("Margin configuration is present. No request sent; connectivity and token validity are not yet verified.")
        return 0
    if not args.source or not args.source.strip():
        parser.error("provide a URL or title")
    source = args.source.strip()
    payload = {"url": source} if source.lower().startswith(("https://", "http://")) else {"title": source}
    for key, value in [("title", args.title), ("author", args.author), ("kind", args.kind), ("tags", args.tag), ("notes", args.note)]:
        if value:
            payload[key] = value
    request = urllib.request.Request(endpoint, data=json.dumps(payload).encode(), headers={
        "Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json",
    }, method="POST")
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=40) as response:
            if response.status not in {200, 201}:
                raise ValueError()
            receipt = json.loads(response.read(4097))
            if not isinstance(receipt, dict) or not isinstance(receipt.get("id"), str) or not receipt["id"] or not isinstance(receipt.get("created"), bool):
                raise ValueError()
    except urllib.error.HTTPError as error:
        message = "Check the submission token and Margin address." if error.code in {401, 403} else "Check Margin and the submitted details. Redirects are refused."
        print(f"Margin returned HTTP {error.code}. {message}", file=sys.stderr)
        return 1
    except (urllib.error.URLError, TimeoutError, OSError):
        print("Could not confirm the save. Check connectivity and Margin before retrying; the item may already have been saved.", file=sys.stderr)
        return 1
    except (ValueError, UnicodeError):
        print("Margin returned an unexpected receipt. Check the library before retrying.", file=sys.stderr)
        return 1
    print(json.dumps({"id": receipt["id"], "created": receipt["created"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
