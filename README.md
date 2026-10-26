# Blitz Learning

Short quests. Thoughtful AI help. Progress you can explain.

Blitz Learning turns a passive lesson into an active practice session: choose a problem-solving quest, pick a fictional tutor, try a question, and ask for a different explanation when you get stuck. The front door is subject-neutral; **math is available now**. Other subjects are clearly marked as coming soon.

This is an **adult foundational-learning hackathon prototype**, not a production service or a claim of proven learning gains. The original narrated video is not required or distributed with this project.

## Try it on the web

[Open the GitHub Pages practice demo](https://yuansshi.github.io/argon_hackthon_261025/).

The hosted site supports all four math quests, original tutor characters, authored hints, browser-checked answers, and best-star progress on your device. It also links to the 60-second demo. The static version uses the same authored math rules as the local app, but its browser-side achievements are not tamper-resistant or proof of mastery.

**Gemini chat, voice, and camera are not available on GitHub Pages.** They need the local Node.js backend and a project-designated server-side credential. The hosted site never asks for an API key and makes no Gemini requests. See [Pages deployment](docs/PAGES.md).

## Try it locally

Requires Node.js 22 or newer.

```sh
npm ci
npm start
```

Open **http://127.0.0.1:8791/**. Local checked practice works without a Gemini credential or external internet connection, while the local server remains running. It is not an installed offline PWA.

For AI help, configure a credential **explicitly designated for this project**, then start the server. Do not commit credentials. Set `PROJECT_GEMINI_API_KEY` in the launching environment, or set `PROJECT_GEMINI_CREDENTIAL_FILE` to a designated local file. The app does not search global credential stores or auto-load `.env` files. See [.env.example](.env.example).

The server binds to loopback only. If the page is unavailable, start `npm start` and refresh it. The earlier Pondside Math prototype remains separate from this repository.

## What works

- Four selectable math quests: closed-loop planting, equal groups, fractions, and number patterns.
- Fresh questions with authored answers, visual representations, hints, and worked explanations.
- A three-star streak system: one, two, then three consecutive independently correct questions earn one, two, then three stars. A wrong answer resets the current streak, not the best stars already earned. Duplicate question submissions cannot earn additional stars.
- Hints and AI coaching are supported practice, not independent wins. They do not award a star for that question. Stars record practice performance, **not conceptual mastery**.
- Selectable original tutors with different coaching styles. All are disclosed as fictional AI characters; illustrated motion is approximate browser animation, not filmed actors or exact lip-sync. No private user photograph is included.
- Optional Argon explanations and Gemini Live discussion. Camera and microphone start off, require explicit permission, and stop on end/hide/quest-change paths.
- Only aggregate best-star progress is retained in browser storage. No learner images, audio, messages, or transcripts are saved by the app.

## Why it can help

A video can explain a solution without finding out whether the learner can use it. Blitz Learning asks the learner to try, gives immediate checked feedback, and offers a smaller step or alternative explanation. Short quests make progress visible; the learner controls the pace and can change the problem or tutor.

The design supports active practice and targeted feedback. Whether it improves learning or retention still needs evaluation with real adult learners and unfamiliar transfer problems. Three stars alone do not establish understanding.

## Why Gemini fits

| Responsibility | Implementation | Why separate it |
| --- | --- | --- |
| Verify answers and award stars | Authored local math rules | Model errors cannot create achievements. |
| Explain a misconception another way | `gemini-4-argon`, Interactions API, high thinking, background execution | Bounded problem context supports careful reasoning; asynchronous jobs keep the request resumable. |
| Discuss a question aloud or show written work | `gemini-3.8-live` via a same-origin relay | Low-latency audio/vision is a different task from background reasoning. |
| Design assistance and demo narration | Argon design review; `gemini-3.8-flash-lite-tts` | The hackathon video uses real app captures with generated narration, not fabricated app footage. |

Argon requests use `background: true`, `store: true`, `thinking_level: high`, and a 1,000,000-token cap under the current project preference. The cap is not a request to generate a million tokens. Context is bounded; all `model_output` text parts are collected. Pending jobs retain their interaction IDs rather than silently submitting duplicates.

Model availability depends on project access. [Model evidence](docs/model-evidence.md) distinguishes successful creative-model calls from application end-to-end tests. [Gemini's design proposal](docs/gemini-design-review.json) is input to the design, not a promise that every recommendation shipped.

Official references: [Argon](https://ai.google.dev/gemini-api/docs/latest-model), [Interactions](https://ai.google.dev/gemini-api/docs/interactions), [background execution](https://ai.google.dev/gemini-api/docs/background-execution), [Live API](https://ai.google.dev/gemini-api/docs/live-api), and [speech generation](https://ai.google.dev/gemini-api/docs/speech-generation).

## Privacy and limits

Local practice does not call Google. Before AI help, the app asks for adult/cloud consent. Submitted text, and explicitly enabled microphone/camera inputs, go to Google. A camera is for intentionally sharing written work—not for inferring attention, emotion, identity, age, disability, or understanding from someone's face or voice.

Provider handling and retention depend on the Gemini project and [Google's terms](https://ai.google.dev/gemini-api/terms). Ending a session clears local state; it does not erase Google's records. Background Interactions require provider storage. No zero-retention promise is made.

This prototype has no production authentication, accounts, verified age assurance, durable server progress, or publicly hosted AI backend. GitHub Pages hosts browser-only practice. An age checkbox is not a child-directed deployment solution. Any future child-facing use requires a provider and deployment that explicitly permit it. Do not expose the development server publicly.

## Pending work

- More subjects and reviewed question banks, difficulty selection, and spaced review.
- Teach-back and transfer-question evaluation beyond numeric correctness.
- Adult learner studies measuring retention, clarity, accessibility, and tutor preferences.
- Production authentication, account-level progress, rate/cost controls, and privacy/deployment review.
- Better synchronized character animation and broader hardware/browser testing.
- Optional re-engagement check-ins based on explicit learner responses and inactivity—not a claim that live video can verify attention. Any future camera-based research needs separate consent, validation, and a usable camera-free alternative.

## Verification and demo

```sh
npm test
```

Automated tests use injected fakes; they need no credentials, camera, microphone, or billable provider requests. Application and recording evidence is documented in [verification](docs/VERIFICATION.md).

Watch the [60-second narrated demo](demo/blitz-learning-60s.mp4). The [demo script](docs/demo-script.md) separates real captured local practice from explanatory architecture and roadmap shots. Gemini calls used to generate design/narration are implemented in [the reusable creative utility](scripts/gemini-creative.mjs). They require explicit project credentials and may incur charges.

## Assets

See [asset provenance](docs/ASSETS.md). No original Chinese lecture footage, user photograph, credential file, raw camera capture, or private learner recording is part of this repository.
