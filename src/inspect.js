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
    f.srcdoc = withPause(n.html);
    ispPause.disabled = false;
  }
  ispFrame.appendChild(f);
  inspIframe = f;
  insPausedState = false;
  ispRenderPause();
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
function setWinner(id) {
  if (!fleetLive) { toast('Fleet offline — run /composer in the project to reconnect'); return; }
  var n = byId(id);
  if (!n) return;
  var file = n.id;
  state.winner = file; // optimistic; server truth arrives via refreshRequests
  allNodes().forEach(updateNodeVisual);
  renderMinimap();
  if (state.inspectId) ispPaintPick();
  sendRequest('Pick "' + n.name + '" — implement this design.', [file], null, 'pick').then(refreshRequests);
}

