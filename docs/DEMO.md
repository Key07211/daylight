# Daylight product demo

**English** · [简体中文](DEMO.zh-CN.md)

[Open demo](https://key07211.github.io/daylight/demo.html?lang=en) · [Download offline demo](https://github.com/Key07211/daylight/releases/latest) · [App setup](../README.md#get-started) · [Codex setup](../README.md#connect-with-codex)

## Explore

The walkthrough shows tasks, reminders, liquid glass, day/night weather, desktop controls, Codex workflows, and opening animations. Use the chapter buttons to explore at your own pace, or start the guided tour.

- Day, night, and rain scenes play actual app recordings automatically. Opening scenes also play when selected.
- Use **Pause motion** for a still preview and **Play motion** to resume. System reduced-motion preferences start the page with still previews; you can choose to play.
- Switch **English / 中文** to change the page text, app captures, and sample task language.
- Select an image to enlarge it; close with the close button or Escape.

The demo has no audio. Its language, navigation, and playback controls affect only this page. It does not edit tasks, send reminders, change MCP settings, or run Codex.

## View offline

Extract `Daylight-Demo-0.3.0.zip` and open `docs/demo.html` in Edge, Chrome, or Firefox. Keep the accompanying files and `media` folder together. No app installation, local server, dependencies, or internet connection is needed.

You can also download the repository and open its `docs/demo.html` directly. English is the default; the language switch works offline.

## What the recordings show

All captures come from the actual app running with a fresh, isolated profile. Tasks, projects, dates, cities, and weather are fixed public examples. Weather in the demo is not a live forecast. Chinese assets are in `media/`; matching English assets are in `media/en/`.

The task editor and completion dialog are real interfaces. Codex remains disconnected in the captures, and its schedule is a paused draft without execution history. No real MCP connection or AI job was created for the demonstration. Opening recordings contain only the introductory scene.

In the installed app, tasks stay on the computer. Weather needs network access. Codex features need the local CLI and sign-in; scheduled execution also needs internet access and uses the Codex account allowance. Reminders and scheduled runs need the app running and the computer awake. Changing the app language does not translate your existing task text.

## Refresh and check the demo

From the repository root:

```powershell
npm ci
npm run build
.\node_modules\.bin\electron.cmd desktop/product-demo.cjs
.\node_modules\.bin\electron.cmd desktop/product-demo.cjs --english
```

To refresh only the looping app recordings:

```powershell
.\node_modules\.bin\electron.cmd desktop/product-demo.cjs --motion-only
.\node_modules\.bin\electron.cmd desktop/product-demo.cjs --motion-only --english
```

Check the walkthrough and visible motion:

```powershell
.\node_modules\.bin\electron.cmd desktop/product-demo.cjs --verify-docs
.\node_modules\.bin\electron.cmd desktop/demo-motion-smoke.cjs
```

Capture uses a temporary `.runtime/product-demo-*` profile and a random local port. External requests, scheduling, and system MCP registration are disabled. Outputs go to `docs/media`; runtime reports stay in `.runtime` and are not distributed. Motion verification compares rendered scene pixels over time.

Review both languages, all scenes, pause/play, reduced-motion behavior, keyboard controls, and narrow layouts before publishing. Use synthetic profiles for new captures.
