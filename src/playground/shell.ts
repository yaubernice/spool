/** The studio document. Behavior lives in main.ts; this is only the regions. */
export const studioHtml = `
<div class="ide">
  <header class="topbar">
    <div class="brand">
      <span id="mascot-slot" class="mascot-slot" aria-hidden="true"></span>
      <span class="word">Spool</span>
    </div>
    <div id="file-name" class="crumb">Welcome</div>
    <button id="palette-open" class="command" type="button" aria-label="Search files and commands">
      <i data-lucide="search"></i>
      <span>Search files, run a command...</span>
      <kbd>⌘K</kbd>
    </button>
    <div class="title-actions">
      <button id="panel-side" type="button" title="Projects" aria-label="Open projects"><i data-lucide="files"></i></button>
      <button id="focus-toggle" type="button" title="Focus mode" aria-label="Focus mode"><i data-lucide="maximize"></i></button>
      <button id="theme" type="button" title="Toggle theme" aria-label="Toggle color theme"><i data-lucide="sun"></i></button>
      <button id="settings-open" type="button" data-activity="settings" title="Settings" aria-label="Settings"><i data-lucide="settings"></i></button>
    </div>
  </header>
  <div class="workspace">
    <aside class="drawer" id="sidepanel" aria-label="Projects">
      <div class="drawer-bar">
        <button type="button" data-activity="explorer" class="active">Gallery</button>
        <button type="button" data-activity="search">Search</button>
        <button type="button" data-activity="settings">Settings</button>
        <span class="grow"></span>
        <button id="view-mode" type="button">List</button>
        <button id="new-file" type="button" title="New file" aria-label="New file"><i data-lucide="plus"></i></button>
      </div>
      <div class="side-view" data-view="explorer">
        <input id="filter" class="field" type="search" placeholder="Filter projects" aria-label="Filter projects" />
        <div class="side-actions">
          <button id="duplicate-file" type="button">Duplicate</button>
          <button id="reset-file" type="button">Reset</button>
        </div>
        <div id="tree" class="tree"></div>
      </div>
      <div class="side-view" data-view="search" hidden>
        <input id="search-box" class="field" type="search" placeholder="Find an example" aria-label="Search examples" />
        <div id="search-list" class="tree"></div>
      </div>
      <div class="side-view" data-view="settings" hidden>
        <div class="settings">
          <label>Seed <input id="seed" type="number" step="1" value="1" /></label>
          <label>Auto run <input id="auto-run" type="checkbox" checked /></label>
          <label>Constant folding <input id="pass-fold" type="checkbox" checked /></label>
          <label>Dead-code elimination <input id="pass-dce" type="checkbox" checked /></label>
          <label>Minimap <input id="minimap" type="checkbox" /></label>
          <label>Mascot <input id="mascot-on" type="checkbox" checked /></label>
          <label>Speech bubbles <input id="bubbles-on" type="checkbox" checked /></label>
          <label>Mascot size
            <select id="mascot-size" aria-label="Mascot size">
              <option value="small">Small</option>
              <option value="medium">Medium</option>
            </select>
          </label>
          <button id="panel-bottom" type="button">Toggle the bottom drawer</button>
        </div>
      </div>
      <div class="split drawer-edge" id="split-side" role="separator" aria-orientation="vertical" aria-label="Resize projects"></div>
    </aside>
    <div class="stage-row">
      <section class="card editor-pane" id="editor-pane">
        <div class="file-tabs" id="file-tabs" role="tablist" aria-label="Open files"></div>
        <button id="focus-exit" class="focus-exit" type="button">Exit focus</button>
        <div id="welcome">
          <h2>Welcome</h2>
          <p>Undo is already playing. Dodge the blocks, grab the gems, and press space to rewind two seconds once the bar has filled.</p>
          <ol class="hints">
            <li>Drag the timeline under the game to scrub time.</li>
            <li>Alt-click a number in the code to change it while the game runs.</li>
            <li>Click a game object to inspect it. Press the preview once so it can hear the keyboard.</li>
          </ol>
          <pre class="glance">each b in Ball { b.pos += b.vel * dt }
on key "space" { if energy &gt; 40 { rewind 2s } }</pre>
          <p class="quiet">Pong is 35 lines. The same game on a plain canvas is 53 lines of JavaScript, without sound.</p>
          <div class="welcome-grid" id="welcome-links"></div>
        </div>
        <div id="editor" class="editor" hidden></div>
      </section>
      <div class="split split-x" id="split-x" role="separator" aria-orientation="vertical" aria-label="Resize preview"></div>
      <section class="card preview" id="preview" aria-label="Preview">
        <div class="stage-frame" id="stage-frame">
          <div id="skeleton" class="skeleton" aria-hidden="true"></div>
          <canvas id="canvas" tabindex="0" aria-label="Game preview"></canvas>
          <div id="play-overlay" class="play-overlay" role="button" tabindex="-1"><span>Click to play</span></div>
          <div class="tool-pill" role="toolbar" aria-label="Playback">
            <button id="run" class="tool accent" type="button" title="Run" aria-label="Run"><i data-lucide="play"></i><span>Run</span></button>
            <button id="pause" class="tool" type="button" title="Pause" aria-label="Pause"><i data-lucide="pause"></i><span>Pause</span></button>
            <button id="continue" class="tool" type="button" title="Resume" aria-label="Resume"><i data-lucide="rotate-ccw"></i><span>Resume</span></button>
            <button id="step" class="tool" type="button" title="Step" aria-label="Step"><i data-lucide="skip-forward"></i><span>Step</span></button>
            <button id="stop" class="tool" type="button" title="Stop" aria-label="Stop"><i data-lucide="square"></i><span>Stop</span></button>
            <label class="tool speed" title="Speed">Speed <input id="speed" type="range" min="1" max="8" value="6" aria-label="Speed" /></label>
            <button id="mute" class="tool" type="button" title="Sound is off" aria-label="Toggle sound" aria-pressed="true"><i data-lucide="volume-x"></i><span>Mute</span></button>
            <button id="fullscreen" class="tool" type="button" title="Fullscreen" aria-label="Fullscreen"><i data-lucide="maximize"></i><span>Fullscreen</span></button>
            <div class="menu">
              <button id="debug-menu" class="tool" type="button" title="Debug" aria-label="Debug options" aria-expanded="false"><i data-lucide="bug"></i><span>Debug</span></button>
              <div class="menu-pop" id="debug-pop" hidden>
                <label><input id="dbg-bounds" type="checkbox" /> Entity bounds</label>
                <label><input id="dbg-labels" type="checkbox" /> Entity labels</label>
                <label><input id="dbg-velocity" type="checkbox" /> Velocity</label>
                <label><input id="dbg-grid" type="checkbox" /> Grid</label>
                <label><input id="dbg-fps" type="checkbox" /> FPS</label>
              </div>
            </div>
            <button id="export" class="tool" type="button" title="Export" aria-label="Export"><i data-lucide="download"></i><span>Export</span></button>
          </div>
          <div id="guide" class="guide" hidden>
            <p id="guide-text"></p>
            <div class="guide-actions">
              <button id="guide-next" type="button">Next</button>
              <button id="guide-dismiss" type="button">Dismiss</button>
            </div>
          </div>
          <span id="hint" class="hint" hidden></span>
          <span id="hud" class="hud" hidden>0 fps</span>
          <div id="mascot-float" class="mascot-float"></div>
        </div>
        <div class="timeline">
          <button id="scrub-play" type="button" title="Pause the timeline" aria-label="Pause the timeline"><i data-lucide="pause"></i></button>
          <button id="back" type="button" title="Step back" aria-label="Step back"><i data-lucide="chevron-left"></i></button>
          <div class="track">
            <div id="ticks" class="ticks"></div>
            <input id="timeline" type="range" min="0" max="0" value="0" aria-label="Rewind timeline" />
          </div>
          <button id="forward" type="button" title="Step forward" aria-label="Step forward"><i data-lucide="chevron-right"></i></button>
          <span id="time-readout" class="time">0:00.00</span>
          <span id="trace-note" class="trace-note"></span>
        </div>
        <span id="run-state" class="trace-note"></span>
      </section>
    </div>
    <div class="split split-y" id="split-y" role="separator" aria-orientation="horizontal" aria-label="Resize bottom drawer"></div>
    <section class="card bottom" id="bottom">
      <div class="panel-tabs" role="tablist" aria-label="Panels">
        <button type="button" class="panel-tab" data-tab="problems">Problems <span class="count" id="problems-count">0</span></button>
        <button type="button" class="panel-tab active" data-tab="output">Output</button>
        <button type="button" class="panel-tab" data-tab="tokens">Tokens</button>
        <button type="button" class="panel-tab" data-tab="ast">AST</button>
        <button type="button" class="panel-tab" data-tab="bytecode">Bytecode</button>
        <button type="button" class="panel-tab" data-tab="entities">Entities</button>
        <button type="button" class="panel-tab" data-tab="variables">Variables</button>
        <button type="button" class="panel-tab" data-tab="stack">Call stack</button>
        <button type="button" class="panel-tab" data-tab="bench">Bench</button>
      </div>
      <pre id="banner" class="banner" hidden></pre>
      <div class="tab-body">
        <div class="tab-pane" data-pane="problems" hidden><div id="problems"></div></div>
        <div class="tab-pane" data-pane="output">
          <div class="pane-tools">
            <button id="out-clear" type="button">Clear</button>
            <button type="button" data-log="all" class="active">All</button>
            <button type="button" data-log="print">Print</button>
            <button type="button" data-log="error">Errors</button>
          </div>
          <div id="output-log"></div>
        </div>
        <div class="tab-pane" data-pane="tokens" hidden></div>
        <div class="tab-pane" data-pane="ast" hidden></div>
        <div class="tab-pane" data-pane="bytecode" hidden><div id="bytecode-view"></div></div>
        <div class="tab-pane" data-pane="entities" hidden></div>
        <div class="tab-pane" data-pane="variables" hidden></div>
        <div class="tab-pane" data-pane="stack" hidden></div>
        <div class="tab-pane" data-pane="bench" hidden>
          <button id="bench-run" type="button">Run benchmarks</button>
          <p id="bench-fold" class="pane-note"></p>
          <p id="bench-status" class="pane-note">Tree-walk, the VM, and the VM with both passes. Each time is the median of several runs. The page stays responsive.</p>
          <div id="bench-table"></div>
        </div>
      </div>
      <form id="repl" class="repl" autocomplete="off">
        <div id="repl-log" class="repl-log" aria-live="polite"></div>
        <div class="repl-row">
          <span class="prompt" aria-hidden="true">›</span>
          <input id="repl-input" type="text" spellcheck="false" aria-label="Evaluate a Spool expression" placeholder="Ball.count" />
        </div>
        <div id="repl-suggest" class="repl-suggest" hidden></div>
      </form>
    </section>
  </div>
  <footer class="statusbar" aria-label="Status">
    <span id="stat-pos">1:1</span>
    <span id="stat-sel">no selection</span>
    <span id="stat-lang">Spool</span>
    <span id="stat-tokens">0 tokens</span>
    <span id="stat-nodes">0 nodes</span>
    <span id="stat-ms">—</span>
    <span id="stat-frame">—</span>
    <span id="stat-entities">0 entities</span>
    <span id="stat-steps">0 steps</span>
    <span id="stat-depth">depth 0</span>
    <button id="stat-problems" type="button" title="Open Problems">0 problems</button>
  </footer>
</div>
<div id="palette" class="palette" hidden>
  <div class="palette-card" role="dialog" aria-label="Command palette">
    <input id="palette-input" type="text" placeholder="Search files, run a command..." aria-label="Command" />
    <div id="palette-list" class="palette-list"></div>
  </div>
</div>
<div id="sheet" class="sheet" hidden>
  <div class="sheet-card" role="dialog" aria-label="Keyboard shortcuts">
    <h2>Keyboard shortcuts</h2>
    <table>
      <tr><td>Cmd/Ctrl+K</td><td>Command bar</td></tr>
      <tr><td>Cmd/Ctrl+Enter</td><td>Run</td></tr>
      <tr><td>Cmd/Ctrl+S</td><td>Save this file in the browser</td></tr>
      <tr><td>Cmd/Ctrl+B</td><td>Open or close projects</td></tr>
      <tr><td>Cmd/Ctrl+J</td><td>Open or close the bottom drawer</td></tr>
      <tr><td>Cmd/Ctrl+.</td><td>Focus mode</td></tr>
      <tr><td>Alt+Left / Alt+Right</td><td>Step the timeline</td></tr>
      <tr><td>R</td><td>Rewind while the preview is focused</td></tr>
    </table>
    <button id="sheet-close" type="button">Close</button>
  </div>
</div>
<div id="toast" class="toast" hidden role="status"></div>
`
