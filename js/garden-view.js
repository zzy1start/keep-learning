/* ============ garden-view.js : 树园渲染（SVG 矢量画树）============ */

/** 树的状态配色 */
const TREE_STYLE = {
  sapling: { leaf: '#7cc576', leaf2: '#5aa85a', trunk: '#8d6748', label: '树苗', desc: '刚种下，记忆还很新' },
  young:   { leaf: '#4caf50', leaf2: '#388e3c', trunk: '#795548', label: '成长中', desc: '还没到复习时间，记忆尚可' },
  long:    { leaf: '#2e7d32', leaf2: '#1b5e20', trunk: '#5d4037', label: '成树', desc: '记忆牢固，保持率高' },
  withered:{ leaf: '#b8a04a', leaf2: '#8f7a30', trunk: '#7a6248', label: '枯萎', desc: '已到期未复习，需要巩固' },
  stump:   { leaf: null,        leaf2: null,        trunk: '#6d5b45', label: '木桩', desc: '遗忘过深，永久枯萎' },
};

/**
 * 树种色板 —— 决定树冠的**色相**，让不同树种一眼可辨（图2要求）：
 *   松柏深绿 · 银杏金黄 · 香樟嫩绿 · 枫树橙红 · 樱花粉 · 梨树白花 · 垂柳翠绿
 * 状态（树苗/成长中/成树）只影响**明暗与饱和度**，不改变色相。
 */
const SPECIES_HUE = {
  conifer:    { leaf: '#2f6b3f', leaf2: '#1e4d2b', trunk: '#6b4f35' },  // 松柏深绿
  ginkgo:     { leaf: '#f0b429', leaf2: '#d99a12', trunk: '#8a6b45' },  // 银杏金黄
  evergreen:  { leaf: '#7cc576', leaf2: '#5aa85a', trunk: '#7d6244' },  // 香樟嫩绿
  maple:      { leaf: '#ef6c3b', leaf2: '#d9541f', trunk: '#7a5c3d' },  // 枫树橙红
  blossom:    { leaf: '#f7a8c4', leaf2: '#e78aa9', trunk: '#8b6b52' },  // 樱花粉
  pear:       { leaf: '#80bd5b', leaf2: '#5ca546', trunk: '#8d7455' },  // 梨树绿冠白花
  willow:     { leaf: '#86c66b', leaf2: '#63a94c', trunk: '#7d6244' },  // 垂柳翠绿
  poplar:     { leaf: '#9ad46f', leaf2: '#7bb85a', trunk: '#84a06a' },
  birch:      { leaf: '#a8d98a', leaf2: '#87bd6a', trunk: '#d7d2c5' },  // 白桦浅白干
  oak:        { leaf: '#4f8a3d', leaf2: '#3a6b2c', trunk: '#6d5238' },
  locust:     { leaf: '#5f9e4a', leaf2: '#467a36', trunk: '#6f5940' },
  legume:     { leaf: '#63a34e', leaf2: '#4a8039', trunk: '#6f5940' },
  ash:        { leaf: '#6fae5c', leaf2: '#548c45', trunk: '#75705f' },
  bamboo:     { leaf: '#8ec96f', leaf2: '#6ca955', trunk: '#9cb35f' },
  ornamental: { leaf: '#c98fb0', leaf2: '#ab6f8e', trunk: '#7d5f52' },
  unknown:    { leaf: '#7cc576', leaf2: '#5aa85a', trunk: '#8d6748' },
};

/**
 * 按树种 + 状态取配色。
 * 色相来自树种（保证辨识度），明度由状态决定（未成熟偏浅、成熟偏深）。
 */
function speciesStyle(info, state) {
  const hue = SPECIES_HUE[info.kind] || SPECIES_HUE[info.id] || SPECIES_HUE.unknown;
  const st = TREE_STYLE[state] || TREE_STYLE.sapling;
  if (state === 'stump') return st;            // 木桩无叶
  // 幼年期整体提亮、饱和度降低，模拟"小树"
  const fade = state === 'sapling' ? 0.34 : (state === 'young' ? 0.16 : 0);
  const mix = (hex, amt) => {
    if (!hex) return hex;
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) + (255 - ((n >> 16) & 255)) * amt);
    const g = Math.round(((n >> 8) & 255) + (255 - ((n >> 8) & 255)) * amt);
    const b = Math.round((n & 255) + (255 - (n & 255)) * amt);
    return `rgb(${r},${g},${b})`;
  };
  if (state === 'withered') return st;         // 枯萎统一枯黄色
  return {
    leaf: mix(hue.leaf, fade),
    leaf2: mix(hue.leaf2, fade),
    trunk: hue.trunk,
    label: st.label, desc: st.desc,
  };
}

/**
 * 铁树 SVG —— 铁树不开花是成语来源，这里做成"始终不长大的矮壮树 + 顶端尖刺"
 * @param {boolean} bloomed是否已开花
 */
Garden.drawIron = function (bloomed, size = 90) {
  const w = size, h = size, cx = w / 2, gy = h - 4;
  const leaf = bloomed ? '#e0559a' : '#5a7d5e';
  const leaf2 = bloomed ? '#f08ec0' : '#456a4a';
  const trunk = bloomed ? '#6b4a5a' : '#5a5049';

  // 铁树：粗壮矮化的树干 + 顶部尖刺叶
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="treesvg" title="铁树${bloomed ? '（已开花）' : ''}">
    <ellipse cx="${cx}" cy="${gy}" rx="${w * 0.26}" ry="3" fill="rgba(0,0,0,.10)"/>
    <path d="M${cx - 7} ${gy}
             C${cx - 6} ${gy - 16} ${cx - 5} ${gy - 26} ${cx - 4} ${gy - 32}
             L${cx + 4} ${gy - 32}
             C${cx + 5} ${gy - 26} ${cx + 6} ${gy - 16} ${cx + 7} ${gy} Z"
          fill="${trunk}"/>
    <path d="M${cx - 7} ${gy} C${cx - 6} ${gy - 16} ${cx - 5} ${gy - 26} ${cx - 4} ${gy - 32}"
          stroke="#463c34" stroke-width="1" fill="none" opacity=".5"/>`;

  // 顶部尖锐叶（铁树的标志）
  const spikes = [[-1, -0.85, -1], [0, -1, 0], [1, -0.85, 1]];
  spikes.forEach(([dx, dy, side]) => {
    const bx = cx + dx * 3, by = gy - 32;
    const tx = cx + dx * 15, ty = gy - 32 + dy * 15;
    svg += `<path d="M${bx} ${by} Q${cx + dx * 9} ${gy - 42} ${tx} ${ty}
      Q${cx + dx * 4} ${gy - 36} ${bx} ${by} Z" fill="${side === 0 ? leaf : leaf2}"/>`;
  });
  svg += `<circle cx="${cx}" cy="${gy - 36}" r="3.4" fill="${leaf}"/>`;

  if (bloomed) {
    // 花：五瓣小花，围绕树顶
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const px = cx + Math.cos(a) * 11, py = (gy - 44) + Math.sin(a) * 9;
      svg += `<circle cx="${px}" cy="${py}" r="4.2" fill="${leaf}" opacity=".9"/>
              <circle cx="${px}" cy="${py}" r="1.6" fill="#fff" opacity=".85"/>`;
    }
    svg += `<circle cx="${cx}" cy="${gy - 44}" r="2.4" fill="#ffe9a8"/>`;
  }
  svg += `</svg>`;
  return svg;
};

/**
 * 铁树卡片 HTML（抽成函数，供空态/有树两种场景复用）
 * @param {object} s   Garden.ironState() 结果
 * @param {object|null} bloomRec 本次新开花记录（用于横幅）
 */
function ironCardHTML(s, bloomRec, size = 78) {
  const bloomed = s.blooms.length > 0;
  const cond = s.cond.map(c => `<span class="${c.cur >= c.need ? 'ok' : 'no'}">
      ${c.cur >= c.need ? '✓' : '○'} ${c.k} ${c.cur}${c.u}/${c.need}${c.u}
    </span>`).join('');
  const missing = s.cond.filter(c => c.cur < c.need);
  const tip = bloomed
    ? `已开花 ${s.blooms.length} 次，这是长期坚持的证明。继续学习可再次开花。`
    : s.allOk
      ? '✅ 条件已达成，下次进入首页时铁树将开花'
      : `还差：<b>${missing.map(c => c.k).join('、')}</b>（最近一项差 ${s.daysToBloom}）`;

  return `
  <div class="iron-card ${s.allOk ? 'ready' : ''} ${bloomed ? 'bloomed' : ''}" data-iron>
    <div class="ic-icon">${Garden.drawIron(bloomed, size)}</div>
    <div class="ic-info">
      <div class="ic-title">铁树
        <span class="tag ${bloomed ? 'tag-pur' : 'tag-warn'}">${
    bloomed ? '已开花 ' + s.blooms.length + ' 次' : (s.grown ? '待开花' : '未长成')}</span></div>
      <div class="ic-sub">${bloomed
      ? `最近开花：<b>${s.lastBloom}</b>　「铁树开花」——比喻极难之事终于实现`
      : `连续学习满 <b>${Garden.IRON.GROW_DAYS}</b> 天后长出，目前<b>${s.streak}</b> 天`}</div>
      ${!bloomed ? `<div class="ic-cond">${cond}</div>` : ''}
      <div class="ic-tip">${tip}</div>
    </div>
  </div>
  ${bloomRec ? `<div class="bloom-toast">🌸 铁树开花！连续学习 ${bloomRec.streak} 天，保持率 ${bloomRec.R}%，质量 ${bloomRec.Q}%，掌握 ${bloomRec.words} 词——了不起！</div>` : ''}`;
}

/** 生长只由进度决定；记忆状态（枯萎、木桩）另行显示。 */
Garden.growthStage = function (growth) {
  const g = Math.max(0, Math.min(1, Number(growth) || 0));
  if (g >= 1) return { id: 'mature', label: '成树', visualState: 'long' };
  if (g >= 0.70) return { id: 'growing', label: '成长中', visualState: 'young' };
  if (g >= 0.25) return { id: 'small', label: '小树', visualState: 'sapling' };
  return { id: 'seedling', label: '幼苗', visualState: 'sapling' };
};

Garden.growthPercent = function (growth) {
  const g = Math.max(0, Math.min(1, Number(growth) || 0));
  return g >= 1 ? 100 : Math.min(99, Math.round(g * 100));
};

/** 画一棵具体的树（SVG），按 kind 区分形态 */
Garden.drawTree = function (t, opts = {}) {
  const info = this.infoOf(t.species);
  const g = Math.max(0, Math.min(1, t.growth || 0));
  const size = opts.size || 56;
  const growthStage = this.growthStage(g);
  const stage = t.state === 'stump' || t.state === 'withered' ? t.state
    : growthStage.visualState;
  const spriteKinds = ['conifer', 'ginkgo', 'evergreen', 'maple', 'blossom', 'pear', 'willow'];
  const spriteIndex = spriteKinds.indexOf(info.kind);

  // 幼苗用双叶图，未成熟用幼树插画，满进度才换成成树插画；
  // 园内与下方卡片始终调用同一个绘制函数。
  if (growthStage.id === 'seedling' && t.state !== 'stump' && t.state !== 'withered') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" class="treesvg" title="${esc(info.name)} · 幼苗">
      <ellipse cx="50" cy="89" rx="19" ry="5" fill="#e6ca9b" opacity=".85"/>
      <path d="M50 87 Q49 78 50 70" fill="none" stroke="#806246" stroke-width="3" stroke-linecap="round"/>
      <path d="M49 74 Q38 59 33 65 Q33 76 49 77Z" fill="#5aa845"/>
      <path d="M50 73 Q63 58 67 63 Q66 75 50 77Z" fill="#80c95d"/>
      <path d="M37 66 Q42 71 47 74 M64 64 Q59 69 53 74" fill="none" stroke="#a2dc81" stroke-width="1.3" opacity=".8"/>
    </svg>`;
  }
  if (spriteIndex >= 0 && g >= 0.25 && t.state !== 'stump') {
    // 两组图按实际透明间隙裁切，保留完整树冠；未成熟只用幼树图。
    const mature = g >= 1;
    const crops = mature
      ? [[40, 265], [315, 285], [600, 287], [887, 293],
        [1181, 282], [1463, 288], [1750, 295]]
      : [[20, 260], [290, 285], [585, 275], [880, 280],
        [1180, 270], [1480, 270], [1765, 285]];
    const [cropX, cropW] = crops[spriteIndex];
    const scale = mature ? 1 : (0.47 + 0.36 * (g - 0.25) / 0.75);
    const filter = t.state === 'withered' ? 'filter:sepia(.5) saturate(.55);' : '';
    const asset = mature ? 'assets/garden-tree-strip.png' : 'assets/garden-young-strip.png';
    const top = mature ? 205 : 220;
    const height = mature ? 370 : 350;
    return `<svg width="${size}" height="${size}" viewBox="${cropX} ${top} ${cropW} ${height}" preserveAspectRatio="none"
      class="treesvg garden-tree-art" role="img" aria-label="${esc(info.name)} · ${growthStage.label}"
      style="transform:scale(${scale.toFixed(3)});transform-origin:center bottom;${filter}">
      <image href="${asset}" width="2073" height="${mature ? 758 : 759}"/>
    </svg>`;
  }
  // 记忆状态与树的成长阶段分别显示；成熟前不能画成大树。
  const visualState = stage;
  // 配色 = 树种色相 × 状态明暗（不是纯按状态区分）
  const st = speciesStyle(info, visualState);
  const h = size, w = size;
  const stump = visualState === 'stump';

  // 成长度：0~1 映射尺寸。树苗固定很小（当天新种），随R 长大
  // 树苗最小、成树最大；young 略小于 long
  const s = visualState === 'sapling' ? 0.48 + g * 0.30
    : visualState === 'young' ? 0.68 + g * 0.25
      : 0.78 + g * 0.22;
  const cx = w / 2;
  const groundY = h - 3;

  // 树干
  const trunkH = (stump ? 6 : 22 * s);
  const trunkW = Math.max(2, (stump ? 6 : 3.4 * s));
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="treesvg" title="${esc(info.name)} · ${t.state === 'stump' || t.state === 'withered' ? st.label : growthStage.label}">
    <ellipse cx="${cx}" cy="${groundY}" rx="${w * 0.32}" ry="2.5" fill="rgba(0,0,0,.08)"/>`;

    if (stump) {
    // 木桩：短桩+年轮+顶部裂口
    svg += `<rect x="${cx - trunkW / 2}" y="${groundY - trunkH}" width="${trunkW}" height="${trunkH}"
             rx="1" fill="${st.trunk}"/>
      <ellipse cx="${cx}" cy="${groundY - trunkH}" rx="${trunkW / 2}" ry="1.4" fill="#8d745a"/>
      <ellipse cx="${cx}" cy="${groundY - trunkH}" rx="${trunkW / 4}" ry=".7" fill="none" stroke="#6d5b45" stroke-width=".6"/>
      <path d="M${cx - trunkW / 2} ${groundY - trunkH + 1} l2 2 l1.5 -1.5 l1.5 2"
            stroke="#5d4c39" stroke-width=".8" fill="none"/>`;
  } else {
    // 树干（略带弯曲）
    const topY = groundY - trunkH;
    svg += `<path d="M${cx - trunkW / 2} ${groundY}
             C${cx - trunkW / 2} ${topY + trunkH * 0.4} ${cx - 1} ${topY + 2} ${cx} ${topY}
             C${cx + 1} ${topY + 2} ${cx + trunkW / 2} ${topY + trunkH * 0.4} ${cx + trunkW / 2} ${groundY} Z"
             fill="${st.trunk}"/>`;

    // 枝叶按树种类型
    const r = (size * 0.32) * s;
    const canopyY = topY - r * 0.55;
    const kind = info.kind;
    if (kind === 'conifer') {
      // 针叶：三角塔形
      const layers = 3;
      for (let i = 0; i < layers; i++) {
        const yy = canopyY + i * r * 0.52;
        const rr = r * (1 - i * 0.24);
        svg += `<path d="M${cx} ${yy - rr * 0.85} L${cx + rr} ${yy + rr * 0.3} L${cx - rr} ${yy + rr * 0.3} Z"
                 fill="${i % 2 ? st.leaf2 : st.leaf}" opacity="${0.95 - i * 0.08}"/>`;
      }
    } else if (kind === 'bamboo') {
      svg += `<rect x="${cx - 1.6}" y="${canopyY - r}" width="3.2" height="${r + 6}" rx="1.6" fill="${st.trunk}"/>`;
      for (let i = -1; i <= 1; i++) {
        svg += `<path d="M${cx} ${canopyY + i * r * 0.5} q${i * 7} -4 ${i * 11} 1"
                 stroke="${st.leaf}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
      }
    } else if (kind === 'blossom') {
      svg += `<circle cx="${cx}" cy="${canopyY - r * 0.2}" r="${r}" fill="${st.leaf}" opacity=".9"/>
        <circle cx="${cx - r * .5}" cy="${canopyY - r * .5}" r="${r * .45}" fill="#ffc7dd"/>
        <circle cx="${cx + r * .45}" cy="${canopyY - r * .55}" r="${r * .4}" fill="#ffd6e5"/>
        <circle cx="${cx + r * .1}" cy="${canopyY + r * .25}" r="${r * .4}" fill="#ffc0d8"/>`;
    } else if (kind === 'willow') {
      svg += `<circle cx="${cx}" cy="${canopyY - r * 0.3}" r="${r * 0.9}" fill="${st.leaf}" opacity=".92"/>`;
      for (let i = -2; i <= 2; i++) {
        svg += `<path d="M${cx + i * r * 0.4} ${canopyY} q${i * 1.5} ${r * 0.9} ${i * 2} ${r * 1.3}"
                 stroke="${st.leaf2}" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".8"/>`;
      }
    } else if (kind === 'birch') {
      svg += `<ellipse cx="${cx}" cy="${canopyY - r * 0.35}" rx="${r * 0.75}" ry="${r * 1.05}" fill="${st.leaf}"/>
        <g opacity=".8">${[0.3, 0.5, 0.7].map(p =>
        `<rect x="${cx - r * 0.3}" y="${canopyY - r * 1.3 + p * r * 1.6}" width="${r * 0.6}" height="1.6" fill="#2b2b2b" opacity=".55"/>`).join('')}</g>`;
    } else if (kind === 'oak' || kind === 'maple' || kind === 'locust') {
      // 圆冠（深绿）
      svg += `<circle cx="${cx}" cy="${canopyY - r * 0.3}" r="${r}" fill="${st.leaf}"/>
        <circle cx="${cx - r * .55}" cy="${canopyY + r * .1}" r="${r * .62}" fill="${st.leaf2}" opacity=".9"/>
        <circle cx="${cx + r * .5}" cy="${canopyY - r * .1}" r="${r * .58}" fill="${st.leaf2}" opacity=".85"/>`;
    } else if (kind === 'ginkgo') {
      /* 银杏：扇形叶冠。用「圆心在下方」的扇形（叶柄朝下、扇面朝上），
         之前用 A 弧画在了错误的一侧导致形状歪斜。*/
      const fan = (dx, dy, sc, col, op) => {
        const rr = r * sc;
        const px = cx + dx, py = canopyY + dy;     // 扇柄根部
        return `<path d="M${px} ${py}
          L${px - rr} ${py}
          A${rr} ${rr} 0 0 1 ${px + rr} ${py}
          Z" fill="${col}" opacity="${op}"/>`;
      };
      svg += fan(0, -r * 0.1, 1.0, st.leaf, 1)
        + fan(-r * 0.66, -r * 0.32, 0.6, st.leaf2, .92)
        + fan(r * 0.66, -r * 0.32, 0.6, st.leaf2, .92);
    } else if (kind === 'pear') {
      /* 梨树：白花圆冠（整体偏白 + 明显白点花） */
      svg += `<circle cx="${cx}" cy="${canopyY - r * 0.3}" r="${r * 0.98}" fill="${st.leaf}"/>
        <circle cx="${cx - r * .48}" cy="${canopyY + r * .08}" r="${r * 0.62}" fill="${st.leaf2}" opacity=".95"/>
        <circle cx="${cx + r * .46}" cy="${canopyY - r * .05}" r="${r * 0.58}" fill="${st.leaf2}" opacity=".9"/>
        <g fill="#fffef9" opacity=".98">
          ${[[-.4, -.6], [.1, -.78], [.52, -.32], [-.62, -.18], [-.05, -.25], [.3, -.5]].map(([dx, dy]) =>
        `<circle cx="${cx + r * dx}" cy="${canopyY + r * dy}" r="${Math.max(1.4, r * 0.17)}"/>`).join('')}
        </g>`;
    } else {
      // 默认圆冠
      svg += `<circle cx="${cx}" cy="${canopyY - r * 0.3}" r="${r}" fill="${st.leaf}"/>
        <circle cx="${cx - r * .4}" cy="${canopyY + r * .05}" r="${r * 0.6}" fill="${st.leaf2}" opacity=".85"/>`;
    }
  }
  svg += `</svg>`;
  return svg;
};

/**
 * 树园整块渲染 —— 「空地 + 树种库」两段式布局
 *
 * 上半部分：一片草地（学习树园），已成熟的树散落其中，
 *          当前正在培育的树苗单独高亮显示。
 * 下半部分：树种库网格（收集齐树种即"收集完成"）。
 *
 * 流程：空地 → 种下树苗 → 按累计时长与质量逐步长大 → 成熟留在园中 → 种下一棵
 */
Garden.renderGarden = function (opts = {}) {
  const g = this._g();
  this.refresh();
  const st = this.stats();

  const all = g.trees;
  // 当前培育始终是唯一未成熟的最后一棵；成熟树不再标为当前。
  const current = [...all].reverse().find(t => t.state !== 'stump' && t.growth < 1) || null;
  // 其余按种植时间排序（早种的在前）——与下方卡片顺序一致
  const ownedSet = new Set(all.map(t => t.species));
  const stCounts = { long: 0, young: 0, sapling: 0, withered: 0, stump: 0 };
  all.forEach(t => { stCounts[t.state] = (stCounts[t.state] || 0) + 1; });

  /* ---------- 树园：横向长方形，轻俯视，微缩插画 ----------
   * 树木尺寸小、错落分布、保留大片留白；
   * 当前树苗用浅色光圈突出。
   */
  const lawnHTML = `
    <div class="lawn">
      <div class="lawn-title">学习树园</div>
      <div class="lawn-caption">随学习时长慢慢生长</div>
      <div class="lawn-body">
        ${all.length ? all.map((t, i) => this._lawnTree(t, t === current ? 'current' : 'done', i)).join('')
      : `<div class="lawn-empty">
            <div class="le-t">这片地还空着</div>
            <div class="le-s">完成今日学习后会种下第一棵树苗</div>
          </div>`}
      </div>
      <div class="lawn-footer">成熟一棵，再种下一棵</div>
    </div>`;

  /* ---------- 状态图例 ---------- */
  const legendHTML = `
    <div class="lawn-legend">
      <span><i class="lg seedling"></i>幼苗 0–24%</span>
      <span><i class="lg small"></i>小树 25–69%</span>
      <span><i class="lg young"></i>成长中 70–99%</span>
      <span><i class="lg long"></i>成树 100%</span>
      <span><i class="lg withered"></i>枯萎（可恢复）</span>
      <span><i class="lg stump"></i>木桩（永久）</span>
    </div>`;

  /* ---------- 逐棵状态卡片：与园中一一对应 ----------
   * 每张卡片展示：树形图示、树种名、状态、进度百分比、进度条、种植日期。
   * 当前培育的卡片绿色高亮描边 + 右上角「当前培育」标签。
   */
  const cardsHTML = all.length ? all.map(t => {
    const isCur = t === current;
    const pct = this.growthPercent(t.growth);
    const growthStage = this.growthStage(t.growth);
    /* 标签按成长度呈现：满进度即「成树」。
     * （state 反映的是记忆保持状况，卡片给的是"长得怎么样"，
     *   两者不完全等价，所以这里以成长度为准。）*/
    const label = t.state === 'stump' ? '木桩' : t.state === 'withered' ? '枯萎'
      : growthStage.label;
    return `<div class="tcard ${isCur ? 'cur' : ''}" data-tid="${t.id}" title="${esc(t.species)} · ${label}">
      ${isCur ? '<div class="tcard-flag">当前培育</div>' : ''}
      <div class="tcard-art">${this.drawTree(t, { size: 82 })}</div>
      <div class="tcard-name">${esc(t.species)}</div>
      <div class="tcard-state ${t.state === 'stump' || t.state === 'withered' ? t.state : growthStage.id}">${label} <b>${pct}%</b></div>
      <div class="tcard-bar"><i style="width:${pct}%"></i></div>
      <div class="tcard-date">${esc(t.date)}</div>
    </div>`;
  }).join('') : '<div class="hint" style="padding:14px 4px">还没有种下任何树。完成今日学习后会种下第一棵。</div>';

  return `
  <div class="garden-head">
    <div class="gh-left">
      <div class="gh-title">我的树园</div>
      <div class="gh-sub">${all.length} 棵累计 · 存活 ${all.length - stCounts.stump} · 木桩 ${stCounts.stump}</div>
    </div>
    <div class="gh-right">
      <div class="gh-r"><b>${Math.round(st.avgR * 100)}%</b><span>平均记忆保持</span></div>
      <div class="gh-r"><b>${ownedSet.size}</b><span>树种数</span></div>
    </div>
  </div>
  ${lawnHTML}
  ${legendHTML}
  <div class="tcard-row">${cardsHTML}</div>
  ${this._ironHTML()}
  ${g.schoolTree ? `<div class="school-note">🌳 校树：<b>${esc(g.schoolTree.name)}</b>${g.schoolTree.note ? '（' + esc(g.schoolTree.note) + '）' : ''}　约 40% 概率出现</div>` : ''}`;
};

/** 展开面板时的内容（三个按钮共用） */
Garden.panelHTML = function (which) {
  if (which === 'species') {
    const g = this._g();
    const owned = [...new Set(g.trees.map(t => t.species))];
    const cards = this.SPECIES.map(s => {
      const got = owned.includes(s.name);
      const isSchool = g.schoolTree && g.schoolTree.name === s.name;
      return `<div class="sp-card ${got ? 'got' : ''} ${isSchool ? 'school' : ''}" data-sp="${esc(s.name)}"
          title="${esc(s.latin)}　${esc(s.note || '')}　成熟约 ${s.matureDays} 天${isSchool ? '　（校树）' : ''}">
          <div class="sp-art">${this._miniTree(s, 54)}</div>
          <div class="sp-name">${esc(s.name)}</div>
          <div class="sp-meta">${got ? s.matureDays + ' 天成材' : '未收集'}</div>
          ${isSchool ? '<div class="sp-badge">校树</div>' : ''}
        </div>`;
    }).join('');
    return `<div class="sp-sec-h">树种库<span>${owned.length} / ${this.SPECIES.length}</span></div>
      <div class="sp-grid">${cards}</div>
      <div class="hint" style="margin-top:9px">树种<b>随机分配</b>，无法指定——种到哪棵就收集哪棵。</div>`;
  }

  if (which === 'rules') {
    const HEALY = 0.85, WITHER = 0.55;
    return `<div class="rule-box">
      <b>一句话</b>：一次只培育一棵树；英语学习时长推动当前树成长，成熟后下次学习再种新树。<br><br>
      <b>保持率怎么算？</b><br>
      公式 <code>R(t) = e^(−t / S)</code>，其中 <code>S = ef × 间隔天数</code>，
      <code>t</code> 是距上次复习的天数。与 SM-2 间隔重复模型一致：<b>复习间隔越长，遗忘越快</b>。<br><br>
      <b>状态判定</b>（阈值固定）：<br>
      <table style="width:100%;font-size:12px;margin-top:5px;border-collapse:collapse">
        <tr><td style="padding:3px 0;width:150px"><b style="color:var(--ok)">R ≥ 85%</b></td><td>记忆健康</td></tr>
        <tr><td style="padding:3px 0"><b style="color:var(--ok)">55%–85%</b> 未到期</td><td>保持良好（不算忘）</td></tr>
        <tr><td style="padding:3px 0"><b style="color:var(--warn)">55%–85%</b> 已逾期</td><td>枯萎，<b>可恢复</b></td></tr>
        <tr><td style="padding:3px 0"><b style="color:var(--err)">R &lt; 55%</b></td><td>木桩，<b>永不恢复</b></td></tr>
      </table><br>
      到期当天 <code>t = 间隔</code>，此时 <code>R = e⁻¹ ≈ 37%</code>，
      所以<b>「到期不复习必然开始枯萎」</b>。<br><br>
      <b>新树成长度</b> = 当前树累计有效学习时长 ÷ 该树种所需时长；既有树木沿用旧版规则。<br>
      <b>外观阶段</b>：0–24% 幼苗，25–69% 小树，70–99% 成长中，100% 才是成树。<br>
      不同树种<b>成熟周期不同</b>：垂柳 22 天，油松 90 天。<br><br>
      <b>不会发生的事</b>：手动改数据库或不复习都挡不住枯萎。木桩是<b>永久</b>的。
    </div>`;
  }

  // which === 'school'
  const g = this._g();
  const cur = g.schoolTree;
  return `<div class="hint" style="margin-bottom:11px">
      填写你学校的校树后，树园里会以约 <b>40%</b> 的概率种出它。校树信息只保存在本机。
    </div>
    <div class="fld">
      <label class="lab">校树名称</label>
      <input class="inp" id="scName" placeholder="如：油松 / 银杏 / 樟子松" value="${esc(cur ? cur.name : '')}">
    </div>
    <div class="fld">
      <label class="lab">备注（可选）</label>
      <input class="inp" id="scNote" placeholder="如：校园主道两侧" value="${esc(cur ? (cur.note || '') : '')}">
    </div>
    <div class="sec-t">或从辽宁常见树种中选择</div>
    <div class="garden-species-grid">
      ${this.SPECIES.filter(s => s.local).map(s =>
    `<div class="sp-item ${cur && cur.name === s.name ? 'on' : ''}" data-sp="${esc(s.name)}">
            ${esc(s.name)}<small>${esc(s.note || '')}</small></div>`).join('')}
    </div>
    <div class="row" style="margin-top:14px;gap:8px">
      ${cur ? '<button class="btn btn-warn btn-s" id="scClr">清除校树</button>' : ''}
      <span class="sp"></span>
      <button class="btn btn-gh btn-s" data-panel-close>收起</button>
      <button class="btn btn-pri btn-s" id="scSave">保存校树</button>
    </div>`;
};

/** 草地中的一棵树 */
Garden._lawnTree = function (t, kind, index) {
  const g = Math.max(0, Math.min(1, t.growth || 0));
  const growthStage = this.growthStage(g);
  const label = t.state === 'stump' ? '木桩' : t.state === 'withered' ? '枯萎'
    : growthStage.label;
  /* 园内放大树形，画面的空地仍可继续容纳新树。 */
  const size = Math.round(78 + g * 34);
  /* 【2026-10-22 排版修复】原来第 9 棵起用 `(index%18)+1` 相邻列摆放，
   * 而 18 列栅格在平板宽度下每列只有 ~33px，树本身 78–112px 宽 →
   * 树冠与「当前培育」标签互相压叠。现在不再写死列号，交给 CSS 的
   * `repeat(auto-fill,minmax(...))` 自动排版：列宽永远 ≥ 树宽，多出的树自然换行。*/
  return `<div class="lawn-tree ${kind} ${t.state}" data-tid="${t.id}"
      title="${esc(t.species)} · ${label} · 成长 ${this.growthPercent(g)}%">
    ${kind === 'current' ? '<div class="lt-halo"></div>' : ''}
    ${this.drawTree(t, { size })}
    ${kind === 'current' ? '<div class="lt-tag">当前培育</div>' : ''}
  </div>`;
};

/** 树种库里的小图（已收集显示树形，未收集显示 ?） */
Garden._miniTree = function (speciesInfo, size) {
  return this.drawTree({
    species: speciesInfo.name, state: 'long', growth: 1, R: 0.9,
  }, { size });
};

/** 彩蛋：园中珍稀树种（不写明规则，达成条件后自然出现） */
Garden._ironHTML = function () {
  const s = this.ironState();
  const bloomRec = this.tryBloom();
  const s2 = this.ironState();
  const bloomed = s2.blooms.length > 0;

  // 未长成：完全不显示，保持神秘感
  if (!s2.grown) return '';

  return `<div class="rare-tree ${bloomed ? 'bloomed' : ''}" data-iron
      title="${bloomed ? '它开花了' : '园中有一株不常见的树'}">
    <div class="rt-art">${this.drawIron(bloomed, 46)}</div>
    <div class="rt-info">
      <div class="rt-t">园中有一株不常见的树</div>
      <div class="rt-s">${bloomed
      ? `它在 ${s2.lastBloom} 开花了 —— ${s2.blooms.length} 次`
      : `它还没有开花 · 连续学习 ${s2.streak} 天`}</div>
    </div>
  </div>
  ${bloomRec ? `<div class="bloom-toast">🌸 它开花了。连续学习 ${bloomRec.streak} 天，保持率 ${bloomRec.R}%，质量 ${bloomRec.Q}% —— 难得一见。</div>` : ''}`;
};
