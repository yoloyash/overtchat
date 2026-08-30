# syntax=docker/dockerfile:1

ARG PYTHON_IMAGE=python:3.12-slim-bookworm
ARG SPEECH_TO_SPEECH_COMMIT=3986f453012a131632eee4731995474046846794
ARG SILERO_VAD_COMMIT=867c2aa692646a1f1de3e94a15c9dd9f614c0acb
ARG SMART_TURN_REVISION=f766f81d3cfdf7737ac64aad813d91bbfd56bf93

FROM ${PYTHON_IMAGE} AS builder

ARG SPEECH_TO_SPEECH_COMMIT
ARG SILERO_VAD_COMMIT
ARG SMART_TURN_REVISION

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    VIRTUAL_ENV=/opt/overtchat/venv \
    PATH=/opt/overtchat/venv/bin:${PATH}

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

RUN python -m venv "${VIRTUAL_ENV}"

COPY requirements.txt /tmp/requirements.txt

# Silero VAD is the only component that requires Torch. Install the CPU wheel
# explicitly so PyPI cannot pull CUDA libraries into this orchestration image.
RUN pip install --index-url https://download.pytorch.org/whl/cpu \
      torch==2.11.0+cpu \
      torchaudio==2.11.0+cpu \
 && pip install -r /tmp/requirements.txt \
 && pip check

# This is OvertChat's image, built from a minimal Python base. We consume only
# the pinned upstream engine source, not its Dockerfile or broad dependency
# metadata. The checked revision contains the remote OpenAI-compatible STT and
# TTS handlers that are not present in the v0.2.12 release tag.
RUN git clone --filter=blob:none --no-checkout https://github.com/huggingface/speech-to-speech.git /tmp/speech-to-speech \
 && git -C /tmp/speech-to-speech checkout --detach "${SPEECH_TO_SPEECH_COMMIT}" \
 && test "$(git -C /tmp/speech-to-speech rev-parse HEAD)" = "${SPEECH_TO_SPEECH_COMMIT}" \
 && mkdir -p /opt/overtchat/speech-to-speech /opt/overtchat/licenses \
 && cp -a /tmp/speech-to-speech/src /opt/overtchat/speech-to-speech/src \
 && cp /tmp/speech-to-speech/LICENSE /opt/overtchat/licenses/speech-to-speech.LICENSE

ENV HF_HOME=/opt/overtchat/models/huggingface \
    NLTK_DATA=/opt/overtchat/models/nltk \
    PYTHONPATH=/opt/overtchat/speech-to-speech/src \
    TORCH_HOME=/opt/overtchat/models/torch

# Bake every local runtime asset into the image. Startup therefore does not
# depend on GitHub or Hugging Face being reachable.
RUN python -c "import nltk; nltk.download('punkt_tab', download_dir='$NLTK_DATA', raise_on_error=True); nltk.download('averaged_perceptron_tagger_eng', download_dir='$NLTK_DATA', raise_on_error=True)" \
 && mkdir -p "$NLTK_DATA/tokenizers" "$TORCH_HOME/hub" \
 && ln -s ../taggers/averaged_perceptron_tagger_eng "$NLTK_DATA/tokenizers/averaged_perceptron_tagger_eng" \
 && git clone --filter=blob:none --no-checkout https://github.com/snakers4/silero-vad.git "$TORCH_HOME/hub/snakers4_silero-vad_master" \
 && git -C "$TORCH_HOME/hub/snakers4_silero-vad_master" checkout --detach "${SILERO_VAD_COMMIT}" \
 && test "$(git -C "$TORCH_HOME/hub/snakers4_silero-vad_master" rev-parse HEAD)" = "${SILERO_VAD_COMMIT}" \
 && rm -rf "$TORCH_HOME/hub/snakers4_silero-vad_master/.git" \
 && python -c "import torch; torch.hub.load('snakers4/silero-vad:master', 'silero_vad', trust_repo=True, skip_validation=True)" \
 && smart_turn_model="$(python -c "from huggingface_hub import hf_hub_download; print(hf_hub_download(repo_id='pipecat-ai/smart-turn-v3', filename='smart-turn-v3.2-cpu.onnx', revision='${SMART_TURN_REVISION}'))")" \
 && test -s "${smart_turn_model}" \
 && cp "${smart_turn_model}" /opt/overtchat/models/smart-turn-v3.2-cpu.onnx \
 && rm -rf "$HF_HOME" \
 && python -c "from speech_to_speech.STT.openai_compatible_handler import OpenAICompatibleSTTHandler; from speech_to_speech.LLM.responses_api_language_model import ResponsesApiModelHandler; from speech_to_speech.TTS.openai_compatible_handler import OpenAICompatibleTTSHandler; from speech_to_speech.VAD.smart_turn import SmartTurnAnalyzer; from speech_to_speech.api.openai_realtime.websocket_router import create_app" \
 && python -m speech_to_speech.cli serve --help >/dev/null

FROM ${PYTHON_IMAGE} AS runtime

ARG SPEECH_TO_SPEECH_COMMIT
ARG SILERO_VAD_COMMIT
ARG SMART_TURN_REVISION

LABEL org.opencontainers.image.title="OvertChat Voice" \
      org.opencontainers.image.description="Realtime voice orchestration for OvertChat" \
      org.opencontainers.image.source="https://github.com/yoloyash/overtchat" \
      org.opencontainers.image.licenses="MIT AND Apache-2.0 AND BSD-2-Clause" \
      io.overtchat.speech-to-speech.revision="${SPEECH_TO_SPEECH_COMMIT}" \
      io.overtchat.silero-vad.revision="${SILERO_VAD_COMMIT}" \
      io.overtchat.smart-turn.revision="${SMART_TURN_REVISION}"

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libgomp1 \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 overtchat \
 && useradd --system --uid 10001 --gid overtchat --no-create-home overtchat

COPY --from=builder --chown=overtchat:overtchat /opt/overtchat /opt/overtchat
COPY --chown=overtchat:overtchat entrypoint.py /opt/overtchat/entrypoint.py
COPY --chown=overtchat:overtchat licenses/OVERTCHAT.LICENSE /opt/overtchat/licenses/OVERTCHAT.LICENSE
COPY --chown=overtchat:overtchat licenses/SMART-TURN.LICENSE /opt/overtchat/licenses/SMART-TURN.LICENSE
COPY --chown=overtchat:overtchat THIRD_PARTY_NOTICES.md /opt/overtchat/licenses/THIRD_PARTY_NOTICES.md

ENV HF_HOME=/opt/overtchat/models/huggingface \
    HF_HUB_OFFLINE=1 \
    NLTK_DATA=/opt/overtchat/models/nltk \
    PATH=/opt/overtchat/venv/bin:${PATH} \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/opt/overtchat/speech-to-speech/src \
    PYTHONUNBUFFERED=1 \
    TOKENIZERS_PARALLELISM=false \
    TORCH_HOME=/opt/overtchat/models/torch \
    XDG_CACHE_HOME=/tmp/overtchat-cache

USER overtchat:overtchat
WORKDIR /opt/overtchat

EXPOSE 8765

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/v1/pool', timeout=3)" || exit 1

STOPSIGNAL SIGTERM
ENTRYPOINT ["python", "/opt/overtchat/entrypoint.py"]
