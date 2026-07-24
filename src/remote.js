/* ---------- phone remote ----------
   One QR scan pairs a phone with this board: /m/<session> shows one variant
   full-screen and walks the same list. Focus is shared over the task's SSE
   channel — selecting a card here moves the phone, swiping there moves this
   board. src tags each sender so nobody reacts to their own echo. */
var PHONE_BASE = ''; // set on boot from the tasks response (LAN address)
var applyingRemoteFocus = false;

function focusBroadcast(id) {
  if (applyingRemoteFocus || !TASK || id == null) return;
  var n = byId(id);
  if (!n || n.building) return;
  fetch(API + '/t/' + TASK + '/focus', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variant: id, src: TRACE_ID })
  }).catch(function () {});
}
function applyRemoteFocus(id) {
  var n = byId(id);
  if (!n || n.building) return;
  trace('focus:remote', { id: id });
  applyingRemoteFocus = true;
  try {
    navTo(n);
    // while inspecting, a swipe on the phone walks the overlay too
    if (state.inspectId != null && state.inspectId !== id) openInspect(id);
  } finally { applyingRemoteFocus = false; }
}

/* ---------- QR encoder ----------
   Minimal on purpose: byte mode, EC level M, mask 0, versions 1–6 — plenty
   for a LAN URL, and small enough to keep the board zero-dep. Anything that
   doesn't fit falls back to showing the plain link. */
var QR_GEXP = [], QR_GLOG = [];
(function () {
  var x = 1;
  for (var i = 0; i < 255; i++) { QR_GEXP[i] = x; QR_GLOG[x] = i; x <<= 1; if (x & 256) x ^= 285; }
  for (i = 255; i < 510; i++) QR_GEXP[i] = QR_GEXP[i - 255];
})();
function qrMul(a, b) { return a && b ? QR_GEXP[QR_GLOG[a] + QR_GLOG[b]] : 0; }
/* [total codewords, ecc per block, block count] per version, level M */
var QR_M = [null, [26, 10, 1], [44, 16, 1], [70, 26, 1], [100, 18, 2], [134, 24, 2], [172, 16, 4]];
var QR_ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

function qrMatrix(text) {
  var bytes = [];
  for (var i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i) & 255);
  var ver = 0;
  for (var v = 1; v <= 6; v++) {
    var t = QR_M[v];
    if (bytes.length <= t[0] - t[1] * t[2] - 2) { ver = v; break; }
  }
  if (!ver) return null;
  var total = QR_M[ver][0], eccLen = QR_M[ver][1], nBlocks = QR_M[ver][2];
  var dataLen = total - eccLen * nBlocks;

  /* bit stream: mode 0100 + 8-bit length + bytes, terminator, pads */
  var bits = [];
  function push(val, n) { for (var b = n - 1; b >= 0; b--) bits.push((val >> b) & 1); }
  push(4, 4);
  push(bytes.length, 8);
  bytes.forEach(function (b) { push(b, 8); });
  push(0, Math.min(4, dataLen * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  var cw = [];
  for (i = 0; i < bits.length; i += 8) {
    var byte = 0;
    for (var j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    cw.push(byte);
  }
  for (i = 0; cw.length < dataLen; i++) cw.push(i % 2 ? 0x11 : 0xEC);

  /* Reed–Solomon per block, then the standard column interleave */
  var gen = [1];
  for (i = 0; i < eccLen; i++) {
    var q = [];
    for (j = 0; j <= gen.length; j++) q.push(0);
    for (j = 0; j < gen.length; j++) {
      q[j] ^= qrMul(gen[j], QR_GEXP[i]);
      q[j + 1] ^= gen[j];
    }
    gen = q;
  }
  var per = dataLen / nBlocks; // level M v1–6: always divides evenly
  var blocks = [], eccs = [];
  for (var b0 = 0; b0 < nBlocks; b0++) {
    var block = cw.slice(b0 * per, (b0 + 1) * per);
    var rem = [];
    for (i = 0; i < eccLen; i++) rem.push(0);
    block.forEach(function (byte) {
      var f = byte ^ rem[0];
      rem.shift(); rem.push(0);
      if (f) for (var k = 0; k < eccLen; k++) rem[k] ^= qrMul(gen[eccLen - 1 - k], f);
    });
    blocks.push(block); eccs.push(rem);
  }
  var out = [];
  for (i = 0; i < per; i++) for (j = 0; j < nBlocks; j++) out.push(blocks[j][i]);
  for (i = 0; i < eccLen; i++) for (j = 0; j < nBlocks; j++) out.push(eccs[j][i]);

  /* matrix: function patterns first, then zigzag data with mask 0 */
  var size = 17 + 4 * ver;
  var M = [], F = [];
  for (i = 0; i < size; i++) { M.push(new Array(size).fill(0)); F.push(new Array(size).fill(false)); }
  function set(x, y, dark) { M[y][x] = dark ? 1 : 0; F[y][x] = true; }
  function finder(cx, cy) {
    for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
      var x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      var d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  for (i = 8; i < size - 8; i++) {
    if (!F[6][i]) set(i, 6, i % 2 === 0);
    if (!F[i][6]) set(6, i, i % 2 === 0);
  }
  QR_ALIGN[ver].forEach(function (cy) {
    QR_ALIGN[ver].forEach(function (cx) {
      if (F[cy][cx]) return; // overlaps a finder
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++)
        set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    });
  });
  /* format info for level M + mask 0 is the constant 0x5412 */
  var fmt = 0x5412;
  function fbit(i) { return (fmt >> i) & 1; }
  for (i = 0; i <= 5; i++) set(8, i, fbit(i));
  set(8, 7, fbit(6)); set(8, 8, fbit(7)); set(7, 8, fbit(8));
  for (i = 9; i <= 14; i++) set(14 - i, 8, fbit(i));
  for (i = 0; i <= 7; i++) set(size - 1 - i, 8, fbit(i));
  for (i = 8; i <= 14; i++) set(8, size - 15 + i, fbit(i));
  set(8, size - 8, 1); // the always-dark module

  var bi = 0, nbits = out.length * 8;
  for (var right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (var vert = 0; vert < size; vert++) {
      for (j = 0; j < 2; j++) {
        var x = right - j;
        var y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (F[y][x] || bi >= nbits) continue;
        var bit = (out[bi >> 3] >> (7 - (bi & 7))) & 1;
        bi++;
        M[y][x] = bit ^ ((x + y) % 2 === 0 ? 1 : 0);
      }
    }
  }
  return M;
}

/* ---------- pair overlay ---------- */
var qrOverlay = document.getElementById('qrOverlay');
var qrCanvas = document.getElementById('qrCanvas');
function openPhonePair() {
  if (!PHONE_BASE) { toast('No session to pair yet'); return; }
  // no task in the url — the phone follows whatever task the board is on
  var url = PHONE_BASE;
  trace('phone:pair', { url: url });
  var mtx = qrMatrix(url);
  if (!mtx) { toast('Pairing link too long for a QR'); return; }
  // canvas sized to exactly quiet zone + modules, so the code sits centered
  var quiet = 4, cells = mtx.length + quiet * 2;
  var px = Math.max(3, Math.floor(232 / cells));
  qrCanvas.width = qrCanvas.height = cells * px;
  qrCanvas.style.width = qrCanvas.style.height = cells * px + 'px';
  var ctx = qrCanvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, qrCanvas.width, qrCanvas.height);
  ctx.fillStyle = '#000';
  mtx.forEach(function (row, y) {
    row.forEach(function (dark, x) {
      if (dark) ctx.fillRect((quiet + x) * px, (quiet + y) * px, px, px);
    });
  });
  qrOverlay.hidden = false;
}
document.getElementById('tbPhone').addEventListener('click', openPhonePair);
document.getElementById('qrClose').addEventListener('click', function () { qrOverlay.hidden = true; });
qrOverlay.addEventListener('mousedown', function (e) { if (e.target === qrOverlay) qrOverlay.hidden = true; });
