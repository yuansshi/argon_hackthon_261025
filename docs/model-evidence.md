# Gemini model evidence

Reviewed against Google developer documentation on October 25, 2026. Model access is project-specific; configured model names alone are not proof that a request succeeded.

## Why these models fit

- **Gemini 4 Argon** is the reasoning model for lesson explanations and design assistance. The [current model guide](https://ai.google.dev/gemini-api/docs/latest-model) documents its shared 1M-token window and adjustable thinking depth. Blitz Learning uses a bounded lesson context; it does not need to fill that window.
- The [Interactions API](https://ai.google.dev/gemini-api/docs/interactions) exposes typed execution steps and optional retained conversation state. Argon creative requests use `background: true`, `store: true`, high thinking, and a 1,000,000-token output cap. The cap is not a requested response length. Text is collected from every `model_output` step.
- [Background execution](https://ai.google.dev/gemini-api/docs/background-execution) requires storage. The creative utility persists its interaction ID in ignored local runtime state and resumes polling, rather than silently starting duplicate requests. It handles queued, in-progress, completed, requires-action, incomplete, failed, and cancelled outcomes explicitly.
- **Gemini Live** is a separate real-time conversational path, not Argon renamed. [Live API documentation](https://ai.google.dev/gemini-api/docs/live) covers bidirectional audio/video exchange. A camera frame is learner-shared material, not evidence of emotion, attention, identity, or comprehension.
- **Gemini 3.8 Flash-Lite TTS** produces the hackathon narration. The [speech generation guide](https://ai.google.dev/gemini-api/docs/speech-generation) documents transcript-only speech input, style metadata, voice selection, and default WAV output. This is generated narration over actual app footage, not a recording of live learner interaction.

## Trust boundaries

The local math answer checker—not an LLM response—determines numeric correctness, consecutive-answer streaks, and stars. AI explanations may be unavailable without preventing local practice. A narrated demonstration is not evidence of learning gains or of a real-time provider response. Learning-outcome evaluation, privacy/deployment hardening, additional subjects, and opt-in explicit re-engagement checks remain future work.

Do not infer understanding from facial appearance. Learner answers and explicit questions are the evidence used to adapt instruction. Any future re-engagement feature needs consent, validation, an accessible opt-out, and clear limits.

## Live request verification

On October 25, 2026, the actual `gemini-4-argon` design request completed successfully using the settings above. Its proposal and completion metadata are recorded in `gemini-design-review.json`. These are design recommendations, not a claim that every suggested UI feature is implemented.

The actual `gemini-3.8-flash-lite-tts` request also completed successfully and produced `reports/demo-narration.wav`. FFprobe verified a 57.96-second, 24,000 Hz mono, signed 16-bit PCM WAV (2,782,124 bytes). FFmpeg measured a mean sample volume of −16.4 dB and peak of −0.9 dB: the asset is non-silent and not sample-clipped. The narration has 130 words. A final 60-second edit can leave about two seconds for the closing title.

This verifies creative-model and TTS access, not a full deployed tutoring session or learning efficacy. No credential, raw provider diagnostic body, private learner media, or secret-bearing environment file is included in this repository.
