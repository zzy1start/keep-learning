/* ============ ink.js : 电子笔手写输入 ============
 * canvas 绘制 + 手写识别（调用 AI 视觉模型，失败时保留笔迹供手动补充）
 */
let _ink = null;

function inkInit(canvas, opt = {}) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.lineWidth = opt.width ? opt.width() : 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = opt.color ? opt.color() : '#1a2337';

  const strokes = [];       // 每笔的点数组
  let cur = null, drawing = false;

  const pos = e => {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top, p: e.pressure || 1 };
  };
  const start = e => {
    e.preventDefault();
    drawing = true;
    cur = [pos(e)];
    strokes.push(cur);
    ctx.beginPath();
    ctx.moveTo(cur[0].x, cur[0].y);
  };
  const move = e => {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    cur.push(p);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const end = e => {
    if (!drawing) return;
    e.preventDefault();
    drawing = false;
    ctx.closePath();
  };

  canvas.onmousedown = start;
  canvas.onmousemove = move;
  window.addEventListener('mouseup', end);
  canvas.ontouchstart = start;
  canvas.ontouchmove = move;
  canvas.ontouchend = end;

  _ink = {
    canvas, ctx, strokes,
    clear() {
      ctx.fillStyle = getComputedStyle(canvas).backgroundColor === 'rgb(247, 249, 252)' ? '#f7f9fc' : '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      strokes.length = 0;
    },
    undo() { strokes.pop(); this.redraw(); },
    redraw() {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = opt.color ? opt.color() : '#1a2337';
      ctx.lineWidth = opt.width ? opt.width() : 2;
      strokes.forEach(st => {
        if (!st.length) return;
        ctx.beginPath();
        ctx.moveTo(st[0].x, st[0].y);
        st.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();
      });
    },
    isEmpty() { return strokes.length === 0; },
    toDataURL() { return canvas.toDataURL('image/png'); },
  };
  // 初次绘制背景
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function inkReset() { _ink && _ink.clear(); }
function inkUndo() { _ink && _ink.undo(); }
function inkSetColor(c) { if (_ink) _ink.ctx.strokeStyle = c; }
function inkSetWidth(w) { if (_ink) _ink.ctx.lineWidth = w; }
function inkText() {
  // 手写识别：需要 AI 视觉能力，这里返回空表示未启用
  return '';
}
async function inkRecognize() {
  if (!_ink || _ink.isEmpty()) return '';
  if (!AI.ready) { App.toast('手写识别需要启用 AI 视觉模型，请先在设置中配置', ''); return ''; }
  const c = AI.cfg;
  const b64 = _ink.toDataURL().split(',')[1];
  try {
    const r = await fetch(AI.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.key },
      body: JSON.stringify({
        model: c.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '识别这张手写英文图片中的全部英文文字，只输出识别出的英文内容本身，不要解释：' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } },
          ],
        }],
        max_tokens: 1000,
      }),
    });
    const j = await r.json();
    return (j.choices[0].message.content || '').trim();
  } catch (e) {
    App.toast('手写识别失败：' + e.message, 'err');
    return '';
  }
}
window.inkInit = inkInit; window.inkReset = inkReset; window.inkUndo = inkUndo;
window.inkText = inkText; window.inkRecognize = inkRecognize;
window.inkSetColor = inkSetColor; window.inkSetWidth = inkSetWidth;