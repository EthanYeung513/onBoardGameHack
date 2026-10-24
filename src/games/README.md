# Games

Every game renders from a JSON spec. The AI's job is small: pick a game for a piece of onboarding content and fill in
that game's schema. The app validates the result and plays it.

## The flow

```ts
import { gameCatalogForPrompt, instantiateGame } from "@/games/core/instantiate";

// 1. Tell the model which games exist, what each is for, and the exact JSON Schema to fill in.
const catalog = gameCatalogForPrompt(); // [{ id, name, bestFor, authoringTips, jsonSchema }]

// 2. The model returns { "game": "<id>", "spec": { ... } } (as an object or JSON text).
const result = instantiateGame(modelOutput);

// 3a. Invalid? Send result.errors back to the model and retry. They read like "spec.rounds.2.answer: ...".
// 3b. Valid? Render it.
<GamePlayer game={result.game} spec={result.spec} title={result.spec.title} onComplete={saveResult} />;
```

Every game reports the same `GameResult` (score, accuracy, time, and each mistake with the right answer and its
source), so results can be stored and compared whichever game was played.

Try it by hand at `/games/playground`: paste `{ game, spec }`, press play, and invalid specs show the errors the model
would get back. `/games` lists the installed games and plays each sample.

## Adding a game

1. `src/games/<id>/spec.ts`: a Zod schema extending `gameBaseSchema` (use `.describe()` on fields, since the
   descriptions reach the model through the JSON Schema), a sample written from the onboarding pack, and a
   `GameSpecDefinition` with `bestFor` and `authoringTips`.
2. `src/games/<id>/<Name>Game.tsx`: a client component taking `GameProps<Spec>`. Render only from the spec, call
   `onComplete` once, and honour `instant` (skip animations, used by tests and reduced motion).
3. Add the id to `GameId` in `core/types.ts`, and fill in your placeholder lines in `catalog.ts` and
   `components.tsx`.

Shared helpers: `core/random.ts` (seeded shuffle), `core/useTypewriter.ts`, `core/sound.ts` (synthesised effects and
remote clips), `core/GameResults.tsx`.

## Content

`content/mubit-onboarding/` holds the synthetic Mubit onboarding pack (PDFs and text extracts) the samples are written
from. Each sample item cites its document and section.

## Generating a game from a course

`POST /api/games/instance` turns a course (a content pack: `{ "packId": "...", "game": "<id?>" }`) into a
`{ game, spec }` through the `generate-game` task. The spec is regenerated on every call, so when the dashboard
changes a course's documents, the next game's dialogue reflects the new content. Omit `game` to let the model pick.
`GET /api/games` lists the installed games for the dashboard. Play a generated spec at `/games/<id>?pack=<packId>`.
Like `generate`, it goes through Mubit when `MUBIT_API_KEY` is set and a deterministic writer offline.
