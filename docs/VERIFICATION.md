# Verification — October 25, 2026

## Automated checks

The combined offline suite passes **97 tests**. It uses injected fakes, not project credentials or hardware. Coverage includes authored quest math, equivalent fractions, single-use question tokens, independent streaks, preserved best stars, uncertain/hinted/coached answer exclusions, selected-tutor changes, Argon request/result validation, bounded resumable jobs, Live consent/host/session gates, coaching-to-score binding, stale async work, media cleanup, canonical diagram quantities, and reduced-motion-aware SVG tutors.

## Real provider checks

[Sanitized smoke evidence](../reports/blitz-provider-smoke.json) records **13 passed checks**, using synthetic adult math requests through the same local routes as the app:

- Argon completed selected fractions/Pip coaching with structured feedback, explanation and a follow-up question. It could not award stars.
- Gemini Live produced 647,040 bytes of 24 kHz mono PCM and transcription for selected fractions/Pip. No pond scene tool ran for a fractions quest.
- Real Live coaching marked the active question ineligible for stars server-side.
- Every owned test session ended. No audio, transcript, camera input or pending interaction state was retained in the published report.

The separate [model evidence](model-evidence.md) records successful Gemini design and TTS calls. Creative-model access is not a substitute for these app-route tests.

## Browser checks

Actual browser checks covered the subject-neutral home, Coming soon labels, quest/tutor choice, local consent, fraction visuals, accepted equivalent fractions, wrong-answer streak reset with best-star retention, progression to three stars, and the results dialog. The tutor occupies a separate rail rather than overlapping the problem. A 375×812 phone home check showed no horizontal overflow. Desktop checks used 1280×720, including a compact learning layout.

The recorded local practice session answered five fresh fraction questions: correct, incorrect, correct, correct, correct. It earned a best streak of three and displayed the three-star results dialog. No cloud, microphone or camera input was enabled in the capture.

## Demo

[`demo/blitz-learning-60s.mp4`](../demo/blitz-learning-60s.mp4) contains actual app viewport captures edited to exactly 60 seconds, Gemini-generated English narration, and selectable approximate-timing English captions. Video is H.264, 1280×720, 30 fps; source browser captures were 6 fps. The architecture and roadmap are actual explanatory app sections, not fabricated feature demonstrations. [Capture manifest](../reports/demo-capture-manifest.json).

## Not verified / pending

- Real learner sessions, retention/transfer outcomes, measured learning gains, and exhaustive accessibility evaluation.
- Physical microphone/camera permissions, denial behavior across every browser, noisy-room speech, sustained latency, and production-scale costs.
- Production authentication, account storage, verified age assurance, multi-user hosting, and privacy/deployment review.
- Camera-based attention detection. The app does not infer attention or understanding from faces; future re-engagement work should use explicit, opt-in learner check-ins and validated, accessible alternatives.

An automated test pass or three-star score is not proof of conceptual understanding or production readiness.
