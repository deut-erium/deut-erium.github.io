#!/usr/bin/env python3
"""Loopback-only TCP smoke tests for the native challenge service."""
from __future__ import annotations

import json
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "script/challenge_practice"))
SERVER = ROOT / "script/challenge_practice/server.py"
WITNESS = json.loads((ROOT / "agent_out/challenge-runtime/session/chaos-collision.json").read_text())["collision"]
LISTENING = re.compile(r"listening on .*:(\d+) for chaos$")


class TcpServiceTests(unittest.TestCase):
    def start(self, challenge="chaos", *extra):
        process = subprocess.Popen(
            [sys.executable, str(SERVER), challenge, "--port", "0", "--once", *extra],
            cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        line = process.stdout.readline().strip()
        match = re.search(r":(\d+) for " + re.escape(challenge) + r"$", line)
        self.assertIsNotNone(match, line)
        return process, int(match.group(1))

    @staticmethod
    def exchange(port, payload, half_close=True):
        with socket.create_connection(("127.0.0.1", port), timeout=15) as client:
            client.settimeout(15)
            client.sendall(payload)
            if half_close:
                client.shutdown(socket.SHUT_WR)
            chunks = []
            while True:
                data = client.recv(65536)
                if not data:
                    return b"".join(chunks)
                chunks.append(data)

    def finish(self, process):
        stdout, stderr = process.communicate(timeout=15)
        self.assertEqual(process.returncode, 0, stderr)
        self.assertNotIn("session error", stderr)
        return stdout, stderr

    def test_public_chaos_success_over_a_real_socket(self):
        process, port = self.start()
        output = self.exchange(port, f"{WITNESS['first']}\n{WITNESS['second']}\n".encode())
        self.assertIn(b"input first string to hash : ", output)
        self.assertIn(b"practice{local_dummy_reward}", output)
        self.finish(process)

    def test_fresh_connection_gets_a_fresh_process(self):
        process, port = self.start()
        output = self.exchange(port, b"00\n00\n")
        self.assertIn(b"Never gonna give you up", output)
        self.finish(process)

    def test_disconnect_reaps_the_child(self):
        process, port = self.start()
        client = socket.create_connection(("127.0.0.1", port), timeout=5)
        client.close()
        self.finish(process)

    def test_sources_and_local_dependencies_are_checked_before_listen(self):
        from sources import RUNTIMES, check_dependencies, load_source
        self.assertEqual(len(RUNTIMES), 11)
        for runtime in RUNTIMES:
            variants = ("corrected", "released") if runtime == "law-and-order" else (None,)
            for variant in variants:
                source = load_source(runtime, variant)
                self.assertGreater(len(source), 100)
            check_dependencies(runtime)

    def test_every_runtime_emits_protocol_output(self):
        from sources import RUNTIMES
        for runtime in RUNTIMES:
            process, port = self.start(runtime, "--idle-timeout", "30", "--wall-timeout", "90", "--cpu-seconds", "90")
            with socket.create_connection(("127.0.0.1", port), timeout=60) as client:
                client.settimeout(60)
                self.assertTrue(client.recv(1), runtime)
            self.finish(process)

    def test_loopback_guard(self):
        process = subprocess.run(
            [sys.executable, str(SERVER), "chaos", "--host", "0.0.0.0"],
            cwd=ROOT, capture_output=True, text=True,
        )
        self.assertEqual(process.returncode, 2)
        self.assertIn("loopback-only", process.stderr)

    def test_murmur_compatibility_vectors(self):
        from mmh3 import hash as murmur
        self.assertEqual(murmur(b"", 0), 0)
        self.assertEqual(murmur(b"hello", 0), 613153351)
        self.assertEqual(murmur(bytes(range(256)), 123), 874639277)


if __name__ == "__main__":
    unittest.main(verbosity=2)
