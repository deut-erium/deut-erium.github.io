#!/usr/bin/env python3
"""Loopback TCP adapter for the local browser-practice challenge ports.

This launches the pinned public challenge source in a fresh subprocess for
 each connection. It is deliberately separate from the static Jekyll site.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import math
import os
from pathlib import Path
import signal
import shutil
import sys
import tempfile
import time

from sources import REWARD, RUNTIMES, check_dependencies, load_source

ROOT = Path(__file__).resolve().parents[2]
SESSION_ROOT = ROOT / "agent_out" / "challenge-tcp" / "sessions"
MMH3 = Path(__file__).with_name("mmh3.py").read_bytes()
TQDM = b"def tqdm(iterable, *args, **kwargs):\n    return iterable\n"
BOOTSTRAP = (
    "import resource,runpy;"
    "resource.setrlimit(resource.RLIMIT_CPU,({cpu},{cpu_hard}));"
    "resource.setrlimit(resource.RLIMIT_AS,(1073741824,1073741824));"
    "resource.setrlimit(resource.RLIMIT_FSIZE,(16777216,16777216));"
    "resource.setrlimit(resource.RLIMIT_NOFILE,(64,64));"
    "resource.setrlimit(resource.RLIMIT_CORE,(0,0));"
    "runpy.run_path('challenge.py',run_name='__main__')"
)


class RelayLimit(Exception):
    pass


class Service:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.sessions: set[asyncio.Task] = set()
        self.server: asyncio.AbstractServer | None = None
        self.shutting_down = False

    def make_session(self, source: bytes, runtime: str) -> Path:
        SESSION_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(SESSION_ROOT, 0o700)
        path = Path(tempfile.mkdtemp(prefix=f"{runtime}-", dir=SESSION_ROOT))
        os.chmod(path, 0o700)
        (path / "challenge.py").write_bytes(source)
        os.chmod(path / "challenge.py", 0o600)

        if runtime in {"desfunctional", "idea"}:
            (path / "flag.txt").write_text(REWARD, encoding="utf-8")
            os.chmod(path / "flag.txt", 0o600)
        if runtime in {"chaos", "real-mersenne", "cheater-mind"}:
            (path / "secret.py").write_text(f"flag = {REWARD!r}\n", encoding="utf-8")
            os.chmod(path / "secret.py", 0o600)
        if runtime in {"diffecient", "diffecientwo", "randsubware"}:
            (path / "flag.py").write_text(f"flag = {REWARD!r}\n", encoding="utf-8")
            os.chmod(path / "flag.py", 0o600)
        if runtime in {"diffecient", "diffecientwo"}:
            (path / "mmh3.py").write_bytes(MMH3)
            os.chmod(path / "mmh3.py", 0o600)
        if runtime == "blokechain":
            (path / "tqdm.py").write_bytes(TQDM)
            os.chmod(path / "tqdm.py", 0o600)
        return path

    async def spawn(self, source: bytes, runtime: str, variant: str | None, session: Path):
        cpu = max(1, math.ceil(self.args.cpu_seconds))
        command = BOOTSTRAP.format(cpu=cpu, cpu_hard=cpu + 1)
        env = {
            "PATH": os.environ.get("PATH", ""),
            "PYTHONPATH": "",
            "PYTHONHASHSEED": "random",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONUNBUFFERED": "1",
            "FLAG": REWARD,
        }
        if variant:
            env["PRACTICE_VARIANT"] = variant
        return await asyncio.create_subprocess_exec(
            sys.executable, "-u", "-c", command,
            cwd=session,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            env=env,
            start_new_session=True,
        )

    async def kill(self, process):
        if process.returncode is not None:
            with contextlib.suppress(Exception):
                await process.wait()
            return
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGTERM)
        try:
            await asyncio.wait_for(process.wait(), 1.0)
        except (asyncio.TimeoutError, ProcessLookupError):
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            with contextlib.suppress(Exception):
                await process.wait()

    async def relay(self, reader, writer, process):
        activity = time.monotonic()
        inbound = outbound = 0
        max_inbound = self.args.max_input
        max_outbound = self.args.max_output

        async def client_to_child():
            nonlocal activity, inbound
            while True:
                data = await reader.read(65536)
                if not data:
                    if process.stdin and not process.stdin.is_closing():
                        process.stdin.close()
                    return
                inbound += len(data)
                activity = time.monotonic()
                if inbound > max_inbound:
                    raise RelayLimit("input limit exceeded")
                process.stdin.write(data)
                await process.stdin.drain()

        async def child_to_client():
            nonlocal activity, outbound
            while True:
                data = await process.stdout.read(65536)
                if not data:
                    return
                outbound += len(data)
                activity = time.monotonic()
                if outbound > max_outbound:
                    raise RelayLimit("output limit exceeded")
                writer.write(data)
                await writer.drain()

        async def watchdog():
            started = time.monotonic()
            while True:
                await asyncio.sleep(min(1.0, max(0.05, self.args.idle_timeout / 4)))
                now = time.monotonic()
                if now - started > self.args.wall_timeout:
                    raise RelayLimit("wall-time limit exceeded")
                if now - activity > self.args.idle_timeout:
                    raise RelayLimit("idle-time limit exceeded")

        # The child's stdout must drain after process exit. Waiting on the
        # process as a competing FIRST_COMPLETED task can discard buffered
        # output before child_to_client() observes EOF.
        client_to_child_task = asyncio.create_task(client_to_child(), name='client-to-child')
        child_to_client_task = asyncio.create_task(child_to_client(), name='child-to-client')
        watchdog_task = asyncio.create_task(watchdog(), name='watchdog')
        tasks = [client_to_child_task, child_to_client_task, watchdog_task]
        try:
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            # A client may half-close stdin after sending a scripted transcript.
            # Let the child drain its final stdout before cleanup; this also
            # preserves normal nc/pwntools behavior when the peer calls shutdown.
            if client_to_child_task := next((t for t in done if t.get_name() == 'client-to-child'), None):
                if child_to_client_task := next((t for t in pending if t.get_name() == 'child-to-client'), None):
                    with contextlib.suppress(asyncio.TimeoutError, RelayLimit, ConnectionError, BrokenPipeError):
                        await asyncio.wait_for(asyncio.shield(child_to_client_task), 5.0)
            for task in done:
                with contextlib.suppress(RelayLimit, ConnectionError, BrokenPipeError, asyncio.CancelledError):
                    task.result()
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    async def handle(self, reader, writer):
        session = None
        process = None
        try:
            source = load_source(self.args.challenge, self.args.variant)
            session = self.make_session(source, self.args.challenge)
            process = await self.spawn(source, self.args.challenge, self.args.variant, session)
            await self.relay(reader, writer, process)
        except (ConnectionError, BrokenPipeError, asyncio.IncompleteReadError, RelayLimit):
            pass
        except Exception as error:
            # Never send internal paths, stack traces or flag material to a client.
            if self.args.debug:
                print(f"session error: {type(error).__name__}: {error}", file=sys.stderr, flush=True)
        finally:
            if process is not None:
                await self.kill(process)
            if session is not None:
                shutil.rmtree(session, ignore_errors=True)
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()

    async def accept(self, reader, writer):
        if self.shutting_down or len(self.sessions) >= self.args.max_clients:
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()
            return
        task = asyncio.create_task(self.handle(reader, writer))
        self.sessions.add(task)
        task.add_done_callback(self.sessions.discard)
        if self.args.once:
            task.add_done_callback(lambda _: self.server.close() if self.server else None)

    async def run(self):
        source = load_source(self.args.challenge, self.args.variant)
        check_dependencies(self.args.challenge)
        # Validate before binding. The source is loaded again per connection so
        # a client never shares random state with another client.
        del source
        self.server = await asyncio.start_server(
            self.accept, host=self.args.host, port=self.args.port, limit=128 * 1024
        )
        address = self.server.sockets[0].getsockname()
        print(f"practice TCP service listening on {address[0]}:{address[1]} for {self.args.challenge}", flush=True)
        try:
            async with self.server:
                await self.server.serve_forever()
        except asyncio.CancelledError:
            pass
        finally:
            self.shutting_down = True
            for task in list(self.sessions):
                task.cancel()
            await asyncio.gather(*self.sessions, return_exceptions=True)


def parse_args():
    parser = argparse.ArgumentParser(description="Local TCP service for browser-practice challenges")
    parser.add_argument("challenge", choices=RUNTIMES)
    parser.add_argument("--variant", choices=("corrected", "released"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=31337)
    parser.add_argument("--once", action="store_true", help="stop after the first connection")
    parser.add_argument("--max-clients", type=int, default=8)
    parser.add_argument("--max-input", type=int, default=4 * 1024 * 1024)
    parser.add_argument("--max-output", type=int, default=16 * 1024 * 1024)
    parser.add_argument("--idle-timeout", type=float, default=900)
    parser.add_argument("--wall-timeout", type=float, default=2100)
    parser.add_argument("--cpu-seconds", type=float, default=2050)
    parser.add_argument("--debug", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "::1", "localhost"}:
        parser.error("the service is loopback-only")
    if not 0 <= args.port <= 65535:
        parser.error("port must be between 0 and 65535")
    if args.max_clients < 1 or args.max_clients > 64:
        parser.error("max-clients must be between 1 and 64")
    if args.max_input < 1 or args.max_input > 64 * 1024 * 1024 or args.max_output < 1 or args.max_output > 64 * 1024 * 1024:
        parser.error("input/output limits must be between 1 byte and 64 MiB")
    if args.idle_timeout <= 0 or args.wall_timeout <= 0 or args.cpu_seconds <= 0:
        parser.error("timeouts must be positive")
    if args.challenge != "law-and-order" and args.variant is not None:
        parser.error("--variant applies only to Law and Order")
    return args


if __name__ == "__main__":
    try:
        asyncio.run(Service(parse_args()).run())
    except KeyboardInterrupt:
        pass
