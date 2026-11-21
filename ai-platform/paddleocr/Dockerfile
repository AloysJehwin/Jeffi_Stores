# PaddleOCR sidecar (PP-OCRv5, CPU, x86_64) serving ocr_service.py on :8866. Built on the Razer box from ai-platform/
# like the gateway (deploy/overlays/razer/host/ai-gateway-release.sh):
#   buildctl build --frontend dockerfile.v0 --local context=. --local dockerfile=paddleocr \
#     --output type=image,name=docker.io/jeffi/paddleocr:latest,unpack=true
# The models are fetched at build time, so the pod starts and runs with no network.
FROM python:3.12.16-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/home/ocr \
    PADDLE_PDX_CACHE_HOME=/home/ocr/.paddlex

# OpenCV (pulled in by PaddleX) needs libGL and glib; Paddle needs OpenMP.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --create-home --home-dir /home/ocr --shell /usr/sbin/nologin ocr

WORKDIR /app
COPY paddleocr/requirements.txt ./
# The freeze goes to the build log: exactly what this image runs.
RUN pip install -r requirements.txt && pip freeze

USER 10001
COPY paddleocr/ocr_service.py paddleocr/sample.png ./
# Downloads the PP-OCRv5 models into PADDLE_PDX_CACHE_HOME and reads the sample as a PNG and a PDF: a broken
# install fails the build here, never in the pod.
RUN python ocr_service.py --warmup sample.png

# Runtime is offline: never look for a model hoster (the models above are all it loads).
ENV PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    HF_HUB_OFFLINE=1
EXPOSE 8866
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8866/health', timeout=4)"]
CMD ["uvicorn", "ocr_service:app", "--host", "0.0.0.0", "--port", "8866", "--no-access-log"]
