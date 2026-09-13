#!/usr/bin/env python3
"""Check generated redirects for historical Search Console URLs, offline."""
from functools import partial
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.request import urlopen
import sys

PREFIX = '/ctf-writeups-2021/ctf-writeups-2022/'
ROUTES = {
    PREFIX + 'ctf2022/sdctf/tasty_crypto_roll/2022-05-10-SDCTF-Tasty-Crypto-Roll':
        '/WriteUps/2022/sdctf/crypto/tasty_crypto_roll/2022-05-10-SDCTF-2022-Tasty-Crypto-Roll.html',
    PREFIX + 'archive': '/WriteUps/archive.html',
}

class Tags(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.tags = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


def main():
    root = Path(sys.argv[1]).resolve()
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    try:
        for old, target in ROUTES.items():
            for suffix in ('', '/'):
                with urlopen(origin + old + suffix) as response:
                    assert response.status == 200
                    tags = Tags(response.read().decode()).tags
                assert ('meta', {'http-equiv': 'refresh', 'content': '0; url=' + target}) in tags
                assert any(t == 'link' and a.get('rel') == 'canonical' and a.get('href') == 'https://deut-erium.github.io' + target for t, a in tags)
                assert any(t == 'meta' and a.get('name') == 'robots' and 'noindex' in a.get('content', '') for t, a in tags)
                assert any(t == 'a' and a.get('href') == target for t, a in tags)
            with urlopen(origin + target) as response:
                assert response.status == 200
                assert 'http-equiv="refresh"' not in response.read().decode()
            assert old + '/' not in (root / 'sitemap.xml').read_text()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    print('Historical redirects: two routes, slash/extensionless access, canonical targets and sitemap exclusion passed.')


if __name__ == '__main__':
    main()
