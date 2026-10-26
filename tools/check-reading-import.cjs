const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '../js/importer.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(code.slice(0, code.indexOf('const Importer =')), context);
const plain = value => JSON.parse(JSON.stringify(value));

const first = 'A school introduced a reading programme for its students. Teachers collected information about reading habits and compared the results with those of another school.';
const opening = 'A research team studied how people form expectations about unfamiliar neighbours. They recorded the information available to each participant before conducting the study.';
const ending = 'The researchers then followed the participants for several weeks. The results showed that knowing a little about a neighbour changed the decisions people made.';
const q1 = { number: 46, q: 'What did the teachers compare in the reading programme?', opts: ['Reading habits', 'School buildings', 'Sports results', 'Meal plans'], a: null };
const q2 = { number: 51, q: 'What information did the research team record before the study?', opts: ['Available information', 'Exam marks', 'Weather reports', 'Shopping lists'], a: null };
const paper = `Part II Listening Comprehension
Passage One
Questions 16 to 16 are based on the following passage.
${opening}
16. A listening question about the participants.
A) First option.
B) Second option.
Part H L Reading Comprehension
Section C
Passage One
Questions 46 to 46 are based on the following passage.
${first}
46. ${q1.q}
A) Reading habits.
B) School buildings.
Passage Two
Questions 51 to 51 are based on the following passage.

${opening}

${ending}
23 · 2026 年 6 月四级真题（第三套）·

5 1. ${q2.q}
A) Available information.
B) Exam marks.
Part IV Translation
An unrelated translation exercise follows here.`;

let count = 0;
function check(name, fn) { fn(); count++; console.log('PASS ' + name); }

check('English Passage headings keep the next article separate from preceding material', () => {
  const preceding = Array.from({ length: 20 }, () => first).join('\n');
  const text = `Passage One\n${preceding}\nPassage Two\n${opening}\n${ending}\n`;
  const chunks = context.splitImportText(text, 4500);
  assert.ok(chunks.some(chunk => chunk.startsWith('Passage Two\n') && chunk.includes(opening) && chunk.includes(ending)));
});

check('Source extraction retains both paragraphs, strips page footers and accepts spaced question numbers', () => {
  const sources = plain(context.extractTraditionalReadingSources(paper));
  assert.equal(sources.length, 2);
  assert.deepEqual(sources[1].paragraphs, [opening, ending]);
  assert.equal(sources[1].firstNumber, 51);
  assert.ok(!sources[1].paragraphs.join(' ').includes(q2.q));
});

check('A truncated AI article is restored from the complete source', () => {
  const input = [{ title: 'Passage Two', paragraphs: [ending], questions: [q2] }];
  const result = plain(context.preserveImportedReadingSources(input, paper));
  assert.deepEqual(result[0].paragraphs, [opening, ending]);
  assert.deepEqual(result[0].questions, [q2]);
  assert.deepEqual(input[0].paragraphs, [ending]);
});

check('Question-only and body-only fragments with different titles retain one complete passage', () => {
  const result = plain(context.preserveImportedReadingSources([
    { title: 'Passage 2', paragraphs: [ending], questions: [] },
    { title: 'The exam paper', paragraphs: [], questions: [q2] },
  ], paper));
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].paragraphs, [opening, ending]);
  assert.deepEqual(result[0].questions, [q2]);
});

check('A question belonging to Passage Two is not attached to the preceding Passage One', () => {
  const result = plain(context.preserveImportedReadingSources([
    { title: 'Passage One', paragraphs: [first], questions: [] },
    { title: 'The exam paper', paragraphs: [], questions: [q2] },
  ], paper));
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].paragraphs, [first]);
  assert.deepEqual(result[1].paragraphs, [opening, ending]);
});

check('Paragraph matching and material without confirmed source boundaries remain intact', () => {
  const matching = { readingType: 'section-b', paragraphs: [{ label: 'A', text: opening }], questions: [] };
  assert.deepEqual(plain(context.preserveImportedReadingSources([matching], paper)), [matching]);
  const unlabelled = { title: 'Unknown text', paragraphs: [ending], questions: [] };
  assert.deepEqual(plain(context.preserveImportedReadingSources([unlabelled], 'An unstructured article.')), [unlabelled]);
});

check('A page break inside a sentence retains its original word order', () => {
  const wrapped = paper.replace(ending, ending.replace('for several weeks.', 'for several\n\nweeks.'));
  assert.deepEqual(plain(context.extractTraditionalReadingSources(wrapped))[1].paragraphs, [opening, ending]);
});

console.log(`${count} reading import checks passed.`);
