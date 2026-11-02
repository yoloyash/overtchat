# Native voice audio

Adapted from Speechmatics `expo-two-way-audio`, via Paseo commit
`727d5eed59bc434fdf916e8115ea9a2ca1d1f0e8`:
https://github.com/getpaseo/paseo/tree/727d5eed59bc434fdf916e8115ea9a2ca1d1f0e8/packages/expo-two-way-audio

The upstream MIT license is retained in LICENSE. This is a local Expo module,
not a separately built workspace package. Rebuild the development client after
native changes. It uses AVAudioEngine voice processing on iOS and AudioRecord /
AudioTrack with platform acoustic echo cancellation on Android.

OvertChat adaptations:
- Mono PCM16 at 24 kHz matches the existing voice sidecar, without JS resampling.
- Backgrounding and audio interruptions stop capture and playback. No automatic
  recording resume; another call requires an explicit user action.
- Expo 56 module build configuration and permission bridge compatibility.
- Android playback writes are fenced across interruption and teardown; old
  queued speech cannot write into a new response after playback is flushed.

Device validation and the foreground-only contract are documented in
[development.md](../../../../docs/development.md#mobile-realtime-voice).
