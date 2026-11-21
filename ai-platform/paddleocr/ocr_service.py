#!/usr/bin/env python3
"""
PaddleOCR (PP-OCRv5) HTTP sidecar behind the AI gateway's /v1/ocr and /v1/vision. The Dockerfile here serves it
on :8866; locally run `python ai-platform/paddleocr/ocr_service.py` (Python 3.11+).

Install:  pip install -r ai-platform/paddleocr/requirements.txt
Run:      python ai-platform/paddleocr/ocr_service.py              (PORT, default 8866)
Warm up:  python ai-platform/paddleocr/ocr_service.py --warmup     (fetches the models, reads sample.png)

Endpoints:
  GET  /health   -> {"ok": true, "model": "PP-OCRv5", "ready": <model loaded>}; 503 once loading the model failed.
                    /health?ready=1 also answers 503 until the model is loaded (k8s readiness).
  POST /ocr      -> {"data": "<base64>", "mime_type": "image/jpeg|image/png|image/webp|application/pdf", "max_pages": 10}
                 <- {"ok": true, "text": "...", "pages": 1, "lines": [{"text": "...", "score": 0.987}], "mean_score": 0.95}
                 <- {"ok": false, "reason": "...", "code": "unsupported_mime" | "ocr_failed" | "no_text"}
"""

import base64
import io
import os
import sys
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

MODEL = "PP-OCRv5"
# Named rather than left to PaddleOCR's default: 3.7 defaults to PP-OCRv6, and the gateway reports PP-OCRv5.
DET_MODEL = "PP-OCRv5_server_det"
REC_MODEL = "PP-OCRv5_server_rec"
SUFFIXES = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}

_ocr = None
_load_error: Optional[str] = None
# One pipeline, one inference at a time: Paddle predictors are not thread-safe and FastAPI runs requests in a pool.
_lock = threading.Lock()


def _load():
    """Build the pipeline once. Call with _lock held."""
    global _ocr, _load_error
    if _ocr is None:
        from paddleocr import PaddleOCR

        opts = {}
        if os.environ.get("OCR_CPU_THREADS"):
            opts["cpu_threads"] = int(os.environ["OCR_CPU_THREADS"])
        try:
            _ocr = PaddleOCR(
                text_detection_model_name=DET_MODEL,
                text_recognition_model_name=REC_MODEL,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                **opts,
            )
        except Exception as e:
            _load_error = str(e)
            raise
        _load_error = None
    return _ocr


def get_ocr():
    with _lock:
        return _load()


def _preload():
    try:
        get_ocr()
        print(f"[ocr] {MODEL} loaded", flush=True)
    except Exception as e:
        print(f"[ocr] loading {MODEL} failed: {e}", flush=True)


@asynccontextmanager
async def lifespan(_app):
    # Load in the background: /health answers at once and readiness flips when the model is in memory.
    threading.Thread(target=_preload, daemon=True).start()
    yield


app = FastAPI(title="PaddleOCR Service", version="3.1.0", lifespan=lifespan)


def _page_lines(page) -> list:
    """(text, score) for each non-empty line read on one page."""
    if page is None:
        return []
    texts = page.get("rec_texts") or []
    scores = page.get("rec_scores")
    scores = [] if scores is None else list(scores)
    return [(t, float(scores[i]) if i < len(scores) else 0.0) for i, t in enumerate(texts) if t and t.strip()]


def _ocr_buffer(buf: bytes, suffix: str, max_pages: Optional[int] = None) -> list:
    """Write buf to a temp file and OCR it: one list of (text, score) per page, at most max_pages pages."""
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(buf)
        tmp_path = f.name
    try:
        with _lock:
            ocr = _load()
            # predict_iter renders a PDF page by page, so stopping at max_pages skips the rest.
            results = ocr.predict_iter(tmp_path) if hasattr(ocr, "predict_iter") else ocr.predict(tmp_path)
            pages: list = []
            try:
                for page in results:
                    pages.append(_page_lines(page))
                    if max_pages and len(pages) >= max_pages:
                        break
            finally:
                if hasattr(results, "close"):
                    results.close()
            return pages
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


class OcrRequest(BaseModel):
    data: str
    mime_type: str
    max_pages: Optional[int] = 10


@app.get("/health")
async def health(ready: bool = False):
    # async: answered on the event loop, never queued behind OCR requests waiting for the lock.
    loaded = _ocr is not None
    if not loaded and _load_error:
        return JSONResponse({"ok": False, "model": MODEL, "ready": False, "error": _load_error}, status_code=503)
    if not loaded and ready:
        return JSONResponse({"ok": False, "model": MODEL, "ready": False}, status_code=503)
    return {"ok": True, "model": MODEL, "ready": loaded}


@app.post("/ocr")
def ocr(req: OcrRequest):
    try:
        raw = base64.b64decode(req.data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64: {e}")

    mime = req.mime_type.lower().strip()
    suffix = SUFFIXES.get(mime)
    if not suffix:
        return JSONResponse({"ok": False, "reason": f"Unsupported mime type: {mime}", "code": "unsupported_mime"})

    started = time.monotonic()
    try:
        pages = _ocr_buffer(raw, suffix, max(1, req.max_pages or 10))
    except Exception as e:
        print(f"[ocr] {mime} {len(raw)}B failed: {e}", flush=True)
        return JSONResponse({"ok": False, "reason": f"OCR failed: {str(e)}", "code": "ocr_failed"})

    read = [line for page in pages for line in page]
    page_count = len(pages) or 1
    print(f"[ocr] {mime} {len(raw)}B: {page_count} page(s), {len(read)} line(s) in {time.monotonic() - started:.1f}s", flush=True)
    if not read:
        return JSONResponse({"ok": False, "reason": "No text detected in document", "code": "no_text", "pages": page_count})

    return {
        "ok": True,
        "text": "\n".join(t for t, _ in read),
        "pages": page_count,
        "lines": [{"text": t, "score": round(s, 3)} for t, s in read],
        "mean_score": round(sum(s for _, s in read) / len(read), 3),
    }


def warmup(path: str) -> None:
    """Fetch the models and read the sample as a PNG and as a PDF, so a broken install fails here (the image build)."""
    from PIL import Image

    with open(path, "rb") as f:
        png = f.read()
    pdf = io.BytesIO()
    Image.open(io.BytesIO(png)).convert("RGB").save(pdf, format="PDF")
    for suffix, data in ((".png", png), (".pdf", pdf.getvalue())):
        lines = [t for page in _ocr_buffer(data, suffix, 1) for t, _ in page]
        print(f"[ocr] warmup {suffix}: {lines}", flush=True)
        if not lines:
            sys.exit(f"warmup read no text from the {suffix} sample")


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--warmup":
        here = os.path.dirname(os.path.abspath(__file__))
        warmup(sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "sample.png"))
        return
    import uvicorn

    uvicorn.run(app, host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", 8866)))


if __name__ == "__main__":
    main()
