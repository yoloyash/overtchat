# syntax=docker/dockerfile:1

# Two published tiers share this file:
#   slim (default): Python data, chart, image and document libraries, and
#                   poppler.
#   full:           slim plus pandoc, LibreOffice, Tesseract OCR, ffmpeg and
#                   scientific libraries.
ARG PYTHON_IMAGE=python:3.12-slim-bookworm

FROM ${PYTHON_IMAGE} AS runner-build
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev libseccomp-dev \
 && rm -rf /var/lib/apt/lists/*
COPY runner.c /src/runner.c
RUN gcc -O2 -Wall -Wextra -Werror -o /src/runner /src/runner.c -lseccomp

FROM ${PYTHON_IMAGE} AS slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends libseccomp2 poppler-utils \
 && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/overtchat/venv
COPY requirements-slim.txt /tmp/requirements-slim.txt
# Run code has no network, so the run environment does not keep pip.
RUN /opt/overtchat/venv/bin/pip install -r /tmp/requirements-slim.txt \
 && /opt/overtchat/venv/bin/pip check \
 && /opt/overtchat/venv/bin/pip uninstall -y pip \
 && MPLCONFIGDIR=/tmp/matplotlib /opt/overtchat/venv/bin/python -c "import matplotlib.pyplot" \
 && rm -rf /tmp/matplotlib

COPY --from=runner-build /src/runner /opt/overtchat/bin/runner
COPY lib/ /opt/overtchat/lib/
COPY skills/ /opt/overtchat/skills/
COPY server.py /opt/overtchat/server.py
COPY THIRD_PARTY_NOTICES.md /opt/overtchat/THIRD_PARTY_NOTICES.md

# /mnt/data resolves to each process's own working directory: a run sees its
# uploads and outputs there without mount namespaces.
RUN mkdir -p /runs /mnt \
 && chmod 0711 /runs \
 && ln -s /proc/self/cwd /mnt/data

ARG SANDBOX_VERSION=dev
ENV SANDBOX_VERSION=${SANDBOX_VERSION} \
    SANDBOX_TIER=slim \
    PYTHONUNBUFFERED=1

LABEL org.opencontainers.image.title="OvertChat sandbox" \
      org.opencontainers.image.description="Stateless Python code execution for OvertChat" \
      org.opencontainers.image.source="https://github.com/yoloyash/overtchat" \
      org.opencontainers.image.licenses="MIT AND GPL-2.0-or-later"

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=4)"

# The server starts as root only so the launcher can switch each run to a
# fresh unprivileged user; see runner.c and the Compose capability list.
CMD ["python", "/opt/overtchat/server.py"]

FROM slim AS full

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      pandoc \
      libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
      tesseract-ocr tesseract-ocr-eng ffmpeg \
      fonts-liberation fonts-dejavu-core fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/*

COPY requirements-full.txt /tmp/requirements-full.txt
RUN /opt/overtchat/venv/bin/python -m ensurepip \
 && /opt/overtchat/venv/bin/python -m pip install -r /tmp/requirements-full.txt \
 && /opt/overtchat/venv/bin/python -m pip check \
 && /opt/overtchat/venv/bin/python -m pip uninstall -y pip

ENV SANDBOX_TIER=full
