import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def pytest_configure(config):
    config.addinivalue_line("markers", "model: needs paddlepaddle and the cached PP-OCRv5 models; skipped otherwise")


@pytest.fixture
def svc():
    """The service module with its model state reset (no model is loaded unless a test sets one)."""
    import ocr_service

    ocr_service._ocr = None
    ocr_service._load_error = None
    yield ocr_service
    ocr_service._ocr = None
    ocr_service._load_error = None


@pytest.fixture
def client(svc):
    from fastapi.testclient import TestClient

    # No `with`: the lifespan would start a background thread that tries to load the real model.
    return TestClient(svc.app)
