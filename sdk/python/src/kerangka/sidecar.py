"""
Kerangka sidecar client for Python.

L1 of PLAN.md §11: any language reaches the engine through `keranga serve` over stdio
JSON-RPC, without embedding a native engine. This is that client; standard library only.

    from kerangka.sidecar import Sidecar

    with Sidecar("examples/invoicing.kerangka.json") as kerangka:
        print(kerangka.call("describe")["entities"])
        result = kerangka.run("Invoice.send", record, actor={"id": "u1", "roles": ["billing"]})

Each request is one JSON line on stdin, each response one JSON line on stdout. A domain
refusal (`ok: false` with a stable code) comes back as a result; a protocol error raises
`SidecarError`.
"""

from __future__ import annotations

import json
import os
import subprocess
from typing import Any, Dict, Iterator, List, Optional, Sequence

__all__ = ["Sidecar", "SidecarError", "DEFAULT_CLI"]

DEFAULT_CLI = os.path.join("packages", "cli", "dist", "bin", "kerangka.js")


class SidecarError(RuntimeError):
    """A JSON-RPC protocol error, or a sidecar that died before answering."""

    def __init__(self, message: str, code: Optional[int] = None, data: Any = None):
        super().__init__(message)
        self.code = code
        self.data = data


class Sidecar:
    """A running `keranga serve --stdio`, spoken to over stdin and stdout."""

    def __init__(
        self,
        document: str,
        cli: str = DEFAULT_CLI,
        cwd: Optional[str] = None,
        node: str = "node",
        session: Optional[str] = None,
    ):
        self.document = document
        self.cli = cli
        self.cwd = cwd or os.getcwd()
        self.node = node
        # A session file keeps aggregates, unacknowledged events, and unperformed
        # effects across a restart; without one the session is in memory and dies
        # with the process, which is fine for a test and wrong for a sidecar.
        self.session = session
        self._process: Optional[subprocess.Popen] = None
        self._next_id = 0

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> "Sidecar":
        if self._process is not None:
            return self
        if not os.path.exists(os.path.join(self.cwd, self.cli)):
            raise SidecarError(
                f"CLI not built at {self.cli}; run 'npm run build' first"
            )
        if not os.path.exists(os.path.join(self.cwd, self.document)):
            raise SidecarError(f"Document not found: {self.document}")

        command = [self.node, self.cli, "serve", self.document, "--stdio"]
        if self.session:
            command += ["--session", self.session]
        self._process = subprocess.Popen(
            command,
            cwd=self.cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        return self

    def stop(self) -> None:
        if self._process is None:
            return
        try:
            if self._process.stdin:
                self._process.stdin.close()
            self._process.wait(timeout=10)
        except Exception:
            self._process.kill()
        finally:
            self._process = None

    def __enter__(self) -> "Sidecar":
        return self.start()

    def __exit__(self, *exc: Any) -> None:
        self.stop()

    # -- protocol ----------------------------------------------------------

    def call(self, method: str, **params: Any) -> Any:
        """Send one request and return its `result`, or raise `SidecarError`."""
        if self._process is None or self._process.stdin is None or self._process.stdout is None:
            raise SidecarError("Sidecar is not running; use it as a context manager")

        self._next_id += 1
        request = {"jsonrpc": "2.0", "id": self._next_id, "method": method, "params": params}
        self._process.stdin.write(json.dumps(request) + "\n")
        self._process.stdin.flush()

        line = self._process.stdout.readline()
        if not line:
            stderr = self._process.stderr.read() if self._process.stderr else ""
            raise SidecarError(f"Sidecar closed the stream without answering: {stderr.strip()}")

        try:
            response = json.loads(line)
        except json.JSONDecodeError as err:
            raise SidecarError(f"Sidecar sent a line that is not JSON: {line!r}") from err

        if "error" in response:
            error = response["error"]
            raise SidecarError(
                error.get("message", "unknown error"),
                code=error.get("code"),
                data=error.get("data"),
            )
        return response.get("result")

    # -- Runtime API shorthands (PLAN.md section 10) -----------------------

    def describe(self) -> Dict[str, Any]:
        return self.call("describe")

    def validate(self, entity: str, record: Dict[str, Any]) -> Dict[str, Any]:
        return self.call("validate", entity=entity, record=record)

    def compute(self, entity: str, record: Dict[str, Any]) -> Dict[str, Any]:
        return self.call("compute", entity=entity, record=record)["record"]

    def can(
        self,
        operation: str,
        record: Optional[Dict[str, Any]] = None,
        actor: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return self.call(
            "can", operation=operation, record=record or {}, actor=actor
        )

    def available(
        self,
        entity: str,
        record: Dict[str, Any],
        actor: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        return self.call("available", entity=entity, record=record, actor=actor)["operations"]

    def run(
        self,
        action: str,
        record: Dict[str, Any],
        input: Optional[Dict[str, Any]] = None,  # noqa: A002 - mirrors the wire name
        actor: Optional[Dict[str, Any]] = None,
        **options: Any,
    ) -> Dict[str, Any]:
        return self.call(
            "run", action=action, record=record, input=input or {}, actor=actor, options=options
        )

    def react(self, event: Dict[str, Any]) -> Dict[str, Any]:
        return self.call("react", event=event)

    def decide(self, table: str, inputs: Dict[str, Any]) -> Dict[str, Any]:
        return self.call("decide", table=table, inputs=inputs)

    def query_plan(
        self,
        query: str,
        params: Optional[Dict[str, Any]] = None,
        actor: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return self.call("queryPlan", query=query, params=params or {}, actor=actor)

    # -- Session ---------------------------------------------------------------
    # The sidecar applies the effects a run produces, so a session remembers what it
    # has seen. These are sidecar methods, not Runtime API ones: a native engine is pure
    # and a real host brings its own database.

    def get(self, entity: str, id: str) -> Optional[Dict[str, Any]]:  # noqa: A002
        """The stored aggregate, or None when the session has never seen that id."""
        return self.call("get", entity=entity, id=id)["record"]

    def list(self, entity: str) -> List[Dict[str, Any]]:  # noqa: A003
        return self.call("list", entity=entity)["records"]

    def put(self, entity: str, record: Dict[str, Any]) -> Dict[str, Any]:
        """Seed a record into the session, computed the way the engine computes it."""
        return self.call("put", entity=entity, record=record)["record"]

    def events(self, type: Optional[str] = None) -> List[Dict[str, Any]]:  # noqa: A002
        return self.call("events", type=type)["events"]

    def handle(
        self,
        event: Dict[str, Any],
        actor: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """The host loop for policies: react, run what they chose, store the effects.

        Returns the invocations, the runs that succeeded, the policies skipped because
        their idempotency key was already claimed, and the ones that refused.
        """
        return self.call("handle", event=event, actor=actor)

    def outbox(self, type: Optional[str] = None) -> List[Dict[str, Any]]:  # noqa: A002
        """Events still waiting for a host to deliver them, oldest first."""
        return self.call("outbox", type=type)["entries"]

    def ack(self, entry_id: str) -> Dict[str, Any]:
        """Tell the sidecar a queued event was delivered."""
        return self.call("ack", id=entry_id)["entry"]

    def nack(self, entry_id: str, error: Optional[str] = None) -> Dict[str, Any]:
        """Delivery failed: the entry stays queued to be retried."""
        return self.call("nack", id=entry_id, error=error)["entry"]

    def pending_effects(self, type: Optional[str] = None) -> List[Dict[str, Any]]:  # noqa: A002
        """Effects the host has to perform: calls, notifications, timers.

        The sidecar performs none of them — it cannot know what "delivered" means —
        but it queues them in the same commit as the write that caused them, so a
        dispatch that fails leaves the effect waiting to be retried.
        """
        return self.call("pendingEffects", type=type)["entries"]

    def ack_effect(self, entry_id: str) -> Dict[str, Any]:
        """Tell the sidecar a queued effect was performed."""
        return self.call("ackEffect", id=entry_id)["entry"]

    def nack_effect(self, entry_id: str, error: Optional[str] = None) -> Dict[str, Any]:
        """The effect could not be performed: it stays queued to be retried."""
        return self.call("nackEffect", id=entry_id, error=error)["entry"]

    def claims(self) -> List[str]:
        """Idempotency keys this session has already honoured."""
        return self.call("claims")["claims"]

    def clear(self) -> None:
        self.call("clear")


def iter_json_lines(lines: Sequence[str]) -> Iterator[Dict[str, Any]]:
    """Parse JSON lines, skipping blanks. Useful for a host that reads the sidecar itself."""
    for line in lines:
        stripped = line.strip()
        if stripped:
            yield json.loads(stripped)
