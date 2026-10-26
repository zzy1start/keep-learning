/* 扩充题库：按「年份 + 篇章」组织，供听力/写作/阅读按年份篇章选择
 *
 * 重要说明：以下均为**按真题题型与难度自编的仿真题**，不是真题原文。
 * 真题受版权保护不可内置。选择器按真题的真实结构（年份/场次/篇章号）组织，
 * 便于考生按"2023年6月 第2篇"这类定位习惯使用，同时避免题目归属错误。
 *
 * 数据来源合法性：自编内容，词句均为本项目原创或通用表述。
 */
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'data', 'content');

/* ============ 听力：按 年份-场次-篇章 ============ */
const listening = {
  meta: {
    note: '仿真题，非真题原文。按真题「年份/场次/篇章」结构组织。',
    structure: '六/四级听力：一卷含 Section A 短篇新闻(3篇) + Section B 长对话(2篇) + Section C 短文(3篇)；',
  },

  // 单句听力（保留原有，供快速练习）
  sentences: [
    { en: "Interdisciplinary education encourages students to connect knowledge across different fields.", cn: "跨学科教育鼓励学生将不同领域的知识联系起来。", tags: ['教育', '六级'] },
    { en: "The lecture will begin at nine a.m. in the main building.", cn: "讲座将于上午九点在主楼开始。", tags: ['日常', '四级'] },
    { en: "Please make sure to submit your assignment before the deadline.", cn: "请确保在截止日期前提交作业。", tags: ['校园', '四级'] },
    { en: "Researchers have found that sleep deprivation impairs memory formation.", cn: "研究人员发现睡眠不足会损害记忆形成。", tags: ['健康', '六级'] },
    { en: "The company adopted a new marketing strategy to attract younger consumers.", cn: "该公司采用了一种新的营销策略来吸引年轻消费者。", tags: ['商务', '六级'] },
    { en: "Climate change poses a serious threat to coastal ecosystems.", cn: "气候变化对沿海生态系统构成严重威胁。", tags: ['环境', '六级'] },
    { en: "Although the proposal seemed promising, it was ultimately rejected.", cn: "尽管这个提案看起来很有前景，但最终被否决了。", tags: ['六级', '难句'] },
    { en: "Regular exercise not only strengthens the body but also improves mood.", cn: "规律运动不仅强健身体，还能改善情绪。", tags: ['健康', '四级'] },
    { en: "The committee has decided to postpone the vote until next month.", cn: "委员会决定将投票推迟到下个月。", tags: ['六级', '商务'] },
    { en: "Students are encouraged to take part in international exchange activities.", cn: "学校鼓励学生参加国际交流活动。", tags: ['校园', '四级'] },
    { en: "What strikes me most about this policy is how little discussion it has generated.", cn: "这项政策最让我惊讶的是它引发的讨论如此之少。", tags: ['六级', '难句'] },
    { en: "The university plans to expand its research programs next year.", cn: "该校计划明年扩展其研究项目。", tags: ['校园', '四级'] },
  ],

  dialogues: [
    {
      id: 'dlg-library', title: 'Library Renewal', level: 'CET-4', type: 'short-dialogue',
      turns: [
        { sp: 'W', en: "Excuse me, could you tell me where the reading room is?", cn: "打扰一下，阅览室在哪里？" },
        { sp: 'M', en: "It's been moved to the third floor since last month.", cn: "从上个月起已经搬到三楼了。" },
        { sp: 'W', en: "Oh, I see. Is it open on weekends?", cn: "哦，明白了。周末开放吗？" },
        { sp: 'M', en: "Yes, from nine to five on Saturdays and Sundays.", cn: "是的，周六日早上九点到下午五点。" },
      ],
      qs: [
        { q: "Where is the reading room now?", opts: ["On the third floor", "On the second floor", "Next to the library", "In the main building"], a: 0, tip: "关键信息为 moved to the third floor，注意 since last month 的时间限定。" },
        { q: "Is the reading room open at weekends?", opts: ["Yes, but only on Saturdays", "No, it is closed", "Yes, on both days", "Only for students"], a: 2, tip: "on Saturdays and Sundays 说明两天都开放。" },
      ],
    },
    {
      id: 'dlg-interview', title: 'Job Interview', level: 'CET-6', type: 'short-dialogue',
      turns: [
        { sp: 'M', en: "So, what made you apply for this position?", cn: "那么，是什么促使你申请这个职位？" },
        { sp: 'W', en: "I have worked in data analysis for three years, and I want to take on more responsibility.", cn: "我从事数据分析已经三年了，想承担更多责任。" },
        { sp: 'M', en: "That makes sense. Do you have any questions for us?", cn: "这说得通。你有什么想问我们的吗？" },
        { sp: 'W', en: "Yes. How often does the team hold performance reviews?", cn: "有的。团队多久进行一次绩效评估？" },
      ],
      qs: [
        { q: "Why does the woman apply for the position?", opts: ["She wants more responsibility", "She needs a higher salary", "Her current job closed", "She likes the company"], a: 0, tip: "take on more responsibility 是直接原因。" },
        { q: "What does the woman ask about?", opts: ["Working hours", "Performance reviews", "Team size", "Salary"], a: 1, tip: "最后一句问的是 performance reviews。" },
      ],
    },
  ],

  /* 长篇：按年份 + 场次 + 篇章编号 组织 */
  passages: [
    {
      id: 'ls-2023-06-1', year: 2023, session: '06', no: 1,
      title: 'The Rise of Online Learning', level: 'CET-6', type: 'cet6',
      genre: '教育科技', words: ['online learning', 'flexibility', 'interaction', 'discipline', 'completion rate'],
      script: [
        { s: 0, en: "Online learning has grown rapidly over the past decade. What was once considered a supplement to classroom teaching is now, for many students, the primary mode of instruction." },
        { s: 1, en: "The most obvious advantage is flexibility. Students can attend lectures recorded at any time and submit assignments whenever convenient." },
        { s: 2, en: "However, flexibility alone does not guarantee success. Research consistently shows that completion rates in online courses remain lower than in traditional classrooms." },
        { s: 3, en: "The reason, most educators agree, is a lack of discipline and social interaction. Without a fixed schedule, students easily procrastinate." },
        { s: 4, en: "Some universities have responded by redesigning courses around short modules with regular quizzes, which keeps students engaged week by week." },
        { s: 5, en: "In short, online learning works best when it is structured rather than left entirely to the student's own time management." },
      ],
      qs: [
        { q: "What is the main purpose of the talk?", opts: ["To introduce a new research project", "To explain the results of a recent survey", "To compare online and classroom learning", "To announce a change in university policy"], a: 2, tip: "全文围绕线上学习与传统课堂的对比展开，注意首句与末句的总结句。" },
        { q: "According to the speaker, what is the most obvious advantage of online learning?", opts: ["Lower tuition fees", "Flexibility", "Better interaction with teachers", "Higher completion rates"], a: 1, tip: "The most obvious advantage is flexibility 属于信号词句。" },
        { q: "What does research show about completion rates?", opts: ["They are higher online", "They are lower online", "They are about the same", "They have not been studied"], a: 1, tip: "remain lower than in traditional classrooms，注意 remain 的语义倾向。" },
        { q: "Why do completion rates fall, according to most educators?", opts: ["Poor internet connections", "Lack of discipline and interaction", "Expensive course materials", "Difficult examinations"], a: 1, tip: "a lack of discipline and social interaction 是因果句。" },
        { q: "What have some universities done in response?", opts: ["Lowered tuition fees", "Redesigned courses into short modules", "Reduced course length", "Hired more teachers"], a: 1, tip: "redesigning courses around short modules。" },
        { q: "What is the speaker's final point?", opts: ["Online learning should replace classrooms", "Structured design works best", "Students should self-manage time", "Recordings are more useful than live lectures"], a: 1, tip: "works best when it is structured 是结论句。" },
      ],
    },
    {
      id: 'ls-2023-06-2', year: 2023, session: '06', no: 2,
      title: 'Urban Green Space', level: 'CET-6', type: 'cet6',
      genre: '城市环境', words: ['urban green space', 'heat island', 'biodiversity', 'well-being', 'investment'],
      script: [
        { s: 0, en: "Cities around the world are losing their green space at an alarming rate as land values rise." },
        { s: 1, en: "This matters more than it may appear. Trees and parks reduce the heat island effect that makes urban summers dangerously hot." },
        { s: 2, en: "They also support biodiversity, providing habitat for birds and insects that would otherwise disappear entirely." },
        { s: 3, en: "Studies have repeatedly linked access to green space with improved mental well-being among residents." },
        { s: 4, en: "Some city governments now treat green space not as decoration, but as essential infrastructure." },
        { s: 5, en: "They are investing in rooftop gardens and restoring wetlands, even where land is extremely scarce." },
      ],
      qs: [
        { q: "Why are cities losing green space?", opts: ["Rising land values", "Air pollution", "Lack of planning", "Overpopulation"], a: 0, tip: "as land values rise 是原因状语。" },
        { q: "According to the talk, one effect of trees and parks is to:", opts: ["increase property values", "reduce the heat island effect", "lower noise levels only", "increase rainfall"], a: 1, tip: "reduce the heat island effect 直接给出。" },
        { q: "What benefit do residents gain according to studies?", opts: ["Lower rent", "Improved mental well-being", "Better air quality only", "More jobs"], a: 1, tip: "linked access to green space with improved mental well-being。" },
        { q: "How do some city governments now view green space?", opts: ["As decoration", "As essential infrastructure", "As a luxury", "As a private matter"], a: 1, tip: "not as decoration, but as essential infrastructure 是对比强调结构。" },
        { q: "What two measures are mentioned?", opts: ["Rooftop gardens and wetland restoration", "New railways and housing", "Higher taxes and subsidies", "Farming and fishing"], a: 0, tip: "investing in rooftop gardens and restoring wetlands。" },
      ],
    },
    {
      id: 'ls-2023-12-1', year: 2023, session: '12', no: 1,
      title: 'Why Cities Are Planting Trees', level: 'CET-6', type: 'cet6',
      genre: '城市规划', words: ['canopy', 'shade', 'air quality', 'stormwater', 'equity'],
      script: [
        { s: 0, en: "Municipal tree planting programmes have expanded rapidly in the past decade." },
        { s: 1, en: "The stated goal is often to reduce carbon emissions, but the measurable effects are more immediate." },
        { s: 2, en: "A mature street canopy can lower summer temperatures by several degrees, reducing the demand for cooling." },
        { s: 3, en: "Leaves also trap particulate matter, and their roots absorb stormwater that would otherwise flood the streets." },
        { s: 4, en: "Yet distribution remains uneven. Wealthier districts receive more planting than poorer ones." },
        { s: 5, en: "Advocates argue that equity should be the starting point rather than an afterthought." },
      ],
      qs: [
        { q: "What is the talk mainly about?", opts: ["The carbon footprint of trees", "Urban tree planting and its benefits", "How cities measure temperature", "Why planting programmes failed"], a: 1, tip: "首段给出主题，后段展开效益与公平问题。" },
        { q: "What can a mature canopy do, according to the talk?", opts: ["Lower summer temperatures", "Increase rainfall", "Reduce building costs", "Improve internet speed"], a: 0, tip: "lower summer temperatures by several degrees。" },
        { q: "What do leaves and roots do respectively?", opts: ["Absorb heat / block rain", "Trap particles / absorb stormwater", "Produce oxygen / store carbon", "Cool air / filter light"], a: 1, tip: "Leaves trap particulate matter, roots absorb stormwater。" },
        { q: "What problem does the speaker mention?", opts: ["Trees are too expensive", "Distribution is unfair between districts", "Residents dislike trees", "Planting harms transport"], a: 1, tip: "distribution remains uneven 是转折后的问题点。" },
        { q: "What do advocates emphasise?", opts: ["Cost first", "Equity as the starting point", "Only carbon benefits", "National standards"], a: 1, tip: "equity should be the starting point rather than an afterthought。" },
      ],
    },
    {
      id: 'ls-2024-06-1', year: 2024, session: '06', no: 1,
      title: 'The Problem with Speed', level: 'CET-6', type: 'cet6',
      genre: '科技伦理', words: ['acceleration', 'judgment', 'automation', 'oversight', 'accountability'],
      script: [
        { s: 0, en: "Modern technology has an undeniable capacity to make things faster." },
        { s: 1, en: "Speed, however, is not always a benefit. In some settings it degrades the very quality it is meant to improve." },
        { s: 2, en: "Consider medical diagnosis. A tool that returns a result in thirty seconds encourages clinicians to accept it without scrutiny." },
        { s: 3, en: "The problem is not the tool but the incentive structure surrounding it." },
        { s: 4, en: "Automation that removes human oversight removes accountability along with it." },
        { s: 5, en: "Governments are beginning to require that a named human remains answerable for any automated decision." },
      ],
      qs: [
        { q: "What does the speaker suggest about speed?", opts: ["It is always beneficial", "It can reduce quality", "It is mostly a marketing claim", "It matters only in medicine"], a: 1, tip: "Speed, however, is not always a benefit 是核心论点。" },
        { q: "What does the medical example illustrate?", opts: ["Hospitals are understaffed", "Fast results encourage uncritical acceptance", "Tools are expensive", "Diagnosis is easy"], a: 1, tip: "encourages clinicians to accept it without scrutiny。" },
        { q: "Where does the speaker locate the problem?", opts: ["In the tool itself", "In the incentive structure", "In patient demand", "In government policy"], a: 1, tip: "not the tool but the incentive structure。" },
        { q: "What happens when human oversight is removed?", opts: ["Accuracy improves", "Accountability disappears", "Costs fall", "Jobs return"], a: 1, tip: "removes accountability along with it。" },
        { q: "What are governments beginning to require?", opts: ["Faster tools", "A named human answerable for automated decisions", "Fewer doctors", "More data sharing"], a: 1, tip: "require that a named human remains answerable。" },
      ],
    },
    
    
  ],
};

/* ============ 阅读：按 年份-场次-篇章 ============ */
const reading = {
  meta: {
    note: '仿真题，非真题原文。按真题「年份/场次/篇章」结构组织。',
    structure: '四级/六级阅读：一卷4篇（选词填空/长篇阅读/仔细阅读）；',
  },
  passages: [
    {
      id: 'rd-2023-06-1', year: 2023, session: '06', no: 1,
      title: 'Interdisciplinary Education', level: 'CET-6', genre: '教育话题',
      timeLimit: 25, totalScore: 20,
      paragraphs: [
        "In recent years, many universities have placed increasing emphasis on interdisciplinary education, recognizing that complex global challenges cannot be solved within the boundaries of a single discipline. By integrating knowledge from different fields, students are encouraged to develop broader perspectives and more flexible problem-solving skills, which are essential in today's rapidly changing world.",
        "However, this approach also faces a number of challenges, including curriculum design, resource allocation, and the need for teachers to adapt to new teaching methods. Despite these difficulties, interdisciplinary education is widely regarded as a promising direction for higher education reform.",
      ],
      questions: [
        { q: 'According to the passage, what is a main advantage of interdisciplinary education?', opts: ['It reduces the workload of teachers.', 'It helps students develop broader perspectives.', 'It focuses only on scientific research.', 'It eliminates the need for traditional disciplines.'], a: 1, explain: '原文 "students are encouraged to develop broader perspectives and more flexible problem-solving skills"，A/D 与原文相反，C 无中生有。', evidence: '第二段前两句：By integrating knowledge from different fields, students are encouraged to develop broader perspectives...' },
        { q: 'Which of the following is mentioned as a challenge?', opts: ['The lack of student interest.', 'The need for curriculum design.', 'The decrease in university funding.', 'The shortage of foreign teachers.'], a: 1, explain: '原文列举 including curriculum design, resource allocation, and the need for teachers to adapt...，B 对应 curriculum design。', evidence: '第二段：including curriculum design, resource allocation, and the need for teachers to adapt to new teaching methods' },
        { q: "What is the author's attitude toward interdisciplinary education?", opts: ['Strongly opposed.', 'Cautiously optimistic.', 'Completely indifferent.', 'Highly suspicious.'], a: 1, explain: '用 However/Despite 让步后仍说 widely regarded as a promising direction，属"谨慎乐观"。', evidence: 'Despite these difficulties, interdisciplinary education is widely regarded as a promising direction' },
      ],
    },
    {
      id: 'rd-2023-06-2', year: 2023, session: '06', no: 2,
      title: 'The Rise of Remote Work', level: 'CET-6', genre: '社会趋势',
      timeLimit: 20, totalScore: 15,
      paragraphs: [
        "Remote work, once a temporary measure adopted during a global emergency, has become a permanent feature of the modern labour market. For many employees, the appeal is straightforward: no commute, greater flexibility over working hours, and the freedom to live far from expensive city centres.",
        "Employers, however, have adopted a more cautious stance. Studies conducted over the past three years suggest that fully remote teams often struggle with communication, mentorship of junior staff, and the preservation of informal team culture. A growing number of companies have therefore adopted hybrid arrangements, requiring staff to attend the office on a small number of fixed days.",
        "What remains unclear is whether hybrid working will prove durable. Some analysts predict that the arrangement will settle into a stable pattern within five years. Others argue that the pendulum will swing fully back towards the office as younger, more socially oriented workers enter the workforce.",
      ],
      questions: [
        { q: 'What is the main attraction of remote work for employees?', opts: ['Higher salaries.', 'Flexibility and no commute.', 'Better promotion opportunities.', 'Better health insurance.'], a: 1, explain: '原文冒号后列举 no commute, greater flexibility over working hours，B 为同义概括。', evidence: 'the appeal is straightforward: no commute, greater flexibility over working hours' },
        { q: 'According to the passage, what difficulty do fully remote teams face?', opts: ['Higher costs.', 'Communication and mentoring problems.', 'Legal restrictions.', 'Lack of qualified applicants.'], a: 1, explain: '原文 struggle with communication, mentorship of junior staff...，B 概括正确。', evidence: 'fully remote teams often struggle with communication, mentorship of junior staff' },
        { q: 'What do many companies now require?', opts: ['Full-time office attendance.', 'Working from any country.', 'A small number of fixed office days.', 'No fixed schedule at all.'], a: 2, explain: 'hybrid arrangements, requiring staff to attend the office on a small number of fixed days。', evidence: 'hybrid arrangements, requiring staff to attend the office on a small number of fixed days' },
        { q: "What does the last paragraph mainly discuss?", opts: ['The history of remote work.', 'Competing predictions about the future.', 'How to reduce office costs.', 'A survey of employee preferences.'], a: 1, explain: '末段用 Some analysts predict... Others argue... 呈现两种对立预测。', evidence: 'Some analysts predict... Others argue that the pendulum will swing fully back' },
      ],
    },
    {
      id: 'rd-2023-12-1', year: 2023, session: '12', no: 1,
      title: 'The Changing Role of Public Libraries', level: 'CET-6', genre: '社会趋势',
      timeLimit: 20, totalScore: 15,
      paragraphs: [
        'For most of the twentieth century, the public library was regarded primarily as a place to borrow books. That role has expanded considerably. Today, many libraries in large cities function as community centres, offering study space, internet access, job-search support and language classes.',
        "This shift has not gone unchallenged. Critics argue that providing social services diverts funding from the core purpose of libraries, which is to provide access to knowledge. Supporters counter that a library that people no longer visit is unlikely to sustain its funding base in the long term.",
      ],
      questions: [
        { q: 'What is the main change described in the passage?', opts: ['Libraries have become more community-oriented.', 'Libraries have stopped lending books.', 'Libraries have reduced their opening hours.', 'Libraries have become more expensive.'], a: 0, explain: '第一段 says the role expanded... function as community centres，属概括。', evidence: 'many libraries in large cities function as community centres' },
        { q: "What do critics worry about?", opts: ['A decline in book lending.', 'Funding being diverted from the core purpose.', 'A lack of internet access.', 'Too many community activities.'], a: 1, explain: 'critics argue that providing social services diverts funding...', evidence: 'diverts funding from the core purpose of libraries' },
        { q: 'How do supporters respond?', opts: ['They argue libraries should close.', 'They say an unused library will lose funding.', 'They admit funding is limited.', 'They propose raising book prices.'], a: 1, explain: 'a library that people no longer visit is unlikely to sustain its funding base。', evidence: 'is unlikely to sustain its funding base in the long term' },
      ],
    },
    {
      id: 'rd-2024-06-1', year: 2024, session: '06', no: 1,
      title: 'Why Sleep Matters for Memory', level: 'CET-6', genre: '健康科普',
      timeLimit: 20, totalScore: 15,
      paragraphs: [
        'Most people treat sleep as the one part of the day that can be shortened with the least consequence. Evidence accumulated over the past twenty years suggests the opposite.',
        "During deep sleep, the brain replays the electrical patterns recorded during waking hours. This process, known as consolidation, gradually transfers fragile memories into more permanent storage.",
        'Cutting sleep to six hours instead of eight reduced the recall of newly learned vocabulary by roughly forty per cent in controlled trials. The effect was strongest when the sleep loss occurred immediately after learning, suggesting that missed consolidation cannot simply be recovered later.',
      ],
      questions: [
        { q: 'What is the passage mainly about?', opts: ['How to improve concentration at work', 'The relationship between sleep and memory', 'Why students dislike early classes', 'The history of sleep research'], a: 1, explain: '首段提出普遍看法，末段给出研究数据，主题为睡眠与记忆的关系。', evidence: 'Cutting sleep to six hours... reduced the recall of newly learned vocabulary' },
        { q: 'What happens during deep sleep according to the passage?', opts: ['The brain stops recording patterns', 'The brain replays patterns learned while awake', 'Memory is permanently erased', 'New vocabulary is learned'], a: 1, explain: 'the brain replays the electrical patterns recorded during waking hours。', evidence: 'the brain replays the electrical patterns recorded during waking hours' },
        { q: 'What was the effect of sleeping six hours instead of eight?', opts: ['Recall dropped by about forty per cent', 'No measurable change', 'Learning improved slightly', 'Memory doubled'], a: 0, explain: 'reduced the recall of newly learned vocabulary by roughly forty per cent。', evidence: 'reduced the recall of newly learned vocabulary by roughly forty per cent' },
        { q: 'What does "consolidation" refer to?', opts: ['Falling asleep quickly', 'Transferring fragile memories to permanent storage', 'Recovering lost sleep later', 'Studying before bed'], a: 1, explain: 'This process, known as consolidation, gradually transfers fragile memories into more permanent storage。', evidence: 'gradually transfers fragile memories into more permanent storage' },
      ],
    },
    
  ],
};

/* ============ 写作：按 年份-场次-题目 ============ */
const writing = {
  meta: {
    note: '仿真题，非真题原文。按真题「年份/场次/题号」结构组织。',
    structure: '四级/六级写作：一篇作文 15分 或「短文+翻译」；',
  },
  sentenceTasks: [
    { en: 'Describe the benefits of learning a foreign language.', cn: '描述学习外语的好处。', hint: '可从求职、思维拓宽、文化理解三个角度展开，每段给出例子。' },
    { en: 'Explain why time management matters for students.', cn: '解释时间管理对学生的意义。', hint: '建议先给定义，再给两条理由，最后给一个例子。' },
    { en: 'What are the main causes of stress among college students?', cn: '大学生压力的主要来源是什么？', hint: '可用数据化描述 + 分类讨论（学业/经济/社交）。' },
    { en: 'Do you think online learning will replace traditional classrooms?', cn: '你认为在线学习会取代传统课堂吗？', hint: '注意让步结构，先承认优势再给出限制。' },
    { en: 'The importance of teamwork in modern workplaces.', cn: '现代职场中团队合作的重要性。', hint: '可引用研究/例证支撑观点。' },
  ],
  tasks: [
    {
      id: 'wr-2023-06-1', year: 2023, session: '06', no: 1,
      title: "Some people believe that technological progress makes people's life more convenient, while others think it brings more problems. What is your opinion?",
      cn: '有人认为技术进步使生活更便利，另一些人认为它带来更多问题。你怎么看？请给出理由并举例说明。',
      level: 'CET-6', genre: '社会热点', limit: 40, expectScore: 30, minWords: 150,
      outline: ['引入争议（两种立场）', '分析便利性：效率、医疗、教育', '分析问题：隐私、就业、数字鸿沟', '给出你的立场 + 结论'],
    },
    {
      id: 'wr-2023-06-2', year: 2023, session: '06', no: 2,
      title: 'Do you think universities should offer courses in both traditional and simplified Chinese?',
      cn: '你认为大学应该开设传统汉语和简体汉语两门课程吗？',
      level: 'CET-6', genre: '教育议题', limit: 40, expectScore: 30, minWords: 150,
      outline: ['表明立场', '论据一：文化传承', '论据二：现实需求', '让步与结论'],
    },
    {
      id: 'wr-2023-12-1', year: 2023, session: '12', no: 1,
      title: 'The importance of developing critical thinking rather than memorising facts in higher education.',
      cn: '高等教育中培养批判性思维而非死记硬背的重要性。',
      level: 'CET-6', genre: '教育议题', limit: 40, expectScore: 30, minWords: 150,
      outline: ['指出现象：重记忆轻思考', '论证批判性思维的长期价值', '给出具体培养方式', '总结'],
    },
    {
      id: 'wr-2024-06-1', year: 2024, session: '06', no: 1,
      title: 'Whether public spending should be prioritised on transport infrastructure or on healthcare.',
      cn: '公共支出应优先用于交通基础设施还是医疗保健。',
      level: 'CET-6', genre: '社会热点', limit: 40, expectScore: 30, minWords: 160,
      outline: ['引出两难选择', '交通：经济效率 + 通勤时间', '医疗：基本保障 + 公平', '给出优先级判断与条件'],
    },
    
    
  ],
};

/* ==== 写出 ==== */
const w = (f, o) => {
  const s = JSON.stringify(o);
  fs.writeFileSync(path.join(OUT, f), s);
  return (s.length / 1024).toFixed(1) + 'KB';
};
const yearsOf = arr => [...new Set(arr.map(x => x.year).filter(Boolean))].sort((a, b) => b - a);
console.log('listening.json', w('listening.json', listening),
  '| sentences', listening.sentences.length,
  '| dialogues', listening.dialogues.length,
  '| passages', listening.passages.length, '年份', yearsOf(listening.passages).join(','));
console.log('reading.json  ', w('reading.json', reading),
  '| passages', reading.passages.length, '年份', yearsOf(reading.passages).join(','));
console.log('writing.json  ', w('writing.json', writing),
  '| tasks', writing.tasks.length, '年份', yearsOf(writing.tasks).join(','),
  '| sentenceTasks', writing.sentenceTasks.length);