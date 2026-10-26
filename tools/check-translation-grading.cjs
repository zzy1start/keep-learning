/* ============ check-translation-grading.cjs : 翻译评分端到端自检 ============
 * 用本地 HTTP 夹具（不声称真实服务商通过）验证 ai.js 的翻译评分链路：
 *  ① 未配置 AI 时退回本地 chrF 评分（有参考译文）／如实拒绝（无参考译文）
 *  ② 模型给高分但漏译 → 完整性校正压分，且四维之和严格等于新总分
 *  ③ 模型给高分但与参考译文几乎不重合 → 独立对齐校正压分并提示人工复核
 *  ④ 模型调用失败 → 退回本地评分并把失败原因挂在结果上
 *  ⑤ 未配置 AI 且只上传了照片 → 明确说明无法识别，不猜分
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');

const LIB = 'A library gives people a quiet place to read and learn every day.';
const LIB_CN = '图书馆为人们提供安静的阅读和学习场所。';
const UNRELATED_CN = '今天天气不错，猫咪安静地坐在垫子上晒太阳，心情十分愉快，四周一片平静。';
const NUMBERED = '(46) He went home. (47) She stayed at school. (48) They left early. (49) It rained all day. (50) We waited outside.';

function grade(total, max) {
  return { score: { TR: total / 4, CC: total / 4, LR: total / 4, GRA: total / 4, total, max },
    comment: '模型评语。', suggestions: { structure: [], language: [] }, polished: LIB_CN };
}

(async () => {
  /* failStatus：模拟服务商持续故障。jsonRetry 会重试 3 次，
   * 只让第一个请求失败会"重试成功拿到 {}"，走不到真正的异常分支。 */
  let replies = [], requests = [], failStatus = 0;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, body: JSON.parse(body) });
    if (failStatus) {
      res.writeHead(failStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'upstream exploded' } }));
      return;
    }
    const reply = replies.shift();
    res.writeHead(reply && reply.status ? reply.status : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply && reply.status ? { error: { message: reply.error } }
      : { choices: [{ message: { content: JSON.stringify(reply && reply.data || {}) }, finish_reason: 'stop' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  const cfg = { baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', key: 'fixture-key', model: 'fixture-model' };
  const context = vm.createContext({ window: {}, fetch, AbortController, setTimeout, clearTimeout,
    $() { return null; }, console: { warn() {} }, App: { toast() {}, modal() {} },
    Store: { d: { settings: { ai: { ...cfg } }, stats: {} } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/translate-metric.js'), 'utf8'), context);
  // vm 里每个脚本的顶层 const 进的是全局词法环境，不一定是沙箱属性；
  // 这里显式探一次，缺了就用 var 把它挂成真正的全局变量，保证 ai.js 能看到。
  if (vm.runInContext('typeof TranslateMetric', context) === 'undefined') {
    vm.runInContext('var TranslateMetric = window.TranslateMetric;', context);
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/ai.js'), 'utf8'), context);
  const ai = context.window.AI;
  const settings = context.Store.d.settings.ai;
  assert.equal(vm.runInContext('typeof TranslateMetric', context), 'object', '度量模块必须在 ai.js 之前加载');

  let failed = 0;
  async function check(name, run) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
  }
  const dimsSum = score => score.TR + score.CC + score.LR + score.GRA;
  const perMaxOk = score => ['TR', 'CC', 'LR', 'GRA'].every(k => score[k] <= score.max / 4 + 0.01);

  await check('未配置 AI：有参考译文时给出本地 chrF 评分', async () => {
    settings.key = '';
    const result = await ai.gradeTranslation({ prompt: LIB, cn: LIB_CN }, LIB_CN, [], 10);
    assert.equal(result.gradingFailed, undefined);
    assert.equal(result.degraded, true);
    assert.equal(result.reason, 'not-configured');
    assert.ok(result.score.total >= 9, '与参考译文一致的作答应得高分，实际 ' + result.score.total);
    assert.ok(result.polished === LIB_CN);
    assert.equal(requests.length, 0, '未配置时不应发起网络请求');
  });

  await check('未配置 AI：没有参考译文时如实拒绝，不猜分', async () => {
    const result = await ai.gradeTranslation({ prompt: LIB }, '图书馆为人们提供安静的阅读和学习场所。', [], 10);
    assert.equal(result.gradingFailed, true);
    assert.equal(result.score, undefined);
    assert.ok(/参考译文/.test(result.errMsg), '要说明缺参考译文：' + result.errMsg);
  });

  await check('未配置 AI 且只上传照片：说明无法识别', async () => {
    const result = await ai.gradeTranslation({ prompt: LIB, cn: LIB_CN }, '', [{ data: 'data:image/jpeg;base64,AA' }], 10);
    assert.equal(result.gradingFailed, true);
    assert.ok(/照片|识别/.test(result.errMsg), '要说明照片无法识别：' + result.errMsg);
  });

  await check('漏译：模型给 9 分也被完整性校正压到覆盖率上限', async () => {
    settings.key = 'fixture-key';
    replies = [{ data: grade(9, 10) }];
    const result = await ai.gradeTranslation({ prompt: NUMBERED }, '他回家了。', [], 10);
    assert.equal(result.score.total, 2, '覆盖率 0.2 × 满分 10 应为 2，实际 ' + result.score.total);
    assert.ok(result.comment.includes('完整性校正'), '评语要写明校正：' + result.comment);
    assert.equal(result.localChecks.capApplied, true);
    assert.equal(Math.round(dimsSum(result.score) * 10) / 10, result.score.total, '四维之和必须等于总分');
    assert.ok(perMaxOk(result.score), '每维不得超过满分四分之一');
  });

  await check('对齐校正：与参考译文几乎不重合的高分被压制并提示复核', async () => {
    replies = [{ data: grade(9, 10) }];
    const result = await ai.gradeTranslation({ prompt: LIB, cn: LIB_CN }, UNRELATED_CN, [], 10);
    assert.equal(result.localChecks.alignment.checked, true);
    assert.equal(result.localChecks.alignment.relation, 'mismatch-high-score');
    assert.ok(result.score.total <= 5, '应压到满分一半以内，实际 ' + result.score.total);
    assert.ok(result.comment.includes('独立对齐检查'), '评语要写明对齐检查：' + result.comment);
    assert.equal(Math.round(dimsSum(result.score) * 10) / 10, result.score.total, '四维之和必须等于总分');
    assert.ok(perMaxOk(result.score));
  });

  await check('译文与参考一致时不动模型分数（只附检查结论）', async () => {
    replies = [{ data: grade(8, 10) }];
    const result = await ai.gradeTranslation({ prompt: LIB, cn: LIB_CN }, LIB_CN, [], 10);
    assert.equal(result.score.total, 8, '不该无故改动模型分数');
    assert.equal(result.localChecks.capApplied, false);
    assert.ok(result.localChecks.alignment.chrf > 90, 'chrF 应接近满分，实际 ' + result.localChecks.alignment.chrf);
    assert.equal(Math.round(dimsSum(result.score) * 10) / 10, 8);
  });

  await check('模型调用失败：退回本地评分并保留失败原因', async () => {
    failStatus = 500;
    const result = await ai.gradeTranslation({ prompt: LIB, cn: LIB_CN }, LIB_CN, [], 10);
    failStatus = 0;
    assert.equal(result.degraded, true);
    assert.equal(result.reason, 'failed');
    assert.ok(result.score && result.score.total > 0, '应给出本地评分');
    assert.ok(/翻译批改未完成/.test(result.errMsg || ''), '失败原因要保留：' + result.errMsg);
  });

  await check('本地评分结果能通过分数一致性校验（四维和 = 总分、每维 ≤ max/4）', async () => {
    settings.key = '';
    const result = await ai.gradeTranslation({ prompt: LIB, cn: LIB_CN }, LIB_CN, [], 10);
    assert.ok(perMaxOk(result.score));
    assert.equal(Math.round(dimsSum(result.score) * 10) / 10, result.score.total);
  });


  await check('中文原卷自动按汉译英评分，不再误判为英译汉', async () => {
    settings.key = 'fixture-key';
    const cnSource = '在中国传统文化中，亲朋好友之间互赠礼物是人际交往的一种重要礼也(etiquette)。';
    replies = [{ data: { ...grade(8, 10), polished: 'In traditional Chinese culture, exchanging gifts is an important courtesy.' } }];
    const result = await ai.gradeTranslation({ prompt: cnSource, expectScore: 10 },
      'In Chinese culture, gifts express feelings and keep relationships close.', [], 10);
    assert.equal(result.gradingFailed, undefined, '不该评不出来：' + (result.errMsg || ''));
    assert.equal(result.translationDirection, 'cn2en', '中文原卷应判为汉译英');
    const system = requests[requests.length - 1].body.messages[0].content;
    assert.ok(/汉译英/.test(system), '提示词应按汉译英给评分标准');
    assert.equal(result.score.total, 8, '分数应正常返回');
  });

  await check('参考译文语言与方向不符时保留分数并说明纠正', async () => {
    const cnSource = '在中国传统文化中，亲朋好友之间互赠礼物是人际交往的一种重要礼也(etiquette)。';
    replies = [{ data: { ...grade(8, 10), polished: '这是中文参考译文，与汉译英方向不符。' } }];
    const result = await ai.gradeTranslation({ prompt: cnSource, expectScore: 10 },
      'In Chinese culture, gifts express feelings.', [], 10);
    assert.equal(result.gradingFailed, undefined, '不该整题不给分：' + (result.errMsg || ''));
    assert.equal(result.score.total, 8, '分数必须保留');
    assert.ok(result.referenceIssue, '应挂上参考译文警告');
    assert.equal(result.directionCorrection.from, 'cn2en', '纠正来源应是自动判定的汉译英');
    assert.equal(result.directionCorrection.to, 'en2cn');
    assert.equal(result.translationDirection, 'en2cn', '方向按参考译文语种纠正');
  });
  await check('原文取值与界面一致：translationText 优先于 prompt（0 分根因）', async () => {
    const dirs = 'Part IV Translation (30 minutes)\nDirections: For this part, you are allowed 30 minutes to translate a passage from Chinese into English.';
    const passage = '在中国传统文化中，亲朋好友之间互赠礼物是人际交往的一种重要礼也(etiquette)。';
    replies = [{ data: { ...grade(12, 15), polished: 'In traditional Chinese culture, exchanging gifts is an important courtesy.' } }];
    const result = await ai.gradeTranslation({ prompt: dirs, translationText: passage, expectScore: 15 },
      'In Chinese culture, gifts express feelings.', [], 15);
    const sent = JSON.stringify(requests[requests.length - 1].body.messages[1].content);
    assert.ok(sent.includes('在中国传统文化中'), '发给模型的必须是原文正文');
    assert.ok(!/Part IV Translation/.test(sent), '不能把考试说明当原文：' + sent.slice(0, 100));
    assert.equal(result.gradingFailed, undefined, '不该评不出来：' + (result.errMsg || ''));
    assert.equal(result.score.total, 12);
  });
  server.close();
  if (failed) process.exitCode = 1; else console.log('全部 11 项端到端检查通过');
})().catch(error => { console.error(error); process.exitCode = 1; });