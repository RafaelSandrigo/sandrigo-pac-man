# Pac-Man

A faithful recreation of the original 1980 Pac-Man arcade game, built with plain
HTML, CSS and JavaScript. No frameworks, no build step and no image or audio files.
The whole game lives in three files.

## Features

- **Original maze**, drawn pixel by pixel at the arcade's native 224×288
  resolution: 240 dots, 4 power pellets, double-line border and ghost house.
- **Arcade ghost AI**: Blinky chases you directly, Pinky aims 4 tiles ahead
  (including the original "looking up" bug), Inky uses Blinky's position, and Clyde
  backs off when he gets close.
- **Scatter/chase waves** with per-level timings, Blinky's "Cruise Elroy" speed-up,
  tunnel slowdown and the original no-up-turn zones.
- **Ghost house release rules**: per-ghost dot counters, a global counter after
  losing a life and an idle timer.
- **Per-level tables** for speeds, fright time and flashes, following the arcade.
- **Bonus fruits** (cherry to key) with the original point values, plus an extra
  life at 10,000 points.
- **Attract screen** with the "CHARACTER / NICKNAME" intro and a chase scene.
- **Synthesized sound** (Web Audio API): intro music, waka-waka, siren, fright,
  returning eyes, death, fruit and extra life.
- **Pause menu** (ESC) with Resume, Restart and Home.
- **Score reporting** to a parent page via `postMessage` (see below).
- **Keyboard and touch** (swipe) controls.

## Running

Open `index.html` in a modern browser. Or serve the folder locally:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

The arcade font (Press Start 2P) loads from Google Fonts. Without an internet
connection the game still runs, using a fallback monospace font.

## Controls

| Action        | Keyboard                | Touch                 |
|---------------|-------------------------|-----------------------|
| Start         | Enter / Space           | Tap the screen        |
| Move          | Arrow keys / WASD       | Swipe                 |
| Menu          | ESC                     | `II` button (top right) |
| Quick pause   | P                       | —                     |
| Sound on/off  | M                       | —                     |

**Pause menu:** use ↑/↓ (or W/S) to choose and Enter to confirm. Press ESC again to
resume. The menu also opens on its own when the window loses focus.

| Option  | What it does                          |
|---------|---------------------------------------|
| RESUME  | Continues the current game            |
| RESTART | Starts a new game from level 1        |
| HOME    | Returns to the attract (home) screen  |

**Game over:** press **S** (or click **SAVE SCORE**) to report the score, and
**Enter** (or **PLAY AGAIN**) to start over.

## Score integration

When the player chooses **SAVE SCORE** on the game over screen, the game sends this
message to the parent window, once per game:

```js
window.parent.postMessage(
  { source: "bitman", version: 1, type: "game-over", score: Math.floor(score) },
  "*"
);
```

To receive it on the host page that embeds the game in an `<iframe>`:

```js
window.addEventListener("message", (event) => {
  const data = event.data;
  if (data?.source === "bitman" && data.type === "game-over") {
    console.log("Final score:", data.score);
  }
});
```

## Project structure

```
index.html   Page markup: canvas, pause menu and game over screen
style.css    Layout, scaling and menu styles
script.js    Game logic, rendering, sound and input
```

## Technical notes

- The game logic runs on a **fixed 60 fps timestep**, independent of the monitor's
  refresh rate.
- Rendering happens at **224×288**, then the canvas is scaled up by an integer
  number of device pixels with `image-rendering: pixelated`, so every pixel stays
  the same size. On screens too small for 2×, the game uses the largest size that
  fits.
- Maze walls are **generated from the tile layout**. Each wall tile classifies its
  neighbors as wall, corridor or void and draws 1px lines at the arcade's positions.
- Speeds, timers and AI rules are based on Jamey Pittman's *The Pac-Man Dossier*.

## License

The source code is released under the [MIT License](LICENSE).

## Disclaimer

Pac-Man is a trademark of Bandai Namco Entertainment Inc. This is a non-commercial
fan recreation made for study purposes and is not affiliated with Bandai Namco.
