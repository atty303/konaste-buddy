#!/usr/bin/env -S deno run -A
// This script is used to start the INFINITAS playing sessions
// Requirements:
// - Bazzite Desktop (KDE Plasma)
// - konaste infinitas configured
// - konaste-buddy configured
// - OBS Studio configured with WebSocket
// - inf_daken_counter configured
// - twitch-cli configured

/*
Setup:
input | kwallet-query -w "OBS WebSocket" -f Passwords kdewallet
twitch token -u -s channel:manage:broadcast,user:edit
*/

import $, { KillSignalController } from "jsr:@david/dax";
import { OBSWebSocket } from "npm:obs-websocket-js";
import { getProcessCompose } from "./utils.ts";

const streamTitle =
  "Linuxに移行したので環境構築のテストプレイ [Playing on Linux]";

const processCompose = await getProcessCompose();

const companionController = new KillSignalController();

$.setPrintCommand(true);

// Get game information
const gameDefs = await $`konaste ls --json`.json() as {
  id: string;
  urlScheme: string;
  loginUrl: string;
}[];
const gameDef = gameDefs.find((g) => g.id === "infinitas");
if (!gameDef) {
  throw new Error(
    "Infinitas game not found. Please ensure it is configured in Konaste.",
  );
}

const obsWebSocketPassword =
  await $`kwallet-query -r "OBS WebSocket" -f Passwords kdewallet`.quiet(
    "stdout",
  ).text();

// Get authorization token
const runUrl =
  await $`konaste-buddy browser launch --browser /var/lib/flatpak/exports/bin/com.google.Chrome --url ${gameDef.loginUrl} --scheme ${gameDef.urlScheme}`
    .text();

// Start the game using the authorization token
$.log("Starting the game with authorization token...");
const game = $`konaste infinitas run ${runUrl}`.spawn();
$.log("Game started.");

// Wait for the pipewiresrc to be ready
// $.log("Waiting for pipewiresrc to be ready...");
// await $.withRetries({
//   count: 30,
//   delay: "1s",
//   action: async () => {
//     const pipewireState = await $`pw-dump`.json();
//     const src = pipewireState.find(
//       (
//         item: { type: string; info?: { props: { [key: string]: string } } },
//       ) => (item.type === "PipeWire:Interface:Port" &&
//         item.info?.props["object.path"] === "gamescope:capture_0"),
//     );
//     if (!src) {
//       throw new Error("Pipewiresrc not found.");
//     }
//     $.log("Pipewiresrc is ready.", src);
//   },
// });

// Start OBS
$.log("Starting OBS...");
const obsChild =
  $`/var/lib/flatpak/exports/bin/com.obsproject.Studio --disable-shutdown-check`
    .quiet()
    .signal(companionController.signal)
    .noThrow()
    .spawn();
obsChild.catch((err) => {
  $.logError("Error from OBS:", err);
});
globalThis.addEventListener("beforeunload", () => obsChild.kill());
$.log("OBS started.");

// Connect to OBS WebSocket
$.log("Connecting to OBS WebSocket...");
const obsRemote = new OBSWebSocket();
const obsConnected = await $.withRetries({
  count: 5,
  delay: "1s",
  action: async () => {
    return await obsRemote.connect("ws://localhost:4455", obsWebSocketPassword);
  },
});
$.log("OBS connected:", obsConnected);

// Start proxy
$.log("Starting OBS WebSocket proxy...");
const proxyChild = $`konaste infinitas obs-websocket-proxy`
  .signal(companionController.signal)
  .noThrow()
  .spawn();
proxyChild.catch((err) => {
  $.logError("Error from OBS:", err);
});
globalThis.addEventListener("beforeunload", () => proxyChild.kill());
$.log("OBS WebSocket proxy started.");

// Start analyzer
$.log("Starting analyzer...");
const analyzerChild = $`wine-stable_10.0-x86_64.AppImage notes_counter.exe`
  .cwd("/home/atty/Applications/inf_daken_counter")
  .signal(companionController.signal)
  .noThrow()
  .quiet()
  .spawn();
analyzerChild.catch((err) => {
  $.logError("Error from analyzer:", err);
});
globalThis.addEventListener("beforeunload", () => analyzerChild.kill());
$.log("analyzer started.");

try {
  $`sleep 10s`.noThrow();

  $.log("Workaround for capture source...");
  const sceneItems = await obsRemote.call("GetSceneItemList", {
    sceneName: "Select",
  });
  const infinitasItemId = sceneItems.sceneItems.find((item) =>
    item.sourceName === "INFINITAS"
  )?.sceneItemId as number | undefined;
  await obsRemote.call("SetCurrentProgramScene", { sceneName: "Select" });
  if (infinitasItemId) {
    $.log("Infinitas scene item found, restarting:", infinitasItemId);
    await obsRemote.call("SetSceneItemEnabled", {
      sceneName: "Select",
      sceneItemId: infinitasItemId,
      sceneItemEnabled: false,
    });
    $`sleep 1s`.noThrow();
    await obsRemote.call("SetSceneItemEnabled", {
      sceneName: "Select",
      sceneItemId: infinitasItemId,
      sceneItemEnabled: true,
    });
  }

  // Start streaming
  $.log("Starting streaming...");
  await $`twitch api patch /channels -q broadcaster_id=141025463 -q game_id=1055720961 -q title=${streamTitle} -q tags=LinuxGaming -q tags=bemani`
    .noThrow(1);
  // await $`twitch api put /users -q description="<text>";

  await obsRemote.call("StartStream");
  $.log("Streaming started.");

  try {
    // Wait for exit
    $.log("Waiting for game to exit...");
    await game;
    $.log("Game exited.");
  } finally {
    // End streaming
    $.log("Stopping streaming...");
    await obsRemote.call("StopStream");
    $.log("Streaming stopped.");
  }
} finally {
  // Close apps
  $.log("Closing companions...");
  $`sleep 5s`.noThrow();

  companionController.kill("SIGTERM");
  await $`killall notes_counter.exe`.noThrow();

  const scriptId =
    await $`qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript /home/atty/src/konaste-buddy/workflows/close-obs.js close-obs.js`
      .noThrow().text();
  await $`qdbus org.kde.KWin /Scripting/Script${
    $.rawArg(scriptId)
  } org.kde.kwin.Script.run`
    .noThrow();
  await $`qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript close-obs.js`
    .noThrow();

  $.log("Requested companions to close.");
}

$.log("Waiting for companions to exit...");
await Promise.all([
  obsChild,
  proxyChild,
  analyzerChild,
]);
$.log("Companions exited.");

// Finish the session
await $`notify-send "Infinitas session ended" "All processes have exited successfully."`;
