/**
 * Wrap a Spool program and the player runtime in one HTML file.
 * The runtime is a single module with no imports. The program sits in a
 * script tag the player reads when the file opens.
 */

export function gamePage(source: string, runtime: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Spool game</title>
  <style>
    html, body { margin: 0; height: 100%; background: #f4efe6; }
    canvas { display: block; width: 100%; height: 100%; background: #f4efe6; outline: none; }
    #spool-error {
      position: fixed;
      left: 12px;
      right: 12px;
      bottom: 12px;
      margin: 0;
      white-space: pre-wrap;
      color: #9b2335;
      font: 14px/1.4 ui-monospace, monospace;
    }
  </style>
</head>
<body>
  <canvas id="stage" tabindex="0" aria-label="Spool game"></canvas>
  <pre id="spool-error"></pre>
  <script type="text/spool" id="spool-game">${escapeScript(source)}</script>
  <script type="module">
${escapeScript(runtime)}
  </script>
</body>
</html>
`
}

/** Keep a `</script>` inside the program from closing the tag early. */
function escapeScript(text: string): string {
  return text.replaceAll(/<\/script/gi, '<\\/script')
}
