/* ============ views/settings.js : 设置 ============ */
const ViewSettings = {
  render(root) {
    root = App.freshView();
    const s = Store.d.settings;
    const c = s.ai;
    const sizeMB = (localStorage.getItem(Store.KEY) || '').length / 1048576;
    /* 离线语音库状态：安装版才有 LocalTts 插件 */
    const lv = (typeof Speech !== 'undefined' && Speech.local) ? Speech.local : null;
    const lvAvailable = !!(lv && typeof lv.available === 'function' && lv.available());
    const lvReady = !!(lv && lv.ready);

    root.innerHTML = `
    <div class="phead">
      <div class="phead-ic"><svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg></div>
      <div>
        <h1>设置</h1>
        <div class="sub">所有数据仅保存在本机浏览器，不上传服务器</div>
      </div>
    </div>

    <div class="grid g2">
      <div>
        <div class="card">
          <div class="card-h">AI 配置（OpenAI 兼容接口）
                        <span class="r"><span class="tag ${AI.ready ? 'tag-ok' : (c.key ? 'tag-warn' : 'tag-warn')}">${AI.ready ? '已启用' : (c.key ? '已配置（连接异常）' : '未启用')}</span></span></div>
          <div class="card-b">
            ${c.key ? `<div class="ai-saved-tip" style="margin-bottom:12px">
              ✅ 配置已保存在本机，<b>下次打开无需重新配置</b>。
              只有更换接口地址或模型时才需要再改下面三项。
            </div>` : ''}
            <div class="hint" style="margin-bottom:14px">
              填写后：写作评分、长难句分析、生词在线释义、AI 出题、AI 阅读材料自动启用。<br>
              <b>不填写也能正常使用全部模块</b>，AI 相关功能会降级为本地规则（精度有限）。<br>
              Key仅保存在你本机 localStorage，不经过任何第三方服务器（请求直接发往你填写的接口）。
            </div>
            <div class="fld">
              <label class="row" style="gap:9px;cursor:pointer;margin-bottom:10px">
                <span class="switch ${c.enabled ? 'on' : ''}" id="swAI"></span>
                <b style="font-size:13.5px">启用 AI 功能</b>
                <span class="sp"></span>
                <span class="hint" id="aiState" style="margin:0"></span>
              </label>
              <div class="hint" style="margin-top:6px">
                三项（Base URL / Key / 模型）填齐后点保存即自动启用，无需手动拨开关。
              </div>
            </div>
            <div class="fld"><label class="lab">Base URL（接口地址）</label>
              <input class="inp" id="aiUrl" placeholder="https://api.openai.com/v1" value="${esc(c.baseUrl)}">
              <div class="hint">常见填写：<br>
                OpenAI：<code>https://api.openai.com/v1</code><br>
                DeepSeek：<code>https://api.deepseek.com/v1</code><br>
                Kimi：<code>https://api.moonshot.cn/v1</code><br>
                通义：<code>https://dashscope.aliyuncs.com/compatible-mode/v1</code><br>
                本地 Ollama：<code>http://localhost:11434/v1</code></div></div>
            <div class="fld"><label class="lab">API Key</label>
              <div class="row" style="gap:6px;flex-wrap:wrap">
                <input class="inp" id="aiKey" type="password" placeholder="sk-..." value="${esc(c.key)}" style="flex:1;min-width:0">
                <button class="btn btn-gh btn-s" id="aiKeyEye" type="button" title="显示 / 隐藏 Key">👁</button>
              </div>
              <div class="hint">出于安全考虑默认隐藏；点👁 可确认已保存的 Key。留空则保留原 Key。</div></div>
            <div class="fld">
              <label class="lab">模型名称</label>
              <div class="row" style="gap:8px;flex-wrap:wrap">
                <input class="inp" id="aiModel" placeholder="点击右侧按钮自动获取，或手动填写" value="${esc(c.model)}" list="aiModelList" style="flex:1;min-width:0">
                <datalist id="aiModelList"></datalist>
                <button class="btn btn-gh" id="aiFetch" title="向接口请求当前 Key 可用的模型列表">获取可用模型</button>
              </div>
              <div class="hint">
                <b>不确定填什么？点「获取可用模型」</b>，会向你的接口拉取真实列表，避免模型名填错。<br>
                常见取值：OpenAI <code>gpt-4o</code> / <code>gpt-4o-mini</code>　·　
                DeepSeek <code>deepseek-flash</code> / <code>deepseek-v4-pro</code>　·
                Kimi <code>kimi-k2</code>　·　通义 <code>qwen-vl-max</code><br>
                <b>注意</b>：手写识别功能需要支持图片输入的模型（多模态）。纯文本模型不影响其他功能。
              </div>
              <div id="modelHint" class="hint" style="margin-top:6px"></div>
            </div>
            <div class="row">
              <button class="btn btn-pri" id="aiSave">保存配置</button>
              <button class="btn btn-gh" id="aiTest">测试连接</button>
            </div>
            <div id="aiMsg" class="hint" style="margin-top:10px"></div>
          </div>
        </div>

        <div class="card" style="margin-top:14px">
          <div class="card-h">外观与语音</div>
          <div class="card-b">
            <div class="fld"><label class="lab">主题</label>
              <div class="seg" id="themeSeg">
                ${[['light', '浅色'], ['dark', '深色'], ['auto', '跟随系统']].map(([k, t]) =>
        `<button class="${s.theme === k ? 'on' : ''}" data-theme="${k}">${t}</button>`).join('')}
              </div></div>
            <div class="fld"><label class="lab">🎧 听力发音</label>
              <div class="hint">语速 <b id="rateV">${s.speechRate}</b> 倍速（听力与背单词各自独立设置）</div>
              <input type="range" id="rateR" min="0.5" max="1.5" step="0.05" value="${s.speechRate}" style="width:100%">
              <div class="row" style="gap:8px;margin-top:7px">
                <select class="inp" id="voiceSelF" style="flex:1" title="听力里女说话人用的音色">
                  <option value="">女声：自动（Edge 下优先神经音色）</option>
                  ${Speech.list().map(v => `<option value="${esc(v.name)}"${v.name === s.speechVoiceFemale ? ' selected' : ''}>${esc(v.name)} (${v.lang})</option>`).join('')}
                </select>
                <select class="inp" id="voiceSelM" style="flex:1" title="听力里男说话人用的音色">
                  <option value="">男声：自动（Edge 下优先神经音色）</option>
                  ${Speech.list().map(v => `<option value="${esc(v.name)}"${v.name === s.speechVoiceMale ? ' selected' : ''}>${esc(v.name)} (${v.lang})</option>`).join('')}
                </select>
              </div>
              <div class="row" style="gap:8px;margin-top:7px">
                <select class="inp" id="leadInSel" style="width:auto" title="点播放后先缓冲再发声，听力独有">
                  ${[0, 0.5, 1, 1.5, 2, 3].map(v => `<option value="${v}"${Number(s.listenLeadIn == null ? 2 : s.listenLeadIn) === v ? ' selected' : ''}>缓冲 ${v}s</option>`).join('')}
                </select>
                <select class="inp" id="voiceSel" style="flex:1" title="男女都未单独指定时的统一音色">
                  <option value="">统一音色：自动</option>
                  ${Speech.list().map(v => `<option value="${esc(v.name)}"${v.name === s.speechVoice ? ' selected' : ''}>${esc(v.name)} (${v.lang})</option>`).join('')}
                </select>
              </div>
              <div class="hint">听力原文里<b>男女说话人分别用上面两个音色</b>（没有说话人标记时按对话男女交替）——
                这就是"男女对读"的来源，不要在"统一音色"里选具体音色，否则两人会共用一个。
                起始缓冲是<b>听力独有</b>的需求（点播放先看到第一句再出声），与背单词无关。
                <button class="btn btn-xs btn-gh" id="testSay">试听句子并计时</button></div>
              ${Speech.list().length === 0 ? `<div class="hint" style="color:var(--warn);line-height:1.9">
                未检测到英语音色：网页不能下载，需要在系统里安装（安装步骤见下方「发音与音色诊断」）。
              </div>` : ''}
              <div class="hint" id="nativeTtsState" style="margin-bottom:6px">
              原生 TTS：${(window.__nativeTts ? '已连接' : '未连接（PWA/桌面正常，安装版应已连接）')}
              · Capacitor：${(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ? '是' : '否'}
              · 英语音色：${Speech.list().length} 个
            </div>
            <div class="hint">系统可用英语音色 ${Speech.list().length} 个。
                下拉里是浏览器提供的音色；<b>桌面版 Edge</b> 会自动优先使用其中的神经音色（名称含 Online/Natural），
                想固定某个音色就在这里显式选择。往下还有「🩺 发音环境诊断」可查看完整清单。</div>
              ${Speech.voicePickWarning && Speech.voicePickWarning() ? `
              <div class="hint" style="margin-top:6px;color:var(--warn)">${esc(Speech.voicePickWarning())}</div>` : ''}
              </div>
            <div class="fld"><label class="lab">📖 背单词发音</label>
              <div class="hint">语速 <b id="wRateV">${s.wordRate == null ? 1 : s.wordRate}</b> 倍速（与听力独立；点认识/不认识/熟悉都会重播）</div>
              <input type="range" id="wRateR" min="0.6" max="1.4" step="0.05" value="${s.wordRate == null ? 1 : s.wordRate}" style="width:100%">
              <select class="inp" id="wVoiceSel" style="margin-top:7px">
                <option value="">跟随听力音色</option>
                ${Speech.list().map(v => `<option value="${esc(v.name)}"${v.name === s.wordVoice ? ' selected' : ''}>${esc(v.name)} (${v.lang})</option>`).join('')}
              </select>
              <div class="hint">发音测试与延迟诊断见下方「🩺 发音与音色诊断（高级）」。</div></div>
            <!-- 2026-10-22：原始「本地 TTS 试验」升级为正式离线语音库入口。
                 Piper 模型已放回 assets/models/piper（随 APK）；系统没有英语音色时
                 Speech.local 自动接管听力/单词，男女声由 gender 切换。 -->
            <div class="fld"><label class="lab">🗣 离线语音库（Piper · 男女声）</label>
              <div class="hint" style="margin-bottom:8px">
                安装版自带 4 个音色；<b>系统没有英语音色时自动接管</b>听力/单词朗读。
                默认女声 <b>jenny</b>（英音）、男声 <b>ryan</b>（美音，另有 joe 可选）；
                英音男声 alan 已按反馈移除（不像四六级录音）。<br>
                状态：<b id="localTtsState">${lvAvailable ? (lvReady ? '可用（4 个音色）' : '未就绪（首次播放时初始化）') : '非安装版不可用'}</b>
              </div>
              <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center">
                <label class="hint" style="margin:0;display:flex;gap:5px;align-items:center">女声
                  <select class="inp" id="localVoiceFemale" style="width:auto">
                    ${[['jenny', 'jenny · 女 · 英音'], ['amy', 'amy · 女 · 美音']].map(([v, t]) => `<option value="${v}"${(s.localVoiceFemale || 'jenny') === v ? ' selected' : ''}>${t}</option>`).join('')}
                  </select>
                </label>
                <label class="hint" style="margin:0;display:flex;gap:5px;align-items:center">男声
                  <select class="inp" id="localVoiceMale" style="width:auto">
                    ${[['ryan', 'ryan · 男 · 美音（默认）'], ['joe', 'joe · 男 · 美音（备用）']].map(([v, t]) => `<option value="${v}"${(s.localVoiceMale === v ? ' selected' : (!s.localVoiceMale && v === 'ryan' ? ' selected' : ''))}>${t}</option>`).join('')}
                  </select>
                </label>
                <button class="btn btn-xs btn-gh" id="testLocalFemale">试听女声</button>
                <button class="btn btn-xs btn-gh" id="testLocalMale">试听男声</button>
              </div>
              <label class="row" style="gap:8px;margin-top:9px;cursor:pointer">
                <span class="switch ${s.localTtsPreferred ? 'on' : ''}" id="swLocalPref"></span>
                <span>有系统音色时也优先使用离线语音库</span>
              </label>
              <div class="hint">默认关闭：桌面 Edge 的云端神经音色更自然；平板 0 个系统英语音色时无需打开也会自动使用。</div>
            </div>
            <details class="adv-diag">
              <summary>🩺 发音与音色诊断（高级）</summary>
              <div class="adv-body">
                <div class="row" style="gap:8px;margin-top:6px;align-items:center">
                  <button class="btn btn-xs btn-gh" id="autoVoices"
                    title="把听力女声/男声/统一音色与背单语音色改回「自动」，恢复优先使用云端神经音色">音色改回自动</button>
                  <span class="hint" style="margin:0">下拉里若选了本地音色（如 Microsoft Hazel/Zira），
                    对应的句子就是人机声——这个按钮一次改回去。</span>
                </div>
                <div class="hint">
                  <button class="btn btn-xs btn-gh" id="testWord">试听单词并计时</button>
                  <button class="btn btn-xs btn-gh" id="testVoices">对比音色延迟</button></div>
                <div class="hint" id="testWordHint">单词按上面的倍速朗读（默认 1.0，不受听力语速影响），计时拆成「起音 + 朗读」两段：起音大 = 系统引擎启动慢（换音色/换引擎才明显改善），朗读大 = 时长本身长。听感（是否吞首音节）仍需人工确认。</div>
                <div class="hint" style="margin-top:6px">
                  <button class="btn btn-xs btn-gh" id="diagRefresh">查看发音延迟诊断</button>
                  <span class="hint">连续朗读若越来越慢，把这张表发我即可定位</span></div>
                <div class="hint" id="diagBox" style="display:none"></div>
                <div class="hint" style="margin-bottom:4px">
                  <button class="btn btn-xs btn-gh" onclick="Speech.openInstallGuide('female')">查看音色安装步骤</button></div>
                <div class="fld"><label class="lab">🩺 发音环境诊断</label>
              <div class="hint">听力的整句朗读由<b>浏览器 / 系统的语音引擎</b>合成，音色来自操作系统，网页本身不下载音色。
                <b>桌面版 Edge</b> 自带 Azure 神经音色（名称含 <code>Online (Natural)</code>），比系统老式合成自然得多；
                手机 / 平板上的 Edge 没有这套云端音色，用的是系统 TTS。
                <b>桌面 Edge 会自动优先使用它们</b>（其它浏览器需手动打开下面的开关）。
                连续起音失败会自动退回本地音色，不会卡住听力。</div>
              <div class="row" style="gap:8px;margin-top:7px;flex-wrap:wrap">
                <button class="btn btn-s btn-gh" id="voiceDiag">查看音色清单与自动选择</button>
                <button class="btn btn-s btn-gh" id="cloudRetry" title="自愈把云端音色暂时关掉后，用它立刻重新启用">重新启用云端音色</button>
                <span class="hint" id="voiceDiagBox" style="white-space:pre-line;margin:0"></span>
              </div>
              <label class="hint" style="display:flex;gap:8px;align-items:flex-start;margin-top:10px;cursor:pointer">
                <input type="checkbox" id="onlineVoiceChk"${s.allowOnlineVoices ? ' checked' : ''} style="margin-top:3px">
                <span>非 Edge 浏览器也允许云端音色<br>
                  <span style="color:var(--tx3)">这些音色在 Chrome/Safari 下往往"有事件无声音"，
                  所以非 Edge 时默认不放行；Edge 里无需打开本开关。</span></span>
              </label></div>
            <div class="fld"><label class="lab">🗣 真人词典发音（可选）</label>
              <label class="hint" style="display:flex;gap:8px;align-items:flex-start;cursor:pointer">
                <input type="checkbox" id="dictAudioChk"${s.dictAudio ? ' checked' : ''} style="margin-top:3px">
                <span>背单词时优先使用真人词典录音（有道 dictvoice）<br>
                  <span style="color:var(--tx3)">需要经 <b>serve.js</b> 代理并缓存到本机（<code>.cache/dict-audio/</code>）。
                  800ms 内没拿到就自动回落到系统语音。<b>注意：打开后每个单词都会向第三方发起查询</b>，
                  会把你在背的词发出去，所以默认关闭。</span></span>
              </label>
              <div class="row" style="gap:8px;align-items:center;margin-top:7px">
                <select class="inp" id="dictAccentSel" style="width:auto">
                  ${[['2', '美音'], ['1', '英音']].map(([v, label]) => `<option value="${v}"${(s.dictAccent === v) ? ' selected' : ''}>${label}</option>`).join('')}
                </select>
                <span class="hint" id="dictAudioStatus">${Speech.dict.statusText ? Speech.dict.statusText() : ''}</span>
              </div></div>
            <div class="fld"><label class="lab">🎧 离线音频包（全词书单词 · 女声 + 内置听力句 · 男女声）</label>
              <div class="hint" style="margin-bottom:6px">状态：${typeof AudioPack !== 'undefined' && AudioPack.ready ? ('已加载 ' + Object.keys(AudioPack.words || {}).length + ' 词 / ' + Object.keys(AudioPack.sentences || {}).length + ' 句') : '未加载（浏览器版无原生播放器，安装版自动加载）'}</div>
              <div class="row" style="gap:8px;flex-wrap:wrap">
                <button class="btn btn-xs btn-gh" id="testPackWord">播放单词小样（女声）</button>
                <button class="btn btn-xs btn-gh" id="testPackSentence">播放句子小样（男声）</button>
              </div>
            </div>
            <div class="fld"><label class="lab">🔊 在线发音兜底（系统无音色时）</label>
              <label class="hint" style="display:flex;gap:8px;align-items:flex-start;cursor:pointer">
                <input type="checkbox" id="onlineTtsChk"${Speech.online && Speech.online.enabled() ? ' checked' : ''} style="margin-top:3px">
                <span>没有可用系统音色时，用在线词典音频朗读单词/听力句子（有道 dictvoice）<br>
                  <span style="color:var(--tx3)">需要联网；会把待朗读文本发给第三方。
                  系统音色可用时不会走这里。离线时此功能不可用。</span></span>
              </label>
              <div class="row" style="gap:8px;align-items:center;margin-top:6px">
                <button class="btn btn-xs btn-gh" id="testOnlineTts">测试在线发音</button>
                <span class="hint" id="onlineTtsStatus" style="margin:0">在线发音：${Speech.online.state === 'unavailable' ? ('失败：' + esc(Speech.online.error || '未知')) : '待尝试'}</span>
              </div></div>
              </div>
            </details>
            <div class="fld"><label class="lab">手写笔颜色</label>
              <input type="color" id="inkC" value="${esc(s.handwritingInk)}" style="width:50px;height:32px;border:1px solid var(--line2);border-radius:8px;background:none"></div>
          </div>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-h">词库</div>
          <div class="card-b">
            <div class="hint" style="margin-bottom:12px">以下词库已内置在本机，离线可用。点击可切换当前学习词书。</div>
            ${BOOKS.map(b => `
              <div class="nb-item" data-bk="${b.id}" style="cursor:pointer">
                <span class="w" style="min-width:auto;flex:none;width:34px;height:34px;border-radius:10px;background:${b.color}1a;color:${b.color};
                  display:flex;align-items:center;justify-content:center;font-size:11px;font-family:inherit">Aa</span>
                <span class="cn"><b>${b.name}</b><br><span style="color:var(--tx3);font-size:12px">${b.sub} · ${(b.size || '')}</span></span>
                <span class="sp"></span>
                ${Store.d.activeBook === b.id ? '<span class="tag tag-ok">当前</span>' : '<span class="tag">切换</span>'}
              </div>`).join('')}
          </div>
        </div>

        <div class="card" style="margin-top:14px">
          <div class="card-h">启动弹窗</div>
          <div class="card-b">
            <div class="row" style="gap:11px">
              <span style="flex:1">
                <b style="font-size:13.5px">打开应用时显示欢迎弹窗</b>
                <div class="hint">关闭后弹窗只在手动点击时出现</div>
              </span>
              <span class="switch ${Welcome.isSkipped() ? '' : 'on'}" id="swWelcome"></span>
            </div>
            <button class="btn btn-gh btn-blk" id="btnShowWelcome" style="margin-top:12px">
              立即预览欢迎弹窗</button>
          </div>
        </div>

        <div class="card" style="margin-top:14px">
          <div class="card-h">关于</div>
          <div class="card-b" style="text-align:center;padding:20px">
            <img src="assets/logo-lg.png" alt="" style="width:64px;height:64px;margin-bottom:10px">
            <div style="font-size:16px;font-weight:750">Keep Learning</div>
            <div style="font-size:12px;color:var(--tx3);margin-top:2px">本地英语学习工作台</div>
            <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">
              <div style="font-size:12.5px;font-weight:650;color:var(--tx2)">Keep Learning 开源项目</div>
              <div style="font-size:11px;color:var(--tx3);margin-top:3px">与 AI 协作完成</div>
            </div>
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
              <div style="font-size:12.5px;font-weight:650;color:var(--tx2)">反馈与建议</div>
              <div style="margin-top:6px;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap">
                <a id="fbMail" href="https://github.com/zzy1start/keep-learning/issues/new?template=bug_report.yml"
                  target="_blank" rel="noopener"
                  style="font-size:13px;color:var(--pri);text-decoration:none;word-break:break-all">GitHub Issues</a>
                <button class="btn btn-xs btn-gh" id="btnCopyMail" title="复制 Issues 链接">复制链接</button>
              </div>
              <div class="hint" style="margin-top:5px">遇到问题或想要新功能，请到 GitHub Issues 提交；附上截图或复现步骤更好。请勿粘贴 API Key 或个人隐私。</div>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:14px">
          <div class="card-h">数据管理</div>
          <div class="card-b">
            <div class="hint" style="margin-bottom:12px">当前本地数据约 <b>${sizeMB.toFixed(2)} MB</b>。清除浏览器数据会丢失全部学习记录，请定期备份。</div>
            <div class="grid g2" style="gap:8px">
              <button class="btn btn-gh" data-act="backup">导出备份</button>
              <button class="btn btn-gh" data-act="restore">导入备份</button>
              <button class="btn btn-gh" data-act="report">学习报告 PDF</button>
            </div>
            <button class="btn btn-gh btn-blk" data-act="exportProgress" style="margin-top:8px">导出学习进度（不含 AI Key，用于平板↔电脑）</button>
            <button class="btn btn-gh btn-blk" data-act="restoreProgress" style="margin-top:8px">仅导入学习进度（保留本机设置 / AI Key）</button>
            <button class="btn btn-warn btn-blk" data-act="clearImported" style="margin-top:8px">删除所有导入的真题（PDF/文档）</button>
            <button class="btn btn-dan btn-blk" data-act="reset" style="margin-top:8px">清空全部学习数据</button>
          </div>
        </div>

        <div class="card" style="margin-top:14px">
          <div class="card-h">使用说明</div>
          <div class="card-b" style="font-size:13px;line-height:1.9;color:var(--tx2)">
            <b>听力</b>：用浏览器内置语音合成，离线可发音。「改」模式可看原文、点击任意句子复现；「写」模式隐藏原文做听写。<br>
            <b>阅读</b>：做题模式计时且禁止查词；修改模式可划线、点击查词、长难句分析，选中整句自动切换到长难句分析。<br>
            <b>写作</b>：支持键盘/手机/电子笔（canvas 手写，需 AI 视觉模型识别）。<br>
            <b>生词本 PDF</b>：含日期时间、来源标签与来源分析，可打印为 PDF 保存。<br>
            <b>单词</b>：先用词汇量测试分层，之后按遗忘曲线（SM-2）自动排复习。
          </div>
        </div>
      </div>
    </div>`;

    this._bind(root);
  },

  _bind(root) {
    const s = Store.d.settings, c = s.ai;
    /* 反馈入口：GitHub Issues 链接；APK WebView 里外链可能被拦，
     * 所以再给一个「复制」按钮（clipboard 不可用时退回 textarea + execCommand）。*/
    const btnCopyMail = $('#btnCopyMail');
    if (btnCopyMail) btnCopyMail.onclick = async () => {
      const mail = 'https://github.com/zzy1start/keep-learning/issues/new/choose';
      const okMsg = () => App.toast('Issues 链接已复制：' + mail, 'ok');
      try {
        await navigator.clipboard.writeText(mail);
        okMsg();
      } catch (e) {
        try {
          const ta = document.createElement('textarea');
          ta.value = mail; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          document.execCommand('copy');
          ta.remove();
          okMsg();
        } catch (e2) { App.toast('反馈邮箱：' + mail, ''); }
      }
    };
    const sw = $('#swAI');
    if (sw) sw.onclick = () => { sw.classList.toggle('on'); };

    // 显示 / 隐藏 API Key：让用户能确认「配置还在」，不必重复填写
    const eye = $('#aiKeyEye');
    if (eye) eye.onclick = () => {
      const inp = $('#aiKey');
      if (!inp) return;
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      eye.textContent = show ? '🙈' : '👁';
      eye.title = show ? '隐藏 Key' : '显示 Key';
    };

    $('#aiSave').onclick = () => {
      c.baseUrl = $('#aiUrl').value.trim();
      const k = $('#aiKey').value.trim();
      if (k) c.key = k;               // 留空则保留原 Key
      c.model = $('#aiModel').value.trim();
      if (!c.model) { App.toast('请填写模型名称', ''); return; }

      /* 关键修复：以前只认「开关是否打开」，用户填完 Key/URL/模型忘了开开关
       * 就一直显示"未启用 AI"，而界面上没有任何提示为什么。
       * 现在：三项齐全就自动启用；缺项则明确告诉用户缺哪个。
       */
      const missing = [];
      if (!c.baseUrl) missing.push('Base URL');
      if (!c.key) missing.push('API Key');
      if (!c.model) missing.push('模型名称');
      if (missing.length) {
        App.toast('还差：' + missing.join('、'), 'err');
        return;
      }
      c.enabled = true;
      // 换接口/换模型/换 Key 后重置「余额不足」标记，让提醒能再次触发
      AI._noBalanceNotified = false;
      Store.flush();
      this.render($('#view'));
      App.toast('AI 配置已保存，下次打开无需重新配置', 'ok');
    };

    // 顶部状态灯：一眼看出为什么没启用
    const st = $('#aiState');
    if (st) {
      const miss = [];
      if (!c.baseUrl) miss.push('Base URL');
      if (!c.key) miss.push('Key');
      if (!c.model) miss.push('模型');
      st.innerHTML = AI.ready
        ? '<span style="color:var(--ok)">● 已启用</span>　可用模块：查词深度解析 · 长难句分析 · 写作评分'
        : `<span style="color:var(--err)">● 未启用</span>　缺少：${miss.join('、')}`;
    }

    // ---- 拉取可用模型列表 ----
    $('#aiFetch').onclick = async () => {
      const b = $('#aiFetch'), h = $('#modelHint'), m = $('#aiMsg');
      h.innerHTML = ''; m.innerHTML = '';
      const base = $('#aiUrl').value.trim().replace(/\/+$/, '');
      const key = $('#aiKey').value.trim();
      if (!base) { App.toast('请先填写 Base URL', ''); return; }
      b.innerHTML = '<span class="spin"></span> 获取中';
      try {
        const r = await fetch(base + '/models', {
          headers: key ? { 'Authorization': 'Bearer ' + key } : {},
        });
        const txt = await r.text();
        if (!r.ok) {
          // 把接口返回的原始报错翻译成可操作提示
          let msg = txt.slice(0, 300);
          const m400 = txt.match(/"message"\s*:\s*"([^"]+)"/);
          if (m400) msg = m400[1];
          else if (/authentication|unauthor|invalid\s*api\s*key/i.test(msg)) msg = 'Authentication Fails（API Key 无效）';
          if (/401|unauthor|invalid.*key|api key|authentication/i.test(msg)) {
            throw new Error('API Key 无效或未填写（HTTP ' + r.status + '）。请检查 Key 是否正确、是否已激活。');
          }
          if (/model/i.test(msg) && /not.*support|supported.*names/i.test(msg)) {
            throw new Error('接口拒绝了模型名：' + msg);
          }
          if (r.status === 404) {
            throw new Error('该接口没有实现 /models 列表（HTTP 404）。请手动填写模型名，或参考该服务商文档。');
          }
          throw new Error('HTTP ' + r.status + '：' + msg);
        }
        let list = [];
        try {
          const j = JSON.parse(txt);
          list = (j.data || j.models || []).map(x => x.id || x.name || x.model).filter(Boolean);
        } catch (e) { throw new Error('返回格式无法解析：' + txt.slice(0, 120)); }
        if (!list.length) throw new Error('接口返回了空的模型列表');
        list.sort();
        // 填入 datalist 供下拉选择
        const dl = $('#aiModelList');
        dl.innerHTML = list.map(x => `<option value="${esc(x)}">`).join('');
        const inp = $('#aiModel');
        if (!list.includes(inp.value)) inp.value = list.includes('deepseek-flash') ? 'deepseek-flash' : list[0];
        h.innerHTML = `<b style="color:var(--ok)">✓ 获取到 ${list.length} 个可用模型</b>：${list.map(esc).join('、')}
          <br>已填入 <b>${esc(inp.value)}</b>，点「保存配置」生效。若输入框右上角有下拉箭头，也可直接展开选择。`;
        App.toast(`获取到 ${list.length} 个模型`, 'ok');
      } catch (e) {
        h.innerHTML = `<span style="color:var(--err)">✗ ${esc(e.message)}</span>`;
        App.toast('获取失败，详见下方提示', 'err');
      }
      b.textContent = '获取可用模型';
    };

    $('#aiTest').onclick = async () => {
      const b = $('#aiTest'), m = $('#aiMsg');
      b.innerHTML = '<span class="spin"></span> 测试中';
      m.innerHTML = '';
      const base = $('#aiUrl').value.trim();
      const key = $('#aiKey').value.trim();
      const model = $('#aiModel').value.trim();
      if (!base || !model) { b.textContent = '测试连接'; App.toast('请先填写 Base URL 与模型名称', ''); return; }
      try {
        const r = await fetch(base.replace(/\/+$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'reply OK' }], max_tokens: 8 }),
        });
        const txt = await r.text();
        if (!r.ok) {
          let msg = txt.slice(0, 300);
          const mm = txt.match(/"message"\s*:\s*"([^"]+)"/);
          if (mm) msg = mm[1];
          // 401/429 必须按状态码判断：某些接口的报错文本里并不含状态码数字
          if (/supported API model names/i.test(msg)) {
            tip = `<b>模型名不被支持</b>：${esc(msg)}<br>
              → 点「获取可用模型」按钮自动选择正确名称。`;
          } else if (r.status === 401 || /unauthor|invalid.*key|api key|authentication/i.test(msg)) {
            tip = '<b>API Key 无效</b> → 检查 Key 是否正确、是否已激活、余额是否充足。';
          } else if (r.status === 429 || /insufficient|quota|balance|rate.?limit/i.test(msg)) {
            tip = '<b>额度不足或限流</b> → 充值后重试，或降低调用频率。';
          } else if (r.status === 404) {
            tip = '<b>接口地址不正确</b> → 检查 Base URL，通常以 /v1 结尾。';
          } else {
            tip = esc(msg);
          }
          m.innerHTML = `<div class="tipbox" style="border-left-color:var(--err);background:var(--err-l)">${tip}</div>`;
          App.toast('测试失败', 'err');
          b.textContent = '测试连接';
          return;
        }
        m.innerHTML = '<div class="tipbox" style="border-left-color:var(--ok);background:var(--ok-l)"><b>✓ 连接成功</b>　模型 <b>' + esc(model) + '</b> 可用。点「保存配置」后所有 AI 功能生效。</div>';
        App.toast('连接成功，AI 可用', 'ok');
      } catch (e) {
        m.innerHTML = `<div class="tipbox" style="border-left-color:var(--err);background:var(--err-l)"><b>网络错误</b>：${esc(e.message)}<br>若接口地址正确，请检查网络/代理，或确认该服务是否支持浏览器直连（CORS）。</div>`;
        App.toast('网络错误', 'err');
      }
      b.textContent = '测试连接';
    };

    on(root, 'click', '[data-theme]', (e, t) => {
      s.theme = t.dataset.theme; Store.flush(); App.applyTheme(s.theme); this.render($('#view'));
    });
    const rr = $('#rateR');
    rr.oninput = () => { $('#rateV').textContent = rr.value; };
    rr.onchange = () => { s.speechRate = +rr.value; Store.flush(); };
    $('#testSay').onclick = async () => {
      const el = $('#testWordHint');
      if (el) el.textContent = '正在朗读测试句 …';
      await Speech.speak('This is a test of the speech engine. 朗读测试。', { rate: +rr.value });
      const total = Speech.lastMs || 0, start = Speech.lastStartMs || 0, speak = Speech.lastSpeakMs || 0;
      if (el) {
        el.innerHTML = Speech.lastWhy === 'no-start'
          ? '系统语音引擎未启动（已自动重试一次）。请刷新页面后再试；若仍无声，检查浏览器语音设置。'
          : '句子：合计 <b>' + total + ' ms</b> ＝ 起音 ' + start + ' ms ＋ 朗读 ' + speak + ' ms。';
      }
    };
    /* 单词发音自测：挑一个长词（最容易暴露"吞掉首音节"），并报出实测毫秒数。
     * 我给不出"我听过了"的结论，所以把可测量的证据交给使用者。 */
    $('#testWord').onclick = async () => {
      const word = 'interdisciplinary';
      const el = $('#testWordHint');
      if (el) el.textContent = '正在朗读 ' + word + ' …';
      await Speech.speakWord(word);
      const total = Speech.lastMs || 0, start = Speech.lastStartMs || 0, speak = Speech.lastSpeakMs || 0;
      if (el) {
        el.innerHTML = Speech.lastWhy === 'no-start'
          ? '「' + word + '」未能开口（已自动重试一次）。请刷新页面后再试；若仍无声，检查浏览器语音设置。'
          : '「' + word + '」合计 <b>' + total + ' ms</b> ＝ 起音 ' + start + ' ms ＋ 朗读 ' + speak + ' ms。'
          + (start > 700 ? '<br>起音占大头：这是系统语音引擎的启动延迟，换音色（点「对比音色延迟」）或换引擎才明显改善。' : '')
          + (speak > 900 ? '<br>朗读占大头：时长本身偏长，可考虑提高语速。' : '')
          + (start < 300 && speak < 900 ? '<br>两段都不大，若听感仍慢，多半是系统音色本身起音慢。' : '');
      }
    };
    /* 音色延迟对比：把已装音色逐个测一遍"起音延迟"，让使用者挑一个既清楚又跟手的。
     * 不起 stop()：队列本身串行，停一下反而会多等防吞音的 200ms，测出来不准。 */
    $('#testVoices').onclick = async () => {
      const el = $('#testWordHint');
      const list = Speech.list().slice(0, 6);
      if (!list.length) { if (el) el.textContent = '未检测到可用英语音色'; return; }
      const rows = [];
      for (const v of list) {
        if (el) el.textContent = '正在测试 ' + v.name + ' …';
        await Speech.speakWord('interdisciplinary', { voice: v.name });
        rows.push({ name: v.name, start: Speech.lastStartMs || 0, total: Speech.lastMs || 0, why: Speech.lastWhy });
      }
      rows.sort((a, b) => a.start - b.start);
      if (el) {
        el.innerHTML = '各音色起音延迟（越小越跟手；音色是否好听请自行判断）：<br>'
          + rows.map(r => '· ' + esc(r.name) + '：' + (r.why === 'no-start'
            ? '未启动（已重试）' : '起音 ' + r.start + ' ms，合计 ' + r.total + ' ms')).join('<br>')
          + '<br>把上面「发音音色」设成你满意的那一个即可。';
      }
    };
    $('#voiceSel').onchange = e => { s.speechVoice = e.target.value; Store.flush(); };
    /* 听力男女说话人各自的音色（"男女对读"的开关） */
    const vsF = $('#voiceSelF');
    if (vsF) vsF.onchange = e => { s.speechVoiceFemale = e.target.value; Store.flush(); };
    const vsM = $('#voiceSelM');
    if (vsM) vsM.onchange = e => { s.speechVoiceMale = e.target.value; Store.flush(); };
    $('#leadInSel').onchange = e => {
      s.listenLeadIn = +e.target.value;
      Store.flush();
      App.toast('听力起始缓冲：' + s.listenLeadIn + ' 秒', 'ok');
    };
    const wr = $('#wRateR');
    wr.oninput = () => { $('#wRateV').textContent = wr.value; };
    wr.onchange = () => { s.wordRate = +wr.value; Store.flush(); };
    $('#wVoiceSel').onchange = e => { s.wordVoice = e.target.value; Store.flush(); };

    /* 发音环境诊断：把「浏览器 / 全部英语音色 / 自动选哪个」列出来。
     * 【为什么需要】"听力还是机器声"最常见的原因就是本机根本没有神经音色可用，
     * 而这一点只看设置页的"可用音色 N 个"是看不出来的（云端音色默认被排除、不计数）。*/
    const voiceDiagBtn = $('#voiceDiag');
    if (voiceDiagBtn) voiceDiagBtn.onclick = () => {
      const box = $('#voiceDiagBox');
      if (!box) return;
      if (box.textContent) { box.textContent = ''; return; }   // 再点一次收起
      box.textContent = Speech.voiceReport ? Speech.voiceReport() : '（当前版本不支持诊断）';
    };

    /* 「音色改回自动」：把被显式钉住的本地音色清掉。
     * 早期调音色很容易在某个下拉里留下 Microsoft Hazel/Zira 这类旧式音色，
     * 而听力里"带说话人标注的行用女声/男声、没有说话人标注的行才用统一音色"——
     * 只钉住其中一项，现象就是**有时**是人机声，光看下拉框看不出因果。*/
    const autoVoicesBtn = $('#autoVoices');
    if (autoVoicesBtn) autoVoicesBtn.onclick = () => {
      const cleared = Speech.resetVoicePicks(true);
      if (!cleared.length) { App.toast('听力与背单语音色本来就是「自动」', ''); return; }
      App.toast('已改回自动（' + cleared.join('、') + '）：听力将优先使用云端神经音色', 'ok');
      this.render($('#view'));
    };

    /* 「重新启用云端音色」：自愈（连续 2 次没正常发声）会把云端音色暂时关掉，
     * 之前**没有任何界面能把它打开**——只能刷新页面。现在一键恢复并重绘诊断。*/
    const cloudRetryBtn = $('#cloudRetry');
    if (cloudRetryBtn) cloudRetryBtn.onclick = () => {
      const was = Speech.resetCloud(false);
      if (!was) App.toast('云端音色本来就没被关闭，当前状态：' + (Speech.cloudOff ? '冷却中' : '使用中'), '');
      Speech.init();
      const box = $('#voiceDiagBox');
      if (box) box.textContent = Speech.voiceReport ? Speech.voiceReport() : '';
    };

    /* 云端音色开关：非 Edge 时手动放行。改完要重新过滤音色列表并重绘本页，
     * 否则音色下拉里不会出现新放行的音色（Speech.init 只在启动时跑一次）。*/
    const onlineChk = $('#onlineVoiceChk');
    if (onlineChk) onlineChk.onchange = () => {
      s.allowOnlineVoices = onlineChk.checked;
      Store.flush();
      Speech.init();
      if (s.allowOnlineVoices && !Speech.list().length) {
        App.toast('仍未发现可用英语音色：当前浏览器可能不支持这些云端音色', 'err');
      }
      App.toast(s.allowOnlineVoices ? '已允许云端音色（共 ' + Speech.list().length + ' 个英语音色）' : '已只保留本地音色', 'ok');
      ViewSettings.render();
    };

    /* 真人词典发音开关（③）：默认关；打开后每个单词都会向第三方发起查询 */
    const dictChk = $('#dictAudioChk');
    if (dictChk) dictChk.onchange = () => {
      s.dictAudio = dictChk.checked;
      Store.flush();
      Speech.dict.reset();
      const st = $('#dictAudioStatus');
      if (st) st.textContent = Speech.dict.statusText ? Speech.dict.statusText() : '';
      App.toast(s.dictAudio ? '真人词典发音已开启（800ms 内无响应则自动回落）' : '真人词典发音已关闭', 'ok');
    };
    /* 离线语音库（Piper）：男女音色选择 / 优先开关 / 试听 */
    const lvF = $('#localVoiceFemale');
    if (lvF) lvF.onchange = () => {
      s.localVoiceFemale = lvF.value; Store.flush();
      App.toast('离线语音库女声：' + lvF.value, 'ok');
    };
    const lvM = $('#localVoiceMale');
    if (lvM) lvM.onchange = () => {
      s.localVoiceMale = lvM.value; Store.flush();
      App.toast('离线语音库男声：' + lvM.value, 'ok');
    };
    const swLP = $('#swLocalPref');
    if (swLP) swLP.onclick = () => {
      swLP.classList.toggle('on');
      s.localTtsPreferred = swLP.classList.contains('on');
      Store.flush();
      App.toast(s.localTtsPreferred ? '已设为优先使用离线语音库' : '已恢复：有系统音色时优先系统/云端', 'ok');
    };
    const testLocal = gender => async () => {
      const st = $('#localTtsState');
      if (st) st.textContent = '合成中（首次较慢，约 1-2 秒）…';
      Speech.stop();
      const sample = gender === 'male'
        ? 'Good morning, everyone. Today we will discuss the importance of time management.'
        : 'Please make sure your answer sheet is handed in before the bell rings.';
      await Speech.speak(sample, { local: true, gender });
      const now = Speech.local;
      if (st) st.textContent = now && now.ready ? '可用（4 个音色）' : '不可用：' + ((now && now.initError) || '未初始化');
    };
    const tlF = $('#testLocalFemale');
    if (tlF) tlF.onclick = testLocal('female');
    const tlM = $('#testLocalMale');
    if (tlM) tlM.onclick = testLocal('male');
    const testPackWord = $('#testPackWord');
    if (testPackWord) testPackWord.onclick = () => {
      Speech.stop();
      Speech.speak('abandonment', { word: true, gender: 'female', rate: 0.9 });
      App.toast('播放离线单词小样：abandonment（女声）', '');
    };
    const testPackSentence = $('#testPackSentence');
    if (testPackSentence) testPackSentence.onclick = () => {
      Speech.stop();
      const e = (typeof AudioPack !== 'undefined' && AudioPack.entries)
        ? Object.values(AudioPack.entries).find(x => x && /audio\/sentences\//.test(x.female || ''))
        : null;
      if (!e) { App.toast('音频包未加载', 'err'); return; }
      Speech.speak(e.text, { gender: 'male', rate: 0.95 });
      App.toast('播放离线句子小样（男声）', '');
    };
    const testOnline = $('#testOnlineTts');
    if (testOnline) testOnline.onclick = async () => {
      Speech.stop();
      const st = $('#onlineTtsStatus');
      if (st) st.textContent = '在线发音：正在请求…';
      try {
        const r = await Speech.online.say('hello', {
          onstart: () => { if (st) st.textContent = '在线发音：已开始播放'; },
          onerror: e => { if (st) st.textContent = '在线发音：失败 ' + ((e && (e.error || e.message)) || ''); },
        });
        if (r === null) App.toast('在线发音没有声音：' + (Speech.online.error || '音频加载失败'), 'err');
        else if (st) st.textContent = '在线发音：播放结束';
      } catch (e) {
        if (st) st.textContent = '在线发音：失败 ' + e.message;
        App.toast('在线发音失败：' + e.message, 'err');
      }
    };
    const onlineTtsChk = $('#onlineTtsChk');
    if (onlineTtsChk) onlineTtsChk.onchange = () => {
      s.onlineTts = !!onlineTtsChk.checked;
      Store.flush();
      App.toast(s.onlineTts ? '在线发音兜底已开启' : '在线发音兜底已关闭', 'ok');
    };
    const dictAccentSel = $('#dictAccentSel');
    if (dictAccentSel) dictAccentSel.onchange = e => {
      s.dictAccent = e.target.value === '1' ? '1' : '2';
      Store.flush();
      Speech.dict.reset();
      App.toast('词典发音口音：' + (s.dictAccent === '1' ? '英音' : '美音'), 'ok');
    };

    /* 发音延迟诊断：最近 12 次的「排队等待 / 起音 / 朗读」拆解。
     * 越读越慢通常是"排队等待"一列在涨（队列积压），而不是引擎变慢。 */
    const diagBtn = $('#diagRefresh');
    if (diagBtn) diagBtn.onclick = () => {
      const box = $('#diagBox');
      if (!box) return;
      const rows = (Speech.diag || []);
      if (!rows.length) { box.style.display = ''; box.textContent = '还没有朗读记录：先点「试听单词并计时」或去背几个词。'; return; }
      box.style.display = '';
      box.innerHTML = '<b>最近 ' + rows.length + ' 次朗读（毫秒）</b>'
        + '<table style="width:100%;margin-top:6px;font-size:12px;border-collapse:collapse">'
        + '<tr><th style="text-align:left">词</th><th>字数</th><th>排队等待</th><th>起音</th><th>朗读</th><th>速度</th><th>合计</th><th>结束原因</th></tr>'
        + rows.map(r => {
          /* 「朗读」单独看没有意义：4 秒可能是句子长，也可能是读得慢。
           * 补上字数与"字/秒"，才能一眼判断是不是引擎太慢（正常英文朗读约 13–16 字/秒，
           * 含标点停顿的对话材料约 8–12 字/秒；低于 6 就明显偏慢）。*/
          const len = r.len != null ? r.len : String(r.text || '').length;
          const cps = r.speechMs > 0 ? (len / (r.speechMs / 1000)) : 0;
          const cpsTxt = cps ? cps.toFixed(1) : '-';
          const slow = cps && cps < 6 ? ' style="color:var(--err)"' : '';
          return '<tr>'
            + '<td>' + esc(r.text) + '</td>'
            + '<td style="text-align:center">' + len + '</td>'
            + '<td style="text-align:center">' + r.waitMs + '</td>'
            + '<td style="text-align:center">' + r.startMs + '</td>'
            + '<td style="text-align:center">' + r.speechMs + '</td>'
            + '<td style="text-align:center"' + (slow || '') + '>' + cpsTxt + '</td>'
            + '<td style="text-align:center"><b>' + r.totalMs + '</b></td>'
            + '<td style="text-align:center">' + esc(r.why) + '</td></tr>';
        }).join('')
        + '</table>'
        + '<div class="hint">「词」列只显示前 20 字，字数以「字数」列为准。'
        + '「排队等待」持续变大 = 队列积压（点「试听单词并计时」连点几次即可复现）；'
        + '「起音」变大 = 语音引擎启动慢；「速度」低于 6 字/秒（标红）= 读得明显偏慢；'
        + '「no-end / no-start」= 引擎回调丢失（已由看门狗兜底）。</div>';
    };
    $('#inkC').onchange = e => { s.handwritingInk = e.target.value; Store.flush(); };

    on(root, 'click', '[data-bk]', (e, t) => {
      Store.d.activeBook = t.dataset.bk; Store.flush();
      App.toast('已切换词书，正在加载...', 'ok');
      App.go('vocab');
    });
    const rb = $('#reloadBooks');
    if (rb) rb.onclick = async () => {
      const b = $('#reloadBooks');
      b.innerHTML = '<span class="spin"></span> 统计中';
      for (const bk of BOOKS) {
        const d = await Dict.load(bk.id);
        bk.size = d.total + ' 词';
      }
      Store.flush(); this.render($('#view'));
      b.textContent = '重新统计词库规模';
      App.toast('已更新', 'ok');
    };

    // 启动弹窗开关
    const swW = $('#swWelcome', root);
    if (swW) swW.onclick = () => {
      const skip = swW.classList.contains('on');
      Welcome.skip(skip);
      App.toast(skip ? '已关闭启动弹窗' : '已恢复启动弹窗', 'ok');
      this.render($('#view'));
    };
    const btnW = $('#btnShowWelcome', root);
    if (btnW) btnW.onclick = () => { if (App.showWelcome) App.showWelcome(); };

    on(root, 'click', '[data-act]', (e, t) => {
      const a = t.dataset.act;
      if (a === 'backup') {
        App.download(new Blob([Store.backup()], { type: 'application/json' }),
          `keeplrn_backup_${App.fmtDate()}.json`);
        App.toast('已导出', 'ok');
      } else if (a === 'restore') {
        const inp = el('input', { type: 'file', accept: '.json' });
        inp.onchange = () => {
          const f = inp.files[0]; if (!f) return;
          const rd = new FileReader();
          rd.onload = () => {
            try {
              const j = JSON.parse(rd.result);
              if (!j.settings) throw new Error('格式不正确');
              Store.d = Object.assign(Store.def(), j);
              Store.d.settings = Object.assign(Store.def().settings, j.settings);
              Store.flush();
              try { if (typeof Dict !== 'undefined' && Dict.mergeImportedContent) Dict.mergeImportedContent(); } catch (e) {}
              App.applyTheme(Store.d.settings.theme);
              this.render($('#view'));
              App.toast('导入成功', 'ok');
            } catch (err) { App.toast('导入失败：' + err.message, 'err'); }
          };
          rd.readAsText(f);
        };
        inp.click();
      } else if (a === 'exportProgress') {
        App.download(new Blob([Store.progressBackup()], { type: 'application/json' }),
          `keeplrn_progress_${App.fmtDate()}.json`);
        App.toast('已导出学习进度（不含 AI Key）', 'ok');
      } else if (a === 'restoreProgress') {
        const inp = el('input', { type: 'file', accept: '.json' });
        inp.onchange = () => {
          const f = inp.files[0]; if (!f) return;
          const rd = new FileReader();
          rd.onload = () => {
            try {
              const j = JSON.parse(rd.result);
              const n = Store.importProgress(j);
              try { if (typeof Dict !== 'undefined' && Dict.mergeImportedContent) Dict.mergeImportedContent(); } catch (e) {}
              this.render($('#view'));
              App.toast(n ? '已导入学习进度（本机设置未变）' : '备份里没有可导入的进度', n ? 'ok' : '');
            } catch (err) { App.toast('导入失败：' + err.message, 'err'); }
          };
          rd.readAsText(f);
        };
        inp.click();
      } else if (a === 'exportNb') {
        if (!Store.d.notebook.length) { App.toast('生词本为空', ''); return; }
        PDF.openNotebookExport(Store.d.notebook, { bookName: '全部词书' });
      } else if (a === 'report') {
        /* 【为什么不再"跳到统计页再点它的按钮"】旧实现是
         *   App.go('stats'); setTimeout(() => $('[data-act="report"]').click(), 300);
         * 这条接力链任何一环断掉都是**静默无反应**：统计页若渲染失败，页面上根本没有那个按钮
         *（而且旧的错误提示写在被替换掉的游离节点里，用户只看到空白）。
         * 现在两个入口都走 ViewStats.exportReport()，导出的是同一份数据，失败会 Toast。*/
        ViewStats.exportReport();
      } else if (a === 'clearImported') {
        App.modal('删除导入的真题', '<p style="line-height:1.8">将删除所有通过 PDF/Word/文本导入的听力、阅读、写作题目；<b>单词进度、生词本、统计、设置不会删除</b>。<br><br>删除后需要重新导入试卷。确定继续吗？</p>'
          + '<div class="row" style="margin-top:18px;gap:8px;justify-content:flex-end"><button class="btn btn-gh" id="ciNo">取消</button><button class="btn btn-dan" id="ciYes">确认删除</button></div>', b => {
          $('#ciNo', b).onclick = App.closeModal;
          $('#ciYes', b).onclick = () => {
            const n = Store.clearImportedContent();
            App.closeModal();
            App.toast('已删除 ' + n + ' 条导入内容，正在刷新…', 'ok');
            setTimeout(() => location.reload(), 500);
          };
        });
      } else if (a === 'reset') {
        App.modal('危险操作', `<p style="line-height:1.8">此操作将<b>清空全部学习数据</b>（单词进度、遗忘曲线、生词本、写作记录、统计），且<b>无法恢复</b>。<br><br>建议先「导出备份」。确定要继续吗？</p>
          <div class="row" style="margin-top:18px;gap:8px;justify-content:flex-end">
            <button class="btn btn-gh" id="rsNo">取消</button>
            <button class="btn btn-warn" id="rsBk">先备份再清空</button>
            <button class="btn btn-dan" id="rsYes">确认清空</button></div>`, b => {
          $('#rsNo', b).onclick = App.closeModal;
          $('#rsBk', b).onclick = () => {
            App.download(new Blob([Store.backup()], { type: 'application/json' }), `keeplrn_backup_${App.fmtDate()}.json`);
            App.closeModal(); App.toast('已导出备份，请手动清空', 'ok');
          };
          $('#rsYes', b).onclick = () => {
            localStorage.removeItem(Store.KEY);
            location.reload();
          };
        });
      }
    });
  },
};
window.ViewSettings = ViewSettings;
