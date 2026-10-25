# Blitz Learning — 60-second hackathon demo

Gemini 4 Argon supplied this 130-word draft and storyboard. Gemini 3.8 Flash-Lite TTS supplies the narration. The final edit uses actual captured app screens; architecture/roadmap cards are explanatory graphics, not simulated app behavior.

Generated narration: `reports/demo-narration.wav`, 57.96 seconds, 24 kHz mono PCM. Keep the final two seconds for the closing wordmark/URL to produce a 60-second video. Timing beats below are approximate alignment estimates from sentence word counts and FFmpeg silence gaps (−32 dB, minimum 0.18 seconds), not ASR- or phoneme-forced alignment. The approximate captions are in `docs/demo-captions.srt`; check them during final playback.

## Narration

Watching videos feels productive, until you try solving alone. Blitz Learning is our engineering prototype turning passive video watching into active math practice. On our neutral front door, future subjects say coming soon while math is playable now. Learners pick a math quest, a problem, and an original nonhuman tutor: a robot, fox, or fantasy creature. These real captured screens show controlled local practice, not live AI. An offline deterministic checker grades numeric answers: one to three consecutive correct fresh questions earn one to three stars, and errors reset streaks, not best stars. Next, our architecture pairs Gemini 4 Argon for explanations with Gemini Live for optional voice discussion and consented written work photos. Our roadmap adds more subjects, outcome evaluation, privacy hardening, and explicit check ins, never facial tracking.

## Capture/edit beats

| Time | Show | What it establishes |
| --- | --- | --- |
| 0–16.2s | Actual front page, Math available and other subjects Coming soon | Covers the opening problem, prototype introduction, and generic front door sentences |
| 16.2–24.0s | Select math quest, problem, and original nonhuman companion | Matches “Learners pick…” through “…fantasy creature” |
| 24.0–40.8s | Answer three fresh questions, show three stars; show wrong answer resetting streak but retaining best | Matches the controlled-local-practice disclosure and deterministic-checker/star explanation |
| 40.8–50.5s | Architecture overlay/card: local checker → Argon explanations; separate Gemini Live discussion path | Matches “Next, our architecture…” through “…written work photos” |
| 50.5–60.0s | Clearly labeled roadmap card, then closing wordmark/URL | Roadmap narration ends near 57.6s; leave the final two seconds for the closing card |

Estimated sentence speech spans: 0.28–3.79s, 4.29–10.23s, 10.82–15.98s, 16.37–23.75s, 24.12–28.98s, 29.37–40.51s, 41.11–50.24s, and 50.80–57.61s. The raw Gemini design proposal retains its original proposed timing; this edited storyboard supersedes those timing guesses for the generated WAV.

## Editing constraints

- Capture the real interface. Do not synthesize screens claiming features that are absent.
- Label controlled practice/demo mode on screen. A local answer-checking capture is not a live Gemini demonstration.
- Match shots to implemented features; if a named tutor is absent, revise the narration before publication.
- Do not record personal camera/microphone data. The camera affordance can be shown without enabling it.
- Describe attention-related work as future explicit, opt-in re-engagement checks. Faces do not establish attention or understanding.
- Do not claim validated learning improvements. This is a hackathon engineering prototype.
- Keep model-access evidence separate from app end-to-end verification. See [model evidence](model-evidence.md).

Raw Gemini design and storyboard: [gemini-design-review.json](gemini-design-review.json). Machine-readable narration and timing: [demo-script.json](demo-script.json).
