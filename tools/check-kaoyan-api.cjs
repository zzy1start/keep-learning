// Local HTTP fixtures verify the API workflow; they do not claim a live provider passed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');

const original = 'A library gives people a quiet place to read and learn.';
const prompt = 'Directions: Translate the following text into Chinese. (15 points)\n' + original;
const source = { heading: '考研英语二', text: 'Section III Translation\n' + prompt + '\nSection IV Writing' };
const recognition = { examType: 'kaoyan', writingType: 'translation', examPaper: 'english-2',
  complete: true, evidence: ['Translate the following text into Chinese.'], issues: [] };
const grade = { score: { TR: 3.5, CC: 3.5, LR: 3.5, GRA: 3.5, total: 14, max: 15 },
  comment: '译文准确且通顺。', suggestions: {}, polished: '图书馆为人们提供安静的阅读和学习场所。' };

(async () => {
  let replies = [], requests = [], count = 0;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, authorization: req.headers.authorization, body: JSON.parse(body) });
    const reply = replies.shift();
    res.writeHead(reply ? reply.status || 200 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply && reply.status ? { error: { message: reply.error } }
      : { choices: [{ message: { content: JSON.stringify(reply && reply.data || {}) }, finish_reason: 'stop' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const context = vm.createContext({ window: {}, fetch, AbortController, setTimeout, clearTimeout, $() { return null; },
      console: { warn() {} }, App: { toast() {}, modal() {} },
      Store: { d: { settings: { ai: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, key: 'fixture-key', model: 'fixture-model' } }, stats: {} } } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/ai.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/importer.js'), 'utf8'), context);
    const ai = context.window.AI, cfg = context.Store.d.settings.ai;
    const importer = context.window.Importer;
    const verify = (data = recognition) => {
      replies = [{ data }];
      return ai.verifyTranslationImport({ prompt }, source, { tries: 1 });
    };
    const check = async (name, fn) => { requests = []; await fn(); count++; console.log('PASS ' + name); };

    await check('Missing configuration returns a failure without a network request', async () => {
      cfg.key = '';
      await assert.rejects(ai.verifyTranslationImport({ prompt }, source), /设置页配置接口/);
      const result = await ai.gradeTranslation({ prompt }, '中文译文', [], 15);
      assert.equal(result.gradingFailed, true); assert.equal(result.score, undefined);
      assert.equal(requests.length, 0);
      cfg.key = 'fixture-key';
    });

    await check('Import verification uses original source and the saved endpoint/model', async () => {
      const result = await verify();
      assert.equal(result.status, 'ai-verified'); assert.equal(result.examPaper, 'english-2');
      assert.equal(result.model, 'fixture-model'); assert.ok(result.checkedAt);
      assert.equal(requests.length, 1);
      assert.ok(requests.every(req => req.path === '/v1/chat/completions' && req.authorization === 'Bearer fixture-key'));
      const sent = JSON.parse(requests[0].body.messages[1].content.split('\n\n只输出合法 JSON')[0]);
      assert.equal(sent.originalDocument, source.text); assert.equal(sent.candidate, prompt);
      assert.equal(requests[0].body.model, 'fixture-model');
      assert.deepEqual(Object.keys(context.Store.d.stats), []);
      assert.ok(!JSON.stringify(result).includes('fixture-key'));
    });

    await check('HTTP 401 rejects source verification', async () => {
      replies = [{ status: 401, error: 'Invalid API key' }];
      await assert.rejects(ai.verifyTranslationImport({ prompt }, source, { tries: 1 }), /401/);
      assert.equal(requests.length, 1);
    });

    await check('An incomplete recognition response cannot pass validation', async () => {
      await assert.rejects(verify({ ...recognition, complete: false, issues: ['缺少原文开头'] }), /缺少原文开头/);
      await assert.rejects(verify({ ...recognition, issues: undefined }), /未通过/);
    });

    await check('Evidence invented by AI cannot pass source verification', async () => {
      await assert.rejects(verify({ ...recognition, evidence: ['This sentence is not in the PDF.'] }), /原文中找到/);
      await assert.rejects(verify({ ...recognition, examPaper: 'cet4' }), /有效卷别/);
    });

    await check('Unknown paper stays unknown instead of inventing English I or II', async () => {
      const result = await verify({ ...recognition, examPaper: 'unknown' });
      assert.equal(result.examPaper, ''); assert.equal(result.status, 'ai-verified');
    });


    await check('Character-level text issues are surfaced without blocking the import', async () => {
      cfg.key = 'fixture-key';
      replies = [{ data: { ...recognition, textIssues: ['「礼也」疑为「礼仪」'] } }];
      const result = await verify({ ...recognition, textIssues: ['「礼也」疑为「礼仪」'] });
      assert.equal(result.status, 'ai-verified', '错字提示不应阻断导入');
      assert.equal(JSON.stringify(result.textIssues), JSON.stringify(['「礼也」疑为「礼仪」']));
      // 没有该字段时也要能正常工作（老模型不返回 textIssues）
      const plain = await verify({ ...recognition, textIssues: undefined });
      assert.equal(plain.textIssues.length, 0);
    });
    await check('Invalid grading numbers fail without fabricated scores', async () => {
      replies = [{ data: { ...grade, score: { ...grade.score, total: 18 } } }];
      const result = await ai.gradeTranslation({ prompt }, '中文译文', [], 15, { tries: 1 });
      assert.equal(result.gradingFailed, true); assert.match(result.errMsg, /范围/);
      assert.equal(result.score, undefined); assert.equal(result.apiVerification, undefined);
    });

    await check('Real grading rejects missing fields, inconsistent scores and non-Chinese output', async () => {
      assert.match(ai.translationScoreIssue({ ...grade, score: {} }, 15), /缺失/);
      assert.match(ai.translationScoreIssue({ ...grade, score: { ...grade.score, total: 10 } }, 15), /不一致/);
      assert.match(ai.translationScoreIssue({ ...grade, polished: 'An English essay.' }, 15), /不完整/);
      replies = [{ data: grade }];
      const result = await ai.gradeTranslation({ prompt }, '中文译文', [], 15, { tries: 1 });
      assert.equal(result.gradingFailed, undefined); assert.equal(result.apiVerification.status, 'passed');
      assert.equal(result.translation, true);
      assert.match(requests[0].body.messages[0].content, /英译汉/);
      assert.equal(result.score.total, 14);
    });

    await check('Every import path automatically verifies translations before commit', async () => {
      importer.target = 'writing';
      replies = [{ data: recognition }];
      const output = { passages: [{ prompt, writingType: 'translation' }] };
      await importer._verifyTranslations(output, source.heading + '\n' + source.text, { type: 'kaoyan' });
      assert.equal(output.passages[0].translationVerification.status, 'ai-verified');
      assert.equal(output.passages[0].examPaper, 'english-2');
      assert.equal(requests.length, 1);
    });

    await check('Translations misclassified as reading get verified and moved to writing', async () => {
      replies = [{ data: recognition }];
      const output = { modules: { reading: [{ readingType: 'translation', text: prompt }], writing: [] } };
      await importer._verifyTranslations(output, source.heading + '\n' + source.text, { type: 'kaoyan' });
      assert.equal(output.modules.reading.length, 0); assert.equal(output.modules.writing.length, 1);
      assert.equal(output.modules.writing[0].translationVerification.status, 'ai-verified');
    });

    await check('Automatic verification fails when no AI is configured', async () => {
      cfg.key = '';
      await assert.rejects(importer._verifyTranslations({ passages: [{ prompt, writingType: 'translation' }] }, source.text,
        { type: 'kaoyan' }), /设置页配置接口/);
      assert.equal(requests.length, 0);
      cfg.key = 'fixture-key';
    });
    console.log(`${count} local API workflow checks passed. No external AI provider was used.`);
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
