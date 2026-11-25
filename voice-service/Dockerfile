# voice-service: Outreach's real-time calls (Pipecat: Exotel/Twilio media stream -> Sarvam or Azure STT -> Claude -> Sarvam or
# Azure TTS) on :8080. Built from the repo root like the other service images:
#   bash deploy/k8s/bootstrap/build-push-ecr.sh voice <tag>
#   docker buildx build --platform linux/arm64 -f voice-service/Dockerfile .
# Silero VAD and Smart Turn ship as ONNX files inside pipecat; nothing is downloaded at runtime.
FROM python:3.12.16-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/home/voice \
    PYTHONPATH=/app/src

# Debian already has a "voice" group (gid 22), so the user gets its own name and the pod's gid 10001.
RUN groupadd --gid 10001 voicesvc \
 && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/voice --shell /usr/sbin/nologin voicesvc

# The Azure Speech SDK's native core links libasound (the SDK's own Debian requirement); no audio device is used.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libasound2 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY voice-service/requirements.txt ./
# The freeze goes to the build log: exactly what this image runs.
RUN pip install -r requirements.txt && pip freeze

COPY voice-service/src ./src
USER 10001
# Imports the app and loads both ONNX models once: a broken install fails the build here, never on a live call.
RUN python -c "import voice_service.app, voice_service.pipeline; \
import pipecat.services.azure.stt, pipecat.services.azure.tts; \
from pipecat.audio.vad.silero import SileroVADAnalyzer; \
from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3; \
SileroVADAnalyzer(); LocalSmartTurnAnalyzerV3(); print('models ok')"

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=4)"]
CMD ["python", "-m", "voice_service.app"]
