import base64
import importlib.util
import os

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLE = os.path.join(os.path.dirname(HERE), "sample.png")
MODELS = os.path.expanduser("~/.paddlex/official_models/PP-OCRv5_server_det")


def b64(path=SAMPLE):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


class FakeOcr:
    """Stands in for the PaddleOCR pipeline: yields canned pages and records the file it was handed."""

    def __init__(self, pages=None, error=None):
        self.pages = pages if pages is not None else [{"rec_texts": ["Invoice 42", "  ", "Total 118"], "rec_scores": [0.99, 0.5, 0.9]}]
        self.error = error
        self.paths = []

    def predict_iter(self, path):
        self.paths.append(path)
        if self.error:
            raise self.error
        return iter(self.pages)


def test_sample_image_is_in_the_repo():
    assert os.path.getsize(SAMPLE) > 0
    with open(SAMPLE, "rb") as f:
        assert f.read(8) == b"\x89PNG\r\n\x1a\n"


# ---- GET /health (the route is /health; the k8s probes use it) ----


def test_health_is_up_while_the_model_loads(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"ok": True, "model": "PP-OCRv5", "ready": False}


def test_health_ready_probe_is_503_until_the_model_is_loaded(client, svc):
    res = client.get("/health", params={"ready": 1})
    assert res.status_code == 503
    assert res.json() == {"ok": False, "model": "PP-OCRv5", "ready": False}
    svc._ocr = FakeOcr()
    res = client.get("/health", params={"ready": 1})
    assert res.status_code == 200
    assert res.json() == {"ok": True, "model": "PP-OCRv5", "ready": True}


def test_health_reports_a_failed_model_load(client, svc):
    svc._load_error = "model files missing"
    res = client.get("/health")
    assert res.status_code == 503
    assert res.json() == {"ok": False, "model": "PP-OCRv5", "ready": False, "error": "model files missing"}


# ---- POST /ocr, engine mocked ----


def test_ocr_reads_the_sample_image(client, svc):
    fake = FakeOcr()
    svc._ocr = fake
    res = client.post("/ocr", json={"data": b64(), "mime_type": "image/png"})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["text"] == "Invoice 42\nTotal 118"
    assert body["pages"] == 1
    assert body["lines"] == [{"text": "Invoice 42", "score": 0.99}, {"text": "Total 118", "score": 0.9}]
    assert body["mean_score"] == pytest.approx(0.945)
    assert fake.paths[0].endswith(".png") and not os.path.exists(fake.paths[0])  # temp file cleaned up


def test_ocr_stops_at_max_pages(client, svc):
    pages = [{"rec_texts": [f"page {i}"], "rec_scores": [0.9]} for i in range(5)]
    svc._ocr = FakeOcr(pages=pages)
    body = client.post("/ocr", json={"data": b64(), "mime_type": "application/pdf", "max_pages": 2}).json()
    assert body["pages"] == 2
    assert body["text"] == "page 0\npage 1"


def test_ocr_rejects_an_unsupported_mime(client, svc):
    svc._ocr = FakeOcr()
    body = client.post("/ocr", json={"data": b64(), "mime_type": "image/gif"}).json()
    assert body["ok"] is False
    assert body["code"] == "unsupported_mime"


def test_ocr_400s_on_bad_base64(client, svc):
    svc._ocr = FakeOcr()
    res = client.post("/ocr", json={"data": "***not base64***", "mime_type": "image/png"})
    assert res.status_code == 400
    assert "Invalid base64" in res.json()["detail"]


def test_ocr_422s_when_the_body_is_incomplete(client):
    res = client.post("/ocr", json={"mime_type": "image/png"})
    assert res.status_code == 422


def test_ocr_reports_no_text(client, svc):
    svc._ocr = FakeOcr(pages=[{"rec_texts": [], "rec_scores": []}])
    body = client.post("/ocr", json={"data": b64(), "mime_type": "image/png"}).json()
    assert body == {"ok": False, "reason": "No text detected in document", "code": "no_text", "pages": 1}


def test_ocr_reports_an_engine_failure(client, svc):
    svc._ocr = FakeOcr(error=RuntimeError("boom"))
    body = client.post("/ocr", json={"data": b64(), "mime_type": "image/png"}).json()
    assert body["ok"] is False
    assert body["code"] == "ocr_failed"
    assert body["reason"] == "OCR failed"
    assert "boom" not in body["reason"]


# ---- real model: only where paddlepaddle and the cached models exist ----


@pytest.mark.model
@pytest.mark.skipif(importlib.util.find_spec("paddle") is None, reason="paddlepaddle is not installed")
@pytest.mark.skipif(not os.path.isdir(MODELS), reason="PP-OCRv5 models are not cached in ~/.paddlex")
def test_ocr_reads_text_from_the_sample_with_the_real_model(client):
    res = client.post("/ocr", json={"data": b64(), "mime_type": "image/png"})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["text"].strip()
    assert body["mean_score"] > 0.5
