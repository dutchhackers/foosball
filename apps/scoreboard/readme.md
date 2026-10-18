# scoreboard

Live foosball scoreboard (vanilla TypeScript, no framework) with [WebMCP](https://webmachinelearning.github.io/webmcp/) tools, so an in-browser AI agent can keep score by voice.

| Tool          | What it does on screen                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `start_match` | Resolves the spoken names against `GET /players` and shows the two teams (1v1 or 2v2).                     |
| `record_goal` | Adds a point (optionally with the scorer, or as an own goal) and appends it to the goal log.               |
| `undo_goal`   | Removes the last goal, for when speech recognition got it wrong.                                           |
| `end_match`   | `consequentialHint`. Opens the "Save this result?" dialog. Only a person pressing Submit saves the result. |

Submitting sends the same request as a manual entry: `POST /match-results` (`red` = home, `blue` = away).

## Run locally

```sh
nx build scoreboard
python3 -m http.server 4610 --directory dist/apps/scoreboard
```

- `http://127.0.0.1:4610/?mock=1` uses fictional players and never saves. In mock mode the tool executors are also exposed as `window.__scoreboardTools` for demos in browsers without WebMCP.
- Without `mock`, the page talks to the api function on the Firebase emulator (`http://127.0.0.1:5001/foosball-af8b7/europe-west1/api`). Pass `?api=` to use a different emulator URL; only `localhost`/`127.0.0.1` URLs are accepted.

The page is not wired into Firebase Hosting yet.
