/* ---------- inspect ----------
   Three states of one glass object: Away (nothing drawn but the framed
   variant), Gathered (the island bar + edge chevrons wake on approach) and
   Grown (the Input docks into the island). The state lives as classes on
   #inspect itself. */
function ispState() {
  return inspect.classList.contains('grown') ? 'grown'
    : inspect.classList.contains('gathered') ? 'gathered' : 'away';
}
var ispScatterT = null;
function ispGather() {
  clearTimeout(ispScatterT);
  if (!inspect.classList.contains('gathered')) trace('inspect:gather');
  inspect.classList.add('gathered');
}
function ispScatterSoon() {
  if (inspect.classList.contains('grown') || ispScrub) return;
  clearTimeout(ispScatterT);
  ispScatterT = setTimeout(function () {
    if (!inspect.classList.contains('grown') && !ispAspect.classList.contains('open') && !ispScrub) {
      inspect.classList.remove('gathered');
    }
  }, 500);
}

function ispPaintPick() {
  if (state.inspectId == null) return;
  var won = winnerNodeId() === state.inspectId;
  ispPickLabel.textContent = won ? 'Winner' : 'Pick this one';
  ispPickCheck.style.display = won ? 'block' : 'none';
  ispPick.classList.toggle('won', won);
  // the winner's hand-off lives here: a fresh agent gets the prompt, not the fleet
  ispCopyPrompt.style.display = won ? '' : 'none';
}
/* the pick hand-off: a prompt a FRESH agent session can start from — it names
   where the winning mockup lives and how to see it, so no bloated fleet
   context is ever needed to implement the design */
function buildPickPrompt(n) {
  var t = null;
  for (var i = 0; i < TASKS.length; i++) if (TASKS[i].slug === TASK) t = TASKS[i];
  // a worktree variant's code already exists as a real commit — the hand-off
  // is a cherry-pick, not a rebuild-from-mockup
  if (n.commit) {
    return 'Land a UI design that was chosen on a Composer board into this project.\n\n' +
      'Task: "' + (t ? t.title : TASK) + '"\n' +
      'Winning variant: "' + n.name + '"' + (n.description ? ' — ' + n.description : '') + '\n\n' +
      'The winning code was built in this repository and committed as ' + n.commit + ' (kept alive under refs/composer/, off any branch).\n\n' +
      'Start from `git show ' + n.commit + '` to see the diff, then land it on the current branch — `git cherry-pick ' + n.commit + '` if it applies cleanly, otherwise apply the diff by hand. It was built as a demo variant: review it for demo shortcuts (partially wired interactions, trimmed data) and finish those against the real data and conventions before considering it done.\n\n' +
      'The variant\'s capture (screenshot/recording) is at ' +
      (DIR ? DIR + '/' + TASK + '/variants/' : '.composer/' + TASK + '/variants/') +
      ' if you want to see what was approved.';
  }
  var where = n.url
    ? 'The chosen design runs live at ' + n.url + ' (a route on this project\'s dev server).'
    : 'The chosen design is a self-contained HTML mockup at:\n' +
      (DIR ? DIR + '/' + TASK + '/variants/' + n.id : '.composer/' + TASK + '/variants/' + n.id);
  return 'Implement a UI design that was chosen on a Composer board into this project\'s real codebase.\n\n' +
    'Task: "' + (t ? t.title : TASK) + '"\n' +
    'Winning variant: "' + n.name + '"' + (n.description ? ' — ' + n.description : '') + '\n\n' +
    where + '\n\n' +
    'Before writing any code, open it in a browser and take screenshots (a desktop width and a narrow one) so you know exactly what you are building — treat its layout, spacing, typography and interactions as the spec. The mockup is backend-free: wire it to the project\'s real data, routes and components, following the codebase\'s existing conventions rather than pasting the mockup wholesale.\n\n' +
    'The sibling files in that same variants/ folder are the other explored directions — useful context for what was rejected, but only this one was picked.';
}
function copyPickPrompt() {
  var n = byId(winnerNodeId());
  if (!n) return;
  var text = buildPickPrompt(n);
  trace('pick:copy-prompt', { id: n.id });
  var done = function () { toast('Prompt copied — paste it into a fresh agent session'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
  } else { fallbackCopy(text); done(); }
}
function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
}
/* the edge zones walk the same sibling list as ←/→; the ends are walls */
function ispPaintNav() {
  var n = byId(state.inspectId);
  if (!n) return;
  var sibs = navSiblingsOf(n), i = sibs.indexOf(n);
  ispPrev.disabled = i <= 0;
  ispNext.disabled = i < 0 || i >= sibs.length - 1;
}

function openInspect(id) {
  var n = byId(id);
  if (!n) return;
  trace('inspect:open', { id: id });
  var prev = (!inspect.hidden && state.inspectId != null && state.inspectId !== id) ? byId(state.inspectId) : null;
  state.inspectId = id;
  inspect.hidden = false;
  ispPaintPick();
  ispPaintNav();
  buildInspFrame(n);
  setAspect(currentAspect);
  /* the slide-and-fade that sells a variant change */
  if (prev) {
    ispFrame.classList.add(n.x >= prev.x ? 'slip-right' : 'slip-left');
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      ispFrame.classList.remove('slip-left', 'slip-right');
    }); });
  }
}
function buildInspFrame(n) {
  ispFrame.innerHTML = '';
  var f = document.createElement('iframe');
  if (n.url) {
    // live route on the project's dev server — can't inject the pause hook
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    f.src = n.url;
    ispPause.disabled = true;
  } else {
    f.setAttribute('sandbox', 'allow-scripts');
    f.srcdoc = withPause(withBase(n.html));
    ispPause.disabled = false;
  }
  ispFrame.appendChild(f);
  inspIframe = f;
  insPausedState = false;
  ispRenderPause();
  // recording cards (worktree mode) embed a video next to the file — offer it
  var vm = !n.url && n.html ? n.html.match(/<video[^>]*\ssrc="([^"]+)"/i) : null;
  ispVideoSrc = vm ? vm[1] : null;
  document.getElementById('ispVid').style.display = ispVideoSrc ? '' : 'none';
}
var ispVideoSrc = null;
function downloadInspVideo() {
  if (!ispVideoSrc || state.inspectId == null) return;
  trace('inspect:video-download', { id: state.inspectId });
  var a = document.createElement('a');
  // relative srcs live next to the variant file, served by the /v/ asset route
  a.href = /^[a-z]+:|^\//i.test(ispVideoSrc) ? ispVideoSrc : '/v/' + SESSION + '/' + TASK + '/' + ispVideoSrc;
  a.download = SESSION + '-' + ispVideoSrc.split('/').pop();
  a.click();
  toast('Video downloading…');
}
/* the frame is CSS-sized off its aspect ratio — setting it is two custom props */
function setAspect(a) {
  if (a !== currentAspect) trace('inspect:aspect', { aspect: a });
  currentAspect = a;
  var kids = ispAspect.children;
  for (var i = 0; i < kids.length; i++) kids[i].classList.toggle('on', kids[i].getAttribute('data-a') === a);
  var parts = a.split(':'), wr = +parts[0], hr = +parts[1];
  ispFrame.style.setProperty('--ar', wr + '/' + hr);
  ispFrame.style.setProperty('--arn', wr / hr);
}
function ispSetPopOpen(v) {
  ispAspect.classList.toggle('open', !!v);
  ispAspectBtn.classList.toggle('on', !!v);
}
function closeInspect() {
  if (state.inspectId != null) trace('inspect:close', { id: state.inspectId });
  closeInspectIterate();
  ispSetPopOpen(false);
  clearTimeout(ispScatterT);
  inspect.classList.remove('gathered');
  inspect.hidden = true;
  state.inspectId = null;
  ispFrame.innerHTML = '';
  inspIframe = null;
}
/* the Input docks INTO the island: the same glass object grows a composer */
function openInspectIterate() {
  if (state.inspectId == null) return;
  select(state.inspectId); // docked iterate is about the inspected variant only
  composer.classList.add('in-inspect');
  ispGrow.appendChild(composer);
  inspect.classList.add('grown');
  ispGather();
  cmpLayout(true);   // docked, the resting field is wider — re-decide the state
  syncComposer();
  cmpInput.focus();
}
function closeInspectIterate() {
  inspect.classList.remove('grown');
  if (composer.parentNode === ispGrow) document.body.insertBefore(composer, inspect);
  composer.classList.remove('in-inspect');
  cmpLayout(true);
  syncComposer();
  ispScatterSoon();
}
/* Esc peels one layer at a time: iterate panel, then overlay, then selection */
function escAction() {
  // fullscreen is the outermost layer — the browser exits it on Esc; don't also peel the overlay
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  // the model card is the shallowest thing open — Esc folds it before anything else
  if (composer.classList.contains('dialopen')) { cmpSetDialOpen(false); return; }
  if (ispAspect.classList.contains('open')) { ispSetPopOpen(false); return; }
  if (composer.classList.contains('in-inspect')) closeInspectIterate();
  else if (state.inspectId != null) closeInspect();
  else select(null);
}
/* fullscreen the frame wrapper (not the iframe) so Restart keeps working inside it */
function toggleFullscreen() {
  var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  trace('inspect:fullscreen', { on: !fsEl, id: state.inspectId });
  if (fsEl) {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } else if (state.inspectId != null) {
    if (ispFrame.requestFullscreen) ispFrame.requestFullscreen();
    else if (ispFrame.webkitRequestFullscreen) ispFrame.webkitRequestFullscreen();
  }
}
function ispRenderPause() {
  inspPaused.hidden = !insPausedState;
  ispPause.classList.toggle('on', insPausedState);
  ispPause.title = insPausedState ? 'Play' : 'Pause';
  ispPause.querySelector('svg').innerHTML = insPausedState
    ? '<path d="M7 4.5v15l13-7.5z"/>'
    : '<path d="M9 5v14M15 5v14"/>';
}
function togglePause() {
  if (!inspIframe) return;
  trace('inspect:' + (insPausedState ? 'play' : 'pause'), { id: state.inspectId });
  inspIframe.contentWindow.postMessage(insPausedState ? 'play' : 'pause', '*');
  insPausedState = !insPausedState;
  ispRenderPause();
}
/* screenshot the inspected variant to the clipboard. The frame's pixels are
   unreachable from here (sandboxed, no allow-same-origin), so the withPause
   hook injected into every srcdoc variant does the shot ITSELF: on a "shot"
   message it rasterizes its live DOM and posts the PNG back — no picker, no
   prompt. Only url variants (live dev-server routes, nothing injected there)
   and hook failures fall back to the tab-capture path below. */
var shotBusy = false, shotWait = null;
function captureVariant() {
  if (shotBusy || state.inspectId == null || !inspIframe) return;
  var n = byId(state.inspectId);
  trace('inspect:screenshot', { id: state.inspectId, via: n && n.url ? 'tab' : 'frame' });
  if (n && !n.url) {
    shotBusy = true;
    // no reply (hook predates this build / page replaced it) → picker fallback
    shotWait = setTimeout(function () { shotWait = null; shotBusy = false; captureTab(); }, 3000);
    inspIframe.contentWindow.postMessage('shot', '*');
  } else {
    captureTab();
  }
}
/* the frame answered — a blob means a finished PNG, null means it failed */
function shotArrived(blob) {
  if (!shotBusy || shotWait == null) return;
  clearTimeout(shotWait); shotWait = null; shotBusy = false;
  if (blob) deliverShot(blob);
  else { trace('inspect:screenshot-fallback'); captureTab(); }
}
function deliverShot(blob) {
  // save first — that's the point of the button; clipboard is a best-effort bonus
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = SESSION + '-' + (state.inspectId || 'variant').replace(/\.html$/, '') + '.png';
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function () {
    toast('Screenshot saved (and copied)');
  }, function () {
    toast('Screenshot saved');
  });
}
/* fallback: tab-capture (preferCurrentTab pre-selects this tab), crop the
   frame's rect out of one video frame. Chromium-only. */
function captureTab() {
  if (shotBusy) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    toast('Screenshots need a Chromium browser'); return;
  }
  shotBusy = true;
  var stream, video = document.createElement('video');
  navigator.mediaDevices.getDisplayMedia({
    video: true, audio: false,
    preferCurrentTab: true, selfBrowserSurface: 'include'
  }).then(function (s) {
    stream = s;
    video.srcObject = s;
    video.muted = true;
    inspect.classList.add('shooting'); // chrome, chevrons and hints leave the shot
    return video.play();
  }).then(function () {
    // let the share infobar's reflow and the 'shooting' fade both settle
    return new Promise(function (res) { setTimeout(res, 400); });
  }).then(function () {
    var r = ispFrame.getBoundingClientRect();
    var sx = video.videoWidth / window.innerWidth;
    var sy = video.videoHeight / window.innerHeight;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.width * sx));
    c.height = Math.max(1, Math.round(r.height * sy));
    c.getContext('2d').drawImage(video, r.left * sx, r.top * sy, r.width * sx, r.height * sy, 0, 0, c.width, c.height);
    return new Promise(function (res) { c.toBlob(res, 'image/png'); });
  }).then(function (blob) {
    endShot(stream);
    if (!blob) throw new Error('no frame');
    deliverShot(blob);
  }).catch(function (e) {
    endShot(stream);
    trace('inspect:screenshot-fail', { msg: String(e).slice(0, 120) });
    if (e && e.name === 'NotAllowedError') toast('Screenshot cancelled');
    else toast('Screenshot failed — ' + (e && e.message ? e.message : e));
  });
}
function endShot(stream) {
  if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
  inspect.classList.remove('shooting');
  shotBusy = false;
}
function setWinner(id) {
  // no fleet needed: a pick only records the winner (the server appends it
  // regardless of heartbeat), so it stays unlocked even when the fleet is offline
  var n = byId(id);
  if (!n) return;
  var file = n.id;
  state.winner = file; // optimistic; server truth arrives via refreshRequests
  allNodes().forEach(updateNodeVisual);
  renderMinimap();
  if (state.inspectId) ispPaintPick();
  // the pick only records the winner — implementation is handed to a fresh
  // agent via the Copy prompt button, not done by the fleet
  sendRequest('Pick "' + n.name + '" — the winner.', [file], null, 'pick').then(refreshRequests);
  toast('Winner picked — Copy prompt hands it to a fresh agent');
}

