"""Telephony transport interface: place and end calls through the provider's REST API, read its status callbacks,
and build Pipecat's serializer for the media WebSocket."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from ..calls import StatusUpdate


@dataclass(frozen=True)
class PlaceRequest:
    call_id: str
    to: str
    from_: str
    ring_timeout_s: int
    time_limit_s: int
    status_url: str
    stream_url: str


class TransportError(Exception):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class Transport(Protocol):
    name: str

    async def place_call(self, req: PlaceRequest) -> str:
        """Places the call; returns the provider's call id."""
        ...

    async def hangup(self, provider_call_id: str) -> None: ...

    def parse_status(self, payload: Mapping[str, Any]) -> StatusUpdate | None: ...

    def serializer(self, stream_id: str, provider_call_id: str) -> Any: ...
