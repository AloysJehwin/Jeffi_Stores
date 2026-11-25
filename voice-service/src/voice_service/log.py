"""Structured JSON logs with phone numbers masked. Transcripts are only ever logged at DEBUG."""

from __future__ import annotations

import json
import logging
import re
import sys
import time
from typing import Any

# E.164-ish runs of 8+ digits (optionally with +, spaces or dashes inside).
_PHONE = re.compile(r"\+?\d[\d\s-]{6,}\d")


def mask_phone(value: str | None) -> str:
    """'+919876543210' -> '+91******3210'. Keeps the country code and last 4 digits."""
    if not value:
        return ""
    digits = re.sub(r"\D", "", value)
    if len(digits) < 8:
        return "*" * len(digits)
    head = digits[:2]
    plus = "+" if value.strip().startswith("+") else ""
    return f"{plus}{head}{'*' * (len(digits) - 6)}{digits[-4:]}"


def mask_text(text: str) -> str:
    return _PHONE.sub(lambda m: mask_phone(m.group(0)), text)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out: dict[str, Any] = {
            "t": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + f".{int(record.msecs):03d}Z",
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": mask_text(record.getMessage()),
        }
        extra = getattr(record, "fields", None)
        if isinstance(extra, dict):
            for k, v in extra.items():
                out[k] = mask_text(v) if isinstance(v, str) else v
        if record.exc_info:
            out["exc"] = mask_text(self.formatException(record.exc_info))
        return json.dumps(out, ensure_ascii=False, default=str)


def setup_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    root.handlers.clear()
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(JsonFormatter())
    root.addHandler(h)
    root.setLevel(level)
    for noisy in ("httpx", "httpcore", "botocore", "boto3", "urllib3", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    _quiet_loguru(level)


def _quiet_loguru(level: str) -> None:
    """Pipecat logs through loguru, including transcripts and call metadata at DEBUG: forward WARNING and up only
    (DEBUG when LOG_LEVEL=DEBUG), masked, into the same JSON stream."""
    try:
        from loguru import logger as loguru_logger
    except ImportError:  # pragma: no cover
        return
    loguru_logger.remove()
    min_level = "DEBUG" if level == "DEBUG" else "WARNING"
    bridge = logging.getLogger("pipecat")

    def sink(message: Any) -> None:
        rec = message.record
        bridge.log(logging.getLevelNamesMapping().get(rec["level"].name, logging.WARNING), rec["message"])

    loguru_logger.add(sink, level=min_level)


def get_logger(name: str) -> "_FieldsAdapter":
    return _FieldsAdapter(logging.getLogger(name), {})


class _FieldsAdapter(logging.LoggerAdapter):  # type: ignore[type-arg]
    """log.info("msg", callId=..., status=...) -> fields in the JSON line."""

    def log(self, level: int, msg: object, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        if not self.isEnabledFor(level):
            return
        exc_info = kwargs.pop("exc_info", None)
        self.logger.log(level, msg, *args, exc_info=exc_info, extra={"fields": kwargs})

    def debug(self, msg: object, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        self.log(logging.DEBUG, msg, *args, **kwargs)

    def info(self, msg: object, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        self.log(logging.INFO, msg, *args, **kwargs)

    def warning(self, msg: object, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        self.log(logging.WARNING, msg, *args, **kwargs)

    def error(self, msg: object, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        self.log(logging.ERROR, msg, *args, **kwargs)

    def exception(self, msg: object, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        kwargs.setdefault("exc_info", True)
        self.log(logging.ERROR, msg, *args, **kwargs)
