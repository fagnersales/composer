/* ---------- the composer's two states ----------
   Resting is a one-line chip; composing is a textarea. There is no continuum
   between them: the moment the caret would run out of room the panel and field
   snap open together in one motion, and the hints arrive with it. Coming back
   needs both a quiet spell and a margin of slack, so it can't flap. */
var CMP_REST_H = 32, CMP_COMP_H = 108, CMP_COMP_H_MAX = 150;
var CMP_RETURN_DELAY = 400;   // ms of no typing before collapsing back
var CMP_HYSTERESIS = 14;      // px of slack required before returning
var CMP_CARET_SLACK = 8;      // the caret needs room too — snap just before it clips
var cmpMode = 'resting';
var cmpReturnTimer = null, cmpRemeasure = null, cmpSettle = null;

function cmpDocked() { return composer.classList.contains('in-inspect'); }
function cmpPanelWidth(mode) {
  if (cmpDocked()) return mode === 'composing' ? 520 : 320;
  return mode === 'composing' ? 412 : 292;
}
/* Usable text width of the RESTING field, derived rather than measured: while
   composing, the live panel is already wide, so there is nothing to measure.
   panel borders 2 + panel padding 24 + field borders 2 + field padding 20 */
function cmpRestingTextWidth() { return cmpPanelWidth('resting') - 48; }

var cmpMeas = document.createElement('span');
cmpMeas.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0;';
document.body.appendChild(cmpMeas);
function cmpTextWidth(s) {
  var cs = getComputedStyle(cmpInput);
  cmpMeas.style.font = cs.font;
  cmpMeas.style.letterSpacing = cs.letterSpacing;
  cmpMeas.textContent = s;
  return cmpMeas.getBoundingClientRect().width;
}

function cmpWantsComposing(v) {
  if (v.indexOf('\n') >= 0) return true;                 // an explicit newline needs the box
  return cmpTextWidth(v) + CMP_CARET_SLACK > cmpRestingTextWidth();
}
function cmpFitsResting(v) {
  if (v.indexOf('\n') >= 0) return false;
  return cmpTextWidth(v) + CMP_CARET_SLACK + CMP_HYSTERESIS <= cmpRestingTextWidth();
}

function cmpSetMode(next, immediate) {
  if (cmpMode === next) return;
  cmpMode = next;
  composer.classList.toggle('composing', next === 'composing');
  composer.classList.remove('settled');
  clearTimeout(cmpSettle);
  if (next === 'composing' && !immediate) {
    // once the snap has landed, later height changes get the quieter transition
    cmpSettle = setTimeout(function () { if (cmpMode === 'composing') composer.classList.add('settled'); }, 330);
  }
  cmpApplyPlaceholder();
  cmpSyncInline();
  syncComposer();
  // the panel's box is still animating; re-place once it has settled
  setTimeout(syncComposer, 330);
}

function cmpDecideMode(v, immediate) {
  if (cmpMode === 'resting') {
    clearTimeout(cmpReturnTimer);
    if (cmpWantsComposing(v)) cmpSetMode('composing', immediate);   // the snap: no debounce
  } else {
    if (!cmpFitsResting(v)) { clearTimeout(cmpReturnTimer); return; }
    clearTimeout(cmpReturnTimer);
    if (immediate) { cmpSetMode('resting', true); return; }
    cmpReturnTimer = setTimeout(function () {
      if (cmpFitsResting(cmpInput.value)) cmpSetMode('resting');
    }, CMP_RETURN_DELAY);
  }
}

function cmpMeasureHeight() {
  cmpMirror.textContent = cmpInput.value + '​';
  var h = Math.ceil(cmpMirror.getBoundingClientRect().height) + 2;
  cmpField.style.setProperty('--cmp-fh', clamp(h, CMP_COMP_H, CMP_COMP_H_MAX) + 'px');
}

function cmpLayout(immediate) {
  cmpDecideMode(cmpInput.value, immediate);
  if (cmpMode === 'composing') {
    cmpMeasureHeight();
    // the panel width is still in flight for one snap-length; re-measure after
    clearTimeout(cmpRemeasure);
    cmpRemeasure = setTimeout(function () { if (cmpMode === 'composing') cmpMeasureHeight(); }, 340);
  } else {
    cmpField.style.removeProperty('--cmp-fh');
  }
  cmpSyncInline();
}

/* the only written hint lives in the composing row, so it arrives with the snap */
function cmpSyncInline() {
  cmpInline.innerHTML = (cmpMode === 'composing' && cmpInput.value.trim())
    ? '<kbd class="kb txt">Enter</kbd>&nbsp; to ' + (cmpModeType === 'tweak' ? 'tweak' : 'iterate') : '';
}

/* ---------- the Iterate | Tweak mode toggle ----------
   One vocabulary end to end: the labels and the request
   `type:"iterate"`/`"tweak"` say the same word.
   The active segment is the only mode signal — no accent shift, no title.
   Tweak is the featherweight path: one small change, always a single
   child card — no count to choose. */
var cmpModeType = 'iterate';
function cmpApplyPlaceholder() {
  cmpInput.placeholder = cmpModeType === 'tweak' ? 'One tweak — e.g. 600ms not 200ms'
    : (cmpMode === 'composing' ? 'Describe the change…' : 'Type something...');
}
function setCmpModeType(m) {
  if (m !== cmpModeType) trace('input:mode', { mode: m });
  cmpModeType = m;
  var btns = cmpModeEl.querySelectorAll('[data-m]');
  for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].getAttribute('data-m') === m);
  document.getElementById('cmpCount').hidden = m === 'tweak';
  // tweak/reject build exactly one child — the island's count goes quiet
  ispLadderWrap.classList.toggle('dim', m !== 'iterate');
  cmpGo.textContent = m === 'tweak' ? 'Tweak' : 'Iterate';
  cmpApplyPlaceholder();
  cmpSyncInline();
}
var cmpModeBtns = cmpModeEl.querySelectorAll('[data-m]');
for (var mi = 0; mi < cmpModeBtns.length; mi++) {
  cmpModeBtns[mi].addEventListener('click', function () {
    setCmpModeType(this.getAttribute('data-m'));
    cmpInput.focus();
  });
}

/* ---------- the model dial ----------
   Which model the fleet builds with. It rides the field's edge rather than the
   control row: the row is what you operate to send, the model is a property of
   what you're writing. Each emblem is drawn at the same optical weight — one
   closed figure plus one accent — so no mark reads as "more" than another. */
var CMP_EMBLEMS = {
  // Sonnet — a circle cleft by its own diameter: two halves, one whole.
  sonnet: '<circle cx="6" cy="6" r="4.15"/><path d="M6 1.85V10.15"/>',
  // Opus — a diamond with a solid core: a struck, weighted point.
  opus: '<path d="M6 1.7 10.3 6 6 10.3 1.7 6Z"/><circle cx="6" cy="6" r="1.15" fill="currentColor" stroke="none"/>',
  // Fable — two lenses overlapping: a told thing, seen twice.
  fable: '<circle cx="4.35" cy="6" r="3.25"/><circle cx="7.65" cy="6" r="3.25"/>'
};
var CMP_MODELS = [
  { id: 'sonnet', name: 'Sonnet', sub: 'balanced' },
  { id: 'opus',   name: 'Opus',   sub: 'deeper'   },
  { id: 'fable',  name: 'Fable',  sub: 'deepest'  }
];
var MODEL_KEY = 'composer-model';
var cmpModelIx = 1;
try {
  var saved = localStorage.getItem(MODEL_KEY);
  for (var mx = 0; mx < CMP_MODELS.length; mx++) if (CMP_MODELS[mx].id === saved) cmpModelIx = mx;
} catch (e) {}

function embSvg(id) {
  return '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.25" ' +
    'stroke-linecap="round" stroke-linejoin="round">' + CMP_EMBLEMS[id] + '</svg>';
}
var cmpDial = document.getElementById('cmpDial');
var cmpPop = document.getElementById('cmpPop');
var cmpDialName = cmpDial.querySelector('.nm');
var cmpDialEmb = cmpDial.querySelector('.emblem');
CMP_MODELS.forEach(function (m, i) {
  var b = document.createElement('button');
  b.type = 'button';
  b.innerHTML = '<span class="emblem" aria-hidden="true">' + embSvg(m.id) + '</span><span>' + m.name + '</span>' +
    '<span class="sub">' + m.sub + '</span>' +
    '<span class="tick" aria-hidden="true"><svg viewBox="0 0 10 10" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.6 5.2 3.9 7.5 8.4 2.6"/></svg></span>';
  b.addEventListener('click', function (e) { e.stopPropagation(); setCmpModel(i); cmpSetDialOpen(false); });
  cmpPop.appendChild(b);
});
function cmpModel() { return CMP_MODELS[cmpModelIx]; }
function setCmpModel(i) {
  var prev = CMP_MODELS[cmpModelIx].id;
  cmpModelIx = Math.min(CMP_MODELS.length - 1, Math.max(0, i));
  var m = cmpModel();
  if (m.id !== prev) trace('input:model', { model: m.id });
  try { localStorage.setItem(MODEL_KEY, m.id); } catch (e) {}
  cmpDialName.textContent = m.name;
  if (cmpDialEmb.getAttribute('data-id') !== m.id) {
    cmpDialEmb.setAttribute('data-id', m.id);
    cmpDialEmb.innerHTML = embSvg(m.id);
    cmpDialEmb.firstElementChild.classList.add('swap');
  }
  var rows = cmpPop.children;
  for (var i2 = 0; i2 < rows.length; i2++) rows[i2].classList.toggle('on', i2 === cmpModelIx);
}
function cmpSetDialOpen(v) { composer.classList.toggle('dialopen', !!v); }
cmpDial.addEventListener('click', function (e) {
  e.stopPropagation();
  cmpSetDialOpen(!composer.classList.contains('dialopen'));
});
cmpDial.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowRight') { e.preventDefault(); setCmpModel(cmpModelIx + 1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); setCmpModel(cmpModelIx - 1); }
});
cmpPop.addEventListener('click', function (e) { e.stopPropagation(); });
document.addEventListener('click', function () { cmpSetDialOpen(false); });
setCmpModel(cmpModelIx);

/* The note reserves no row at rest. Transient messages open it for a beat and
   collapse away; sticky ones (fleet offline) stay until they're cleared. */
var cmpNoteTimer = null, cmpNoteClear = null;
function cmpShowNote(html, ttl) {
  trace('note', { msg: html.replace(/<[^>]*>/g, '').slice(0, 120) });
  clearTimeout(cmpNoteClear); clearTimeout(cmpNoteTimer);
  cmpNote.innerHTML = html;
  composer.classList.add('noted');
  if (ttl) cmpNoteTimer = setTimeout(cmpHideNote, ttl);
}
function cmpHideNote() {
  clearTimeout(cmpNoteTimer);
  if (!composer.classList.contains('noted')) return;
  composer.classList.remove('noted');
  // hold the text until the row has finished collapsing, so it fades rather than blanking
  clearTimeout(cmpNoteClear);
  cmpNoteClear = setTimeout(function () { cmpNote.innerHTML = ''; }, 340);
}

/* ---------- reference images ----------
   Paste or drop an image into the composer: it uploads into the task's
   images/ folder right away (content-addressed, so repeats are free) and the
   iterate request carries the stored paths for the fleet agent to look at. */
var cmpImages = []; // { file: 'images/<hash>.<ext>' | null while uploading, el }
function cmpImagesReady() {
  return cmpImages.every(function (i) { return i.file; });
}
function cmpRemoveImage(item) {
  var i = cmpImages.indexOf(item);
  if (i >= 0) cmpImages.splice(i, 1);
  item.el.remove();
  composer.classList.toggle('has-imgs', !!cmpImages.length);
  syncComposer();
}
function cmpClearImages() { cmpImages.slice().forEach(cmpRemoveImage); }
function cmpAddImage(blob) {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(blob.type)) {
    cmpShowNote('Images only — PNG, JPEG, GIF or WebP.', 3200);
    return;
  }
  trace('image:add', { type: blob.type, size: blob.size });
  var item = { file: null, el: document.createElement('div') };
  item.el.className = 'cmp-img pending';
  var img = document.createElement('img');
  img.src = URL.createObjectURL(blob);
  var up = document.createElement('span');
  up.className = 'up';
  up.innerHTML = '<i></i>';
  var rm = document.createElement('button');
  rm.className = 'rm';
  rm.type = 'button';
  rm.title = 'Remove image';
  rm.textContent = '✕';
  rm.addEventListener('mousedown', function (e) { e.stopPropagation(); });
  rm.addEventListener('click', function (e) { e.stopPropagation(); cmpRemoveImage(item); });
  item.el.appendChild(img); item.el.appendChild(up); item.el.appendChild(rm);
  cmpImgs.appendChild(item.el);
  cmpImages.push(item);
  composer.classList.add('has-imgs');
  syncComposer(); // the chip row changed the panel's height
  fetch(API + '/t/' + TASK + '/images', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob })
    .then(function (r) { if (!r.ok) throw 0; return r.json(); })
    .then(function (d) { item.file = d.file; item.el.classList.remove('pending'); trace('image:uploaded', { file: d.file }); })
    .catch(function () {
      cmpRemoveImage(item);
      cmpShowNote('Image upload failed.', 3200);
    });
}
cmpInput.addEventListener('paste', function (e) {
  var files = e.clipboardData && e.clipboardData.files;
  if (!files || !files.length) return;
  e.preventDefault();
  for (var i = 0; i < files.length; i++) cmpAddImage(files[i]);
});
composer.addEventListener('dragover', function (e) { e.preventDefault(); cmpField.classList.add('dropping'); });
composer.addEventListener('dragleave', function (e) { if (!composer.contains(e.relatedTarget)) cmpField.classList.remove('dropping'); });
composer.addEventListener('drop', function (e) {
  e.preventDefault();
  cmpField.classList.remove('dropping');
  var files = e.dataTransfer && e.dataTransfer.files;
  if (!files) return;
  for (var i = 0; i < files.length; i++) cmpAddImage(files[i]);
});

cmpInput.addEventListener('input', function () { cmpHideNote(); cmpLayout(); });
cmpInput.addEventListener('focus', function () { cmpField.classList.add('hot'); });
cmpInput.addEventListener('blur', function () { cmpField.classList.remove('hot'); });

cmpGo.addEventListener('click', doSend);
cmpInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  // shift is the deliberate form — it works mid-sentence, since "_" and "+" are
  // rare enough in a prompt that holding shift can only have meant the counter
  else if (e.shiftKey && (e.key === '+' || e.key === '=')) { e.preventDefault(); cmpBump(1); }
  else if (e.shiftKey && (e.key === '_' || e.key === '-')) { e.preventDefault(); cmpBump(-1); }
  // bare -/+ only apply to an empty field — mid-sentence they'd eat the character
  else if ((e.key === '+' || e.key === '=') && !cmpInput.value) { e.preventDefault(); cmpBump(1); }
  else if ((e.key === '-' || e.key === '_') && !cmpInput.value) { e.preventDefault(); cmpBump(-1); }
});
/* ===== counter feedback: odometer drum, luminance ladder, synthesized sound =====
   Changing the count is the one control that spends real agents, so it answers
   in three channels at once — the digit rolls, the ladder re-grades, and a note
   sounds. Every sound is synthesized; nothing is fetched. */
var cmpNoMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
function cmpReduce() { return cmpNoMotion.matches; }

var AC = null, cmpMaster = null, cmpNoiseBuf = null;
function cmpAudio() {
  if (!AC) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    AC = new Ctx();
    cmpMaster = AC.createGain();
    // fires on every keystroke of a held run, so it sits under the room
    cmpMaster.gain.value = 0.2;
    var comp = AC.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 6; comp.release.value = 0.15;
    cmpMaster.connect(comp); comp.connect(AC.destination);
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function cmpNoise() {
  var c = cmpAudio(); if (!c) return null;
  if (!cmpNoiseBuf) {
    var n = Math.floor(c.sampleRate * 0.2);
    cmpNoiseBuf = c.createBuffer(1, n, c.sampleRate);
    var d = cmpNoiseBuf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  var s = c.createBufferSource(); s.buffer = cmpNoiseBuf; s.loop = true;
  s.playbackRate.value = 0.7 + Math.random() * 0.6;
  return s;
}
/* major pentatonic over 1..12 → G3 up to A5: every step is consonant with every
   other, so a fast hold reads as a run rather than a siren */
var CMP_PENT = [0, 2, 4, 7, 9], CMP_BASE = 196;
function cmpFreq(n) {
  var i = clamp(n, CMP_MIN, CMP_MAX) - 1;
  return CMP_BASE * Math.pow(2, (Math.floor(i / 5) * 12 + CMP_PENT[i % 5]) / 12);
}
function cmpTick(amp) {
  var c = cmpAudio(); if (!c) return;
  var s = cmpNoise(); if (!s) return;
  var t = c.currentTime + 0.001;
  var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.4;
  var g = c.createGain();
  g.gain.setValueAtTime(amp, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
  s.connect(bp); bp.connect(g); g.connect(cmpMaster);
  s.start(t); s.stop(t + 0.05);
}
/* one voice = triangle + octave sine, a quick pitch settle for the detent, and a
   filtered noise tick for the mechanism */
function cmpPlayNote(n, vel) {
  var c = cmpAudio(); if (!c) return;
  var t = c.currentTime + 0.001, f = cmpFreq(n);
  vel = vel == null ? 1 : vel;
  var g = c.createGain();
  var lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 0.8;
  lp.frequency.setValueAtTime(f * 7, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.7, 420), t + 0.13);
  var o1 = c.createOscillator(); o1.type = 'triangle';
  o1.frequency.setValueAtTime(f * 1.018, t);
  o1.frequency.exponentialRampToValueAtTime(f, t + 0.04);
  var o2 = c.createOscillator(); o2.type = 'sine';
  o2.frequency.setValueAtTime(f * 2.004, t);
  var g2 = c.createGain(); g2.gain.value = 0.3;
  o1.connect(g); o2.connect(g2); g2.connect(g);
  g.connect(lp); lp.connect(cmpMaster);
  var peak = 0.2 * vel, dur = 0.26;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o1.start(t); o2.start(t); o1.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  cmpTick(0.045 * vel);
}
/* the wall: two detuned low oscillators beating against each other, plus a thud */
function cmpPlayWall() {
  var c = cmpAudio(); if (!c) return;
  var t = c.currentTime + 0.001;
  var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 0.4;
  var g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.24, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
  var a = c.createOscillator(); a.type = 'triangle';
  a.frequency.setValueAtTime(104, t); a.frequency.exponentialRampToValueAtTime(82, t + 0.12);
  var b = c.createOscillator(); b.type = 'sawtooth'; b.frequency.value = 97.7;
  var bg = c.createGain(); bg.gain.value = 0.35;
  a.connect(g); b.connect(bg); bg.connect(g); g.connect(lp); lp.connect(cmpMaster);
  a.start(t); b.start(t); a.stop(t + 0.22); b.stop(t + 0.22);
  var s = cmpNoise();
  if (s) {
    var nlp = c.createBiquadFilter(); nlp.type = 'lowpass'; nlp.frequency.value = 700;
    var ng = c.createGain();
    ng.gain.setValueAtTime(0.10, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    s.connect(nlp); nlp.connect(ng); ng.connect(cmpMaster);
    s.start(t); s.stop(t + 0.09);
  }
}

/* ---- the odometer drum ---- */
var cmpSlots = [cmpOdo.children[0], cmpOdo.children[1]];
cmpSlots.forEach(function (s) { s.dataset.ch = ''; });
var CMP_IN_EASE = 'cubic-bezier(.2,1.45,.36,1)';   /* overshoot & settle */
var CMP_OUT_EASE = 'cubic-bezier(.32,.9,.3,1)';
function cmpDigit(ch) {
  var el = document.createElement('span');
  el.className = 'd'; el.textContent = ch;
  return el;
}
function cmpRollSlot(slot, ch, dir) {
  var old = slot.querySelector('.d:not(.dead)');
  // a fast hold can outrun the animation — retire anything still on screen
  Array.prototype.forEach.call(slot.querySelectorAll('.d.dead'), function (e) { e.remove(); });
  var next = cmpDigit(ch);
  slot.appendChild(next);
  if (!old) return;
  old.classList.add('dead');
  if (cmpReduce()) {
    next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 110, fill: 'both' });
    var fo = old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, fill: 'both' });
    fo.onfinish = function () { old.remove(); };
    return;
  }
  var from = dir > 0 ? 100 : -100;   /* increment: the new digit rises from below */
  var to   = dir > 0 ? -100 : 100;
  next.animate(
    [{ transform: 'translateY(' + from + '%)', opacity: .3 }, { transform: 'translateY(0%)', opacity: 1 }],
    { duration: 400, easing: CMP_IN_EASE, fill: 'both' });
  var a = old.animate(
    [{ transform: 'translateY(0%)', opacity: 1 }, { transform: 'translateY(' + to + '%)', opacity: 0 }],
    { duration: 260, easing: CMP_OUT_EASE, fill: 'both' });
  a.onfinish = function () { old.remove(); };
}
var cmpRollTimer = null;
function cmpRender(val, dir, animate) {
  var s = String(val);
  var chars = s.length === 2 ? [s[0], s[1]] : ['', s[0]];
  var moved = false;
  cmpSlots.forEach(function (slot, i) {
    var ch = chars[i];
    slot.classList.toggle('empty', ch === '');
    if (slot.dataset.ch === ch) return;         /* per-digit: only what changed rolls */
    slot.dataset.ch = ch;
    moved = true;
    if (!animate) {
      slot.innerHTML = '';
      if (ch !== '') slot.appendChild(cmpDigit(ch));
    } else if (ch === '') {
      var gone = slot.querySelector('.d:not(.dead)');
      if (gone) { gone.classList.add('dead'); gone.remove(); }
    } else {
      cmpRollSlot(slot, ch, dir);
    }
  });
  if (moved && animate && !cmpReduce()) {
    cmpCountEl.classList.add('rolling');
    clearTimeout(cmpRollTimer);
    cmpRollTimer = setTimeout(function () { cmpCountEl.classList.remove('rolling'); }, 420);
  }
}

/* ---- the ladder. Three static per-rung facts do the work hue would have: a
   steeper height ramp, a bar that thickens as it climbs, and `--g`, the bloom
   licence, zero below rung 7 and 1 at rung 12 — only a high count can glow. ---- */
for (var cmpRi = 0; cmpRi < CMP_MAX; cmpRi++) {
  var cmpRung = document.createElement('i');
  cmpRung.style.height = (4 + cmpRi * 1.0).toFixed(1) + 'px';
  cmpRung.style.width  = (2 + cmpRi * 0.08).toFixed(2) + 'px';
  cmpRung.style.setProperty('--c', 'var(--lum-' + (cmpRi + 1) + ')');
  cmpRung.style.setProperty('--g', Math.max(0, (cmpRi - 5) / 6).toFixed(3));
  cmpLadder.appendChild(cmpRung);
}
/* how far a filled rung is pushed toward its own stop. The floor is high: with
   no hue to announce itself, one lit rung at count 1 must clear the unfilled
   grey on lightness alone. */
var CMP_MIX_FLOOR = 0.7;
var cmpLitTimer = null, cmpPrevTop = 0;   /* wave origin: the last struck rung */
function cmpLightLadder(val, wall) {
  cmpLadder.classList.toggle('wall', !!wall);
  var heat = (val - CMP_MIN) / (CMP_MAX - CMP_MIN);
  var k = CMP_MIX_FLOOR + (1 - CMP_MIX_FLOOR) * heat;
  var origin = cmpPrevTop || val;
  var step = cmpReduce() ? 0 : 26;
  Array.prototype.forEach.call(cmpLadder.children, function (r, idx) {
    var n = idx + 1, filled = n <= val;
    r.classList.toggle('on', n === val);
    r.classList.toggle('past', n < val);
    r.classList.toggle('off', !filled);
    /* the wave leaves the rung that just changed and runs to the new top */
    r.style.transitionDelay = Math.min(Math.abs(n - origin) * step, 300) + 'ms';
    r.style.setProperty('--k', filled ? k.toFixed(3) : '0');
  });
  cmpPrevTop = val;
  cmpLadder.classList.add('lit');
  clearTimeout(cmpLitTimer);
  cmpLitTimer = setTimeout(function () { cmpLadder.classList.remove('lit'); }, 1100);
}

/* ---- the one entry point ---- */
var cmpLastSoundAt = 0, cmpLastWallAt = 0;
function setCmpCount(n, echo, dirHint) {
  var next = clamp(Math.round(n) || CMP_MIN, CMP_MIN, CMP_MAX);
  var dir = next > cmpCount ? 1 : next < cmpCount ? -1 : (dirHint || 0);
  var changed = next !== cmpCount;
  cmpCount = next;
  if (echo !== false) cmpN.value = String(cmpCount);
  cmpMinus.classList.toggle('off', cmpCount <= CMP_MIN);
  cmpPlus.classList.toggle('off', cmpCount >= CMP_MAX);
  cmpMinus.title = cmpCount <= CMP_MIN ? 'Already at 1 variant' : 'Fewer variants';
  cmpPlus.title  = cmpCount >= CMP_MAX ? 'Already at 12 variants' : 'More variants';
  cmpRender(cmpCount, dir, changed);
  cmpLightLadder(cmpCount, false);
  ispLadderSync(); // the inspect island's ladder reads the same count
  if (!changed) return;
  // a held +/- fires fast — log only where the count comes to rest
  clearTimeout(setCmpCount._tr);
  setCmpCount._tr = setTimeout(function () { trace('input:count', { count: cmpCount }); }, 500);
  /* a hold degrades gracefully: skip anything under 45ms and duck the velocity
     of a fast run, so it reads as one gesture rather than machine-gun blips */
  var now = performance.now(), gap = now - cmpLastSoundAt;
  if (gap >= 45) {
    cmpLastSoundAt = now;
    cmpPlayNote(cmpCount, clamp(0.5 + (gap / 260) * 0.5, 0.5, 1));
  }
}
function cmpWall(dir) {
  var now = performance.now();
  cmpCountEl.classList.remove('wall-hi', 'wall-lo');
  void cmpCountEl.offsetWidth;
  if (!cmpReduce()) cmpCountEl.classList.add(dir > 0 ? 'wall-hi' : 'wall-lo');
  cmpLightLadder(cmpCount, true);
  if (now - cmpLastWallAt >= 380) { cmpLastWallAt = now; cmpPlayWall(); }
}
/* the buttons look spent at the wall but still receive the press, so pushing
   against the ceiling answers instead of going silent */
function cmpBump(dir) {
  cmpAudio();
  if (dir > 0 && cmpCount >= CMP_MAX) { cmpWall(1); return; }
  if (dir < 0 && cmpCount <= CMP_MIN) { cmpWall(-1); return; }
  setCmpCount(cmpCount + dir, true, dir);
}
function cmpHoldable(btn, dir) {
  var t0 = null, t1 = null, n = 0;
  function start(e) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    cmpBump(dir); n = 0;
    t0 = setTimeout(function repeat() {
      n++;
      cmpBump(dir);
      t1 = setTimeout(repeat, Math.max(60, 110 - n * 6));
    }, 380);
  }
  function stop() { clearTimeout(t0); clearTimeout(t1); }
  btn.addEventListener('pointerdown', start);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
  btn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cmpBump(dir); }
  });
}
cmpHoldable(cmpMinus, -1);
cmpHoldable(cmpPlus, 1);
// while typing, track the value but leave the field alone so "1" on the way to "10" isn't clamped out
cmpN.addEventListener('input', function () { if (cmpN.value !== '') { cmpAudio(); setCmpCount(+cmpN.value, false); } });
cmpN.addEventListener('blur', function () { setCmpCount(cmpCount); });
cmpN.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); setCmpCount(cmpCount); doIterate(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cmpBump(1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); cmpBump(-1); }
});
setCmpCount(cmpCount);
/* grade the ladder for the resting count without leaving it flashed 'lit' */
clearTimeout(cmpLitTimer);
cmpLadder.classList.remove('lit');

for (var ai = 0; ai < ispAspect.children.length; ai++) {
  ispAspect.children[ai].addEventListener('click', function (e) {
    e.stopPropagation();
    setAspect(this.getAttribute('data-a'));
    ispSetPopOpen(false);
  });
}
ispAspectBtn.addEventListener('click', function (e) {
  e.stopPropagation();
  ispSetPopOpen(!ispAspect.classList.contains('open'));
});
document.addEventListener('click', function () { ispSetPopOpen(false); });
document.getElementById('ispIterate').addEventListener('click', function () {
  if (composer.classList.contains('in-inspect')) closeInspectIterate(); else openInspectIterate();
});
document.getElementById('ispFull').addEventListener('click', toggleFullscreen);
document.getElementById('ispShot').addEventListener('click', captureVariant);
ispPause.addEventListener('click', togglePause);
ispRestart.addEventListener('click', function () { var n = byId(state.inspectId); if (n) buildInspFrame(n); });
ispPick.addEventListener('click', function () { if (state.inspectId != null) setWinner(state.inspectId); });
ispCopyPrompt.addEventListener('click', copyPickPrompt);
ispClose.addEventListener('click', function () {
  if (composer.classList.contains('in-inspect')) closeInspectIterate(); else closeInspect();
});
/* the stage's empty space is the scrim — clicking it closes */
ispStage.addEventListener('mousedown', function (e) { if (e.target === ispStage) closeInspect(); });

/* ---- the island wakes on approach: bottom band, both vertical edges, the
   glass itself, and the nav zones (that's where the chevrons live) ---- */
[document.getElementById('ispZone'), document.getElementById('ispWakeL'),
 document.getElementById('ispWakeR'), ispGlass, ispPrev, ispNext].forEach(function (el) {
  el.addEventListener('pointerenter', ispGather);
  el.addEventListener('pointerleave', ispScatterSoon);
});
ispGlass.addEventListener('focusin', ispGather);

/* the edge zones step through siblings — the pointer twin of ← / → */
ispPrev.addEventListener('click', function () { handleNavKey('ArrowLeft'); });
ispNext.addEventListener('click', function () { handleNavKey('ArrowRight'); });

/* ---- the island's ladder: hover previews, press-and-drag scrubs, the wheel
   steps, − / + hold. It reads and writes the same count as the Input. ---- */
var ispRungs = [];
for (var iri = 0; iri < CMP_MAX; iri++) {
  var ir = document.createElement('i');
  ir.style.setProperty('--c', 'var(--lum-' + (iri + 1) + ')');
  ispLadder.appendChild(ir);
  ispRungs.push(ir);
}
var ispScrub = false, ispPrevw = null;
function ispLadderSync() {
  if (!ispRungs || !ispRungs.length) return; // called from setCmpCount before the rungs exist
  var p = ispPrevw;
  ispRungs.forEach(function (r, i) {
    var lit = i < cmpCount;
    r.classList.toggle('lit', lit);
    r.classList.toggle('pre', p !== null && !lit && i < p);
    r.classList.toggle('dropping', p !== null && lit && i >= p);
  });
  var v = p !== null ? p : cmpCount;
  ispLadderN.innerHTML = v + ' <span class="u">' + (v === 1 ? 'variant' : 'variants') + '</span>';
  document.getElementById('ispMinus').classList.toggle('off', cmpCount <= CMP_MIN);
  document.getElementById('ispPlus').classList.toggle('off', cmpCount >= CMP_MAX);
}
function ispCountAt(x) {
  var first = ispRungs[0].getBoundingClientRect();
  var last = ispRungs[CMP_MAX - 1].getBoundingClientRect();
  var t = (x - first.left) / (last.right - first.left);
  return clamp(Math.ceil(t * CMP_MAX), CMP_MIN, CMP_MAX);
}
ispLadder.addEventListener('pointerdown', function (e) {
  e.preventDefault();
  ispScrub = true;
  inspect.classList.add('scrubbing');
  ispLadder.setPointerCapture(e.pointerId);
  ispPrevw = null;
  setCmpCount(ispCountAt(e.clientX));
});
ispLadder.addEventListener('pointermove', function (e) {
  if (ispScrub) { ispPrevw = null; setCmpCount(ispCountAt(e.clientX)); return; }
  var p = ispCountAt(e.clientX);
  if (p !== ispPrevw) { ispPrevw = p; ispLadderSync(); }
});
function ispEndScrub(e) {
  if (!ispScrub) return;
  ispScrub = false;
  inspect.classList.remove('scrubbing');
  try { ispLadder.releasePointerCapture(e.pointerId); } catch (err) {}
  ispPrevw = null; ispLadderSync();
  ispScatterSoon();
}
ispLadder.addEventListener('pointerup', ispEndScrub);
ispLadder.addEventListener('pointercancel', ispEndScrub);
ispLadder.addEventListener('pointerleave', function () {
  if (ispScrub) return;
  ispPrevw = null; ispLadderSync();
});
ispLadder.addEventListener('wheel', function (e) {
  e.preventDefault();
  ispPrevw = null;
  cmpBump(e.deltaY > 0 ? -1 : 1);
}, { passive: false });
cmpHoldable(document.getElementById('ispMinus'), -1);
cmpHoldable(document.getElementById('ispPlus'), 1);
ispLadderSync();

window.addEventListener('keydown', function (e) {
  var t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
    if (e.key === 'Escape') t.blur();
    return;
  }
  if (/^(Escape|Arrow|Enter| |f|F|i|I|\+|=|-|_|0|o|O)/.test(e.key)) trace('key', { key: e.key });
  if (e.key === 'Escape') { escAction(); }
  else if (e.key.indexOf('Arrow') === 0) { e.preventDefault(); handleNavKey(e.key); }
  else if ((e.key === 'Enter' || e.key === ' ') && state.inspectId == null) {
    var open = selPrimary();
    if (open) { e.preventDefault(); openInspect(open.id); }
  }
  else if ((e.key === 'f' || e.key === 'F') && state.inspectId != null) { e.preventDefault(); toggleFullscreen(); }
  else if (e.key === 'i' || e.key === 'I') {
    if (state.inspectId != null) { e.preventDefault(); openInspectIterate(); return; }
    var sel = selPrimary();
    if (!sel) { navArrow('ArrowRight'); sel = selPrimary(); } // nothing selected: start at the first root
    if (sel) { e.preventDefault(); cmpInput.focus(); }
  }
  else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.2); }
  else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 1.2); }
  else if (e.key === '0') { e.preventDefault(); fitView(); }
  else if (e.key === 'o' || e.key === 'O') { e.preventDefault(); organizeView(); }
});
window.addEventListener('resize', function () {
  organizeSettle();
  applyCamera();
  if (state.inspectId != null) setAspect(currentAspect);
});
/* keys pressed inside an inspected variant page are forwarded up by the
   withPause-injected hook, so navigation keeps working with the page focused */
window.addEventListener('message', function (ev) {
  var k = ev.data && ev.data.composerKey;
  if (typeof k !== 'string') return;
  if (k === 'Escape') { if (state.inspectId != null) escAction(); }
  else if (k.indexOf('Arrow') === 0) handleNavKey(k);
});

