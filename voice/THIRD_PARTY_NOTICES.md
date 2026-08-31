# OvertChat Voice third-party notices

OvertChat Voice incorporates the following direct open-source components. The
image labels record the exact source or model revisions used by the build.

## Hugging Face speech-to-speech

- Source: https://github.com/huggingface/speech-to-speech
- Revision: `3986f453012a131632eee4731995474046846794`
- License: Apache License 2.0
- License in image: `/opt/overtchat/licenses/speech-to-speech.LICENSE`

OvertChat packages the pinned source with a separately curated dependency set
and runtime configuration. It does not modify the copied upstream source.

## Silero VAD

- Source: https://github.com/snakers4/silero-vad
- Revision: `867c2aa692646a1f1de3e94a15c9dd9f614c0acb`
- License: MIT
- License in image:
  `/opt/overtchat/models/torch/hub/snakers4_silero-vad_master/LICENSE`

## Smart Turn v3.2

- Model: https://huggingface.co/pipecat-ai/smart-turn-v3
- Revision: `f766f81d3cfdf7737ac64aad813d91bbfd56bf93`
- License: BSD 2-Clause
- License in image: `/opt/overtchat/licenses/SMART-TURN.LICENSE`

## Python and operating-system packages

The image also redistributes the packages pinned by `requirements.txt`, their
transitive dependencies, CPU-only PyTorch and Torchaudio wheels, and packages
from the Debian and Python base images. Python distribution license metadata is
retained in the virtual environment's `*.dist-info` directories. Release SBOMs
should be used as the authoritative inventory for the complete transitive
package set.
