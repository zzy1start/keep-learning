/* ============ wordlevel.js : 词汇分层与跨书混入 ============
 *
 * 解决三个问题：
 * 1. 「跳过简单词」的范围要覆盖**小学 / 初中 / 高中**基础词，
 *    不能只按词频位置粗略切一段。
 * 2. 选六级词汇时，四级的易错词与高频词要**保留一定比例**——
 *    完全跳过四级词会导致六级学习者失去高频基础。
 * 3. 背六级词时，**每约 30 个词额外混入 1–2 个四级词**，
 *    用于熟悉（间隔重复里这些词会以更高的成功率出现，起到巩固作用）。
 *
 * 分层依据：词库每条都有 freq（词频，0~1，越大越常见）。
 * 基础词的 freq 显著高于难词，因此用 freq 阈值 + 显式基础词表双重判定。
 */

/* ---------- 小学 / 初中 / 高中核心基础词（节选高频）----------
 * 完整清单过大，这里收录最典型的 400 个左右，覆盖小学毕业到高中、
 * 决定「这些词不该再学」的那部分。
 */
const BASIC_WORDS = new Set(`
apple are arm art away back bad bag ball bank bath bear bed bee begin behind believe bell below
best better between big bike bird birthday bit black blank blue board boat body book born borrow both
bowl box boy bread break breakfast bridge bright bring brother brown brush build bus business busy but
buy cake call camera can candy cap car card care carry cat catch chair change cheap check cheese chicken
children choose city class clean clear climb clock close clothes cloud cloudy coat coffee cold collect
colour come comfortable common computer continue cook cool copy corner correct count country course cow
crayon cry cup cut dance danger dark date daughter day dear decide deep desk dictionary die different
difficult dinner dirty dish do doctor dog doll dollar door double down draw dream dress drink drive drop
dry during each ear early earth easy eat egg eight either electric elephant else empty end enemy enjoy
enough enter especially evening ever every everyone everything exam example excellent except excited excuse
exercise expensive experience explain eye face fact factory fall family famous far farm farmer fast fat
father favourite fear feel feet few field fill film find fine finger finish fire first fish fit five fix
flag flat floor flower fly follow food foot football for forget fork form four free fresh fridge friend
front fruit full fun furniture future game garden gate get gift girl give glad glass glasses glove go
goal gold good goodbye grandfather grandmother grass great green grey ground group grow guess hair half
hall hand happen happy hard hat hate have he head health hear heart heavy hello help her here herself
hi high hill him himself his history hit hobby hold holiday home homework hope horse hospital hot hotel hour
house how however hundred hungry hurry hurt I ice idea if ill important in inch into invite is it its
jacket jeans job join journey jump just keep key kick kid kind king kiss kitchen knee knife know lake lamp
land language large last late laugh learn leave left leg lemon lesson let letter library lie life light
like line lion lip list listen little live lock lonely long look lose loud love low luck lunch machine
magazine main make man many map market marry match maths matter may maybe me meal mean meat medicine meet
melt message metal method middle midnight milk million minute mirror miss mistake mix model modern moment
Monday money monkey month moon more morning most mother mountain mouse mouth move movie much museum music
must my name narrow nation nature near neck need neighbour never new news newspaper next nice night nine
no noise none noodle nor north nose not note nothing notice novel now number nurse obey ocean of off offer
office often oil old on once one only open or orange order other our out outside over own page paint pair
pants paper parent park part party pass passport past pay pen pencil people per perfect perhaps person pet
photo piano pick picture piece pig pink place plan plane plant plastic plate play playground please plenty
pocket point police poor popular possible post potato pound practice prefer prepare present press pretty
price print probably problem promise pull push put queen question quick quiet quite radio rain read ready
real really reason receive red remember remind rent repeat report rest restaurant rice rich ride right ring
rise river road rock room rope round rubber ruler run sad safe sail salt same sandwich satisfy Saturday save
say school science scissors score sea search season seat second see sell send sentence September serious
seven several shall share she sheep sheet shelf shine ship shirt shoe shop shopping short should shoulder
shout show shut sick side sign silence silver simple since sing single sink sister sit six size skirt sky
sleep slow small smell smile smoke snake snow so soap sock soft some somebody someone something sometimes
son song soon sorry sound soup south space speak special spell spend sport spot spring square stand star start
station stay steal steam steel step stick still stone stop store story straight strange street strong student
study stupid subject sugar summer sun Sunday sunny supermarket supper supply support sure surprise sweater
sweet swim swim table tail take talk tall taste taxi tea teach teacher team telephone television tell ten
tennis terrible test than thank that the their them themselves then there these they thick thin thing
think third this those though three throw Thursday ticket tidy tie tired time tiny tired to today together
tomato tomorrow tonight too tooth top touch towel toward town toy traffic train travel tree triangle trip
trousers truck true trust truth try Tuesday turn twelve twenty twice two umbrella uncle under understand
unhappy university until up upon use usually vegetable very village visit voice wait wake walk wall want
warm wash watch water way we wear weather wedding Wednesday week weekend well wet what when where which
while white who whole why wide wife will win wind window wine wing winter wise wish with without woman
wonder wood word work world worry worse worth would write wrong year yellow yes yesterday yet you young
your yourself zero zoo
`.trim().split(/\s+/));

/* 四级高频词（背六级时混入用）——取自四级词书的常见核心词 */
const CET4_CORE = new Set(`
ability able accept account achieve across act action active activity add address advantage
affect after again against age ago agree ahead allow almost alone along already also although always
among amount analysis ancient angry announce another answer anxiety anxious anyone anything anyway appear
apply area argue around arrange arrive article artist ask attention attitude attract audience author
authority available average avoid award aware
balance basic basis battery behavior belong benefit besides beyond bill billion bit board boil bone book
border born borrow bother bottle bottom brain branch breath brief bright bring broad budget build burden
business
calculate campaign cancer candidate capable capacity capital career careful case cash cause central
century certain chance change channel chapter character charge charity chart cheap check chief choice
choose circumstance claim class clean clear climb clock close clothes cloud club coach coal coast coat
code collect college color column combine come comfort comfortable command comment commercial commit
committee communicate community compare compete competition complete complex computer concentrate concern
conclusion condition conduct conference confidence confirm conflict connect connection consider consist
constant contain content context continue contract contrast contribute control convenient conversation cook
cool cooperate copy corner correct cost cotton council count courage course court cover crash create
creative credit crime criminal crisis criticize crucial cultural culture curious current custom customer cut
cycle
damage dance danger dark data deal death debate debt decade decide decision declare decline decorate
decrease deep defeat defend define definitely degree delay deliver demand democracy demonstrate deny
department depend deposit describe description deserve design desire despite destroy detail determine
develop development device devote difference different difficult digital direct direction director discover
discuss discussion disease dish dismiss display distance distant divide division doubt download dozen draft
drama dramatic draw dream dress drink drive drop drug drum duplicate during
eager ear early earn earth ease easily eastern easy economy edge edit educate education effect effective
efficiency effort elect election electronic element eliminate elsewhere embrace emerge emergency emotion
emphasis employ employee employer empty enable encounter encourage end enemy energy engage engine engineer
enormous enough ensure enterprise entertainment entire entrance environment equipment error escape especially
essay essential establish estimate ethnic evaluate even evening event eventually ever every everybody everyday
everyone everything evidence evil evolve exact examine example exceed excellent except exchange exciting
exclude excuse execute exercise exhaust exist exit expand expectation expense experience experiment expert
explore export express expression extend extent
factor fade fail failure fair faith familiar famous fancy fantastic far fashion feature fee feed feeling
fellow female fence fever fight figure file fill film final finance financial find fine finger finish
firm flat flavor flee flesh flight flood flow flower flu fluent focus fold folk follow fond food fool
foot force forecast foreign forest forever forgive formal format former fortune forward found foundation
frame framework franchise freedom freeze frequency frequent fresh friction friend frighten fuel full function
fund fundamental funeral funny furniture further future
gallery gap garage gather gender gene general generation generous gentle genuine gesture giant gift girl give
glance global glory glove glue goal govern government grab grade gradually graduate grain grand grant
grateful great green grocery ground group grow growth guarantee guard guest guide guilty
habit handle hang happen happy hard hardly hardware harm harvest hat hate head headline heal health
heart heat heaven hedge height hell hello hesitate hide high highlight highly highway hire historic
historical hobby hold hole holiday hollow home honest honor hook hope horizon horror host household
housing huge human humor hunt hurry hurt
ice idea ideal identify identity ignore ill illegal illness illustrate image imagine immediate immigrant
impact implement implication imply import importance impose impression impressive improve incident income
increase incredible indeed independent indicate individual industrial industry influence inform initial
initiative injury inner innocent inquiry insight insist inspire install instance instinct institute
institution instruction instrument insurance intelligent intend intention interaction interfere interior
internal international interpret interrupt interval intervene interview intimate introduce invasion invest
investigate invisible involve iron isolate issue
jacket jail jealous jewelry job join joke journal joy judge judgment juice junior justice justify
keen keep key kick kind kingdom knock knowledge
label labor lack ladder lady landscape language large largely last late later latter laugh launch law
layer lay lead leadership leaf league lean learn least leather leave lecture legal legend leisure lend length
less lesson level liberty license lift likely limit link liquid list listen literacy literally literary
literature little live load loan local locate location lock log logical lonely long loop loose lose loss
lost loud lovely lover lower loyal luck lucky luggage lung
main mainly maintain major majority make male manner manufacturer margin mark market marriage mass massive
master match material mathematics matter maximum meaning meanwhile measure meat mechanism media medical
medicine medium melt memory mental mention mercy mere merely mess message metal method middle midnight
might mild military milk million mind mine minimum minor minority miracle mirror missile missing mission
mistake mix mixture mobile mode moderate modest modify moist moment monitor moral moreover motor mount
movement mud multiple murder muscle museum music mutual mystery
naked name narrow nation native natural nature navy neat necessity neck negative neglect negotiate
neighbor neither nerve nervous net network neutral nevertheless nightmare noble noise nominate none nonsense
normal northern nose notable note nothing notice notion novel nowhere nuclear numerous
obligation observation observe obtain obvious occasion occupy occur ocean odd offend offensive operate
operation opponent opportunity oppose opposite optimistic option orange ordinary organic organization
organize origin original otherwise ought outcome outdoor outline output outstanding overall overcome overlook
owe owl own
pace pack package pain painful paint painting pair pale palm pan panel panic paper paragraph parallel
parliament partial participate particular partner passion passive past patch patience patient pattern pause
pave payment peace peak peer penalty pension people perceive percent perfect perform permanent permit
person personal personality perspective persuade phase phenomenon philosophy physical physician piano pick
picnic picture pie piece pierce pile pilot pine pink pioneer pipe pitch pity plain plan planet plant
plastic platform play pleasure plenty plot plug plus pocket poem poet poetry poison pole policy polite
pollution pool poor pop popular population porch port portion portrait position positive possess
possession post pot potato potential pour poverty powder power powerful practical practice pray precious
precise predict prefer pregnancy pregnant prejudice preliminary premium prepare prescription presence preserve
president press pressure pretend pretty prevent previous priest primary prime principle priority prison
privacy private privilege procedure proceed process produce product profession professional professor profile
profit program progress prohibit project promise promote prompt proof proper property proportion proposal
propose prospect protect protein protest proud prove provide province public publish pull pump punish purchase
pure purpose pursue push puzzle
qualify quality quantity quarrel quarter quest question quick quiet quite quote
racial radiation railway raise random range rank rapid rare rate rather ratio raw reach react reaction read
reader realistic reality realize really reason recall receipt receive recent reception recipe recognize
recommend record recover recruit reduce refer reference reflect reform refuse regard regime region
register regret regular regulate reinforce reject relate relative relax release relevant relief religion
reluctant rely remain remark remedy remember remind remote remove render renew rent repair repeat replace
reply report represent republic reputation request require rescue research reserve resident resist resolve
resort resource respect respond response responsibility rest restore restrict result retain retire retreat
return reveal revenue reverse review revise revolution reward rhythm rice rich rid ride ridiculous ring rise
risk rival river road rock role roll romantic roof room root rope rose rough round routine row rub rude
ruin rule run rural rush
sack sacrifice sad safety sake salad salary sale salmon sample sand satellite satisfy sauce scale scan
scandal scared scatter scene schedule scheme scholar school science scissors score scratch scream screen
script sculpture sea search season seat second secret secretary section sector secure security see seed seek
seem segment seize select self sell senate senior sense sensitive sentence separate sequence series serious
serve service session set settle severe sew shade shadow shake shall shallow shame shape share sharp shed
sheep sheet shelf shelter shift shine ship shock shoot shop short shoulder shout show shower shrink shut
sight sign signal significant silence silver similar simple simply sin since sincere sing single sink sir
sister sit site situation size ski skill skin skirt sky slave sleep slice slide slight slightly slip
slope smart smell smile smoke smooth snake sneak snow so soap social society soft software soil soldier
sole solid solution solve somehow somehow someone something sometimes somewhat somewhere son song soon
sorry sort soul sound soup source south space span spark speaker specialist species specific specify
specimen spectacular speech speed spend sphere spice spider spirit spiritual spite split spokesman
sponsor spot spread spring spy square squeeze stability stable staff stage stain stake stand standard
star stare start starvation state statement statistics statue status steady steal steam steel steep
stereotype steer stem step stick stiff stimulate stir stock stomach stone stop storage store storm
straight strain strategy stream street strength stress stretch strict strike string strip stroke structure
struggle student studio stuff stupid style subject submit subsequent substance substitute subtle suburb
subway succeed success such sudden suffer sufficient sugar suggest suit suitable sum summary summer summit
sunny sunrise sunset super supply support suppose supreme sure surface surgery surprise surround survey
survive suspect sustain swallow swear sweat sweep swell swift switch symbol sympathy symptom system
table tail talent talk tank tap tape target task taste tax tea teach team tear tease technical technique
technology teen teenager telescope television tell temper temperature temporary tempt tend tendency tension
term terms terrible territory terror test testify text texture than thank that the theater theft theme
theory therapy there therefore thick thin thing think third thirst thorough though thought thousand
threaten thrive throat throne through throughout throw thumb thunder thus ticket tie tight timber time
tiny tip tire tissue title to tobacco today toe together tomato tomorrow tone tongue tonight too tool
tooth top topic torch total touch tough tour tourist tournament toward towel tower town trace track
trade tradition traffic tragedy trail train transfer transform transition translate transport trap travel
treasure treat treaty tree tremendous trend trial tribe trick trigger trip triumph troop trouble
truck trust truth try tube tunnel turn twin twist type typical
ugly ultimate umbrella unable uncle under undergo underline understand undertake undo unfortunately uniform
union unique unit unite universe university unless unlike unusual upon upper upset urban urge urgent
usage use useful usual utility
vacant vacation vague valid valley valuable value variation variety various vary vast vehicle venture version
victim victory view village violate violence virtual virtue visible vision visit visitor vital vitamin
vocabulary voice volume volunteer vote voyage
wage wait wake walk wall wander want war warm warn warrant wash waste watch water wave way wealth weapon
wear weather web wedding week weekend weigh weight welcome welfare well west western wet what whatever
wheat wheel when whenever where whereas whether which while whisper white whole whom whose wide widespread
widow width wife wild willing win wind window wine wing winner winter wipe wire wisdom wise wish witness
wonder wonderful wood wool word work worker workshop world worry worth wound wrap write writer wrong
yard
youth
zeal
`.trim().split(/\s+/));

const WordLevel = {
  BASIC_WORDS,
  CET4_CORE,

  /** 是否属于小学/初中/高中基础词 */
  isBasic(w) {
    return BASIC_WORDS.has(String(w).toLowerCase());
  },

  /** 是否四级核心高频词 */
  isCet4Core(w) {
    return CET4_CORE.has(String(w).toLowerCase());
  },

  /**
   * 判定一个词的「难度层级」
   * @returns 'basic'小学初中高中 | 'cet4' 四级核心 | 'normal' 普通
   */
  level(w) {
    const x = String(w).toLowerCase();
    if (BASIC_WORDS.has(x)) return 'basic';
    if (CET4_CORE.has(x)) return 'cet4';
    return 'normal';
  },

  /**
   * 统计词书中各层级词数
   */
  statsOf(words) {
    const s = { basic: 0, cet4: 0, normal: 0, total: words.length };
    words.forEach(w => { s[this.level(w.w)]++; });
    return s;
  },

  /**
   * 计算「应跳过」的词集合
   *
   * 【重要】六级/考研词书本身已剔除大部分基础词（实测六级 5651 词里
   * 只有 95 个属于小学/初中/高中基础词），所以只靠基础词表跳不过去。
   * 真正需要处理的是**四级高频词**：
   *   - 大部分四级高频词在六级词书里也出现 → 直接跳过（学生已会）
   *   - 少数四级易错/高频词六级没收录 → 保留一部分（keepCet4Ratio）
   * 两者合起来才构成"跳过简单词"的实际效果。
   *
   * @param {Array} words 目标词书
   * @param {object} o { keepCet4Ratio 保留的四级词比例, tailSkip 额外跳过的低频长尾数 }
   */
  skipSetOf(words, o = {}) {
    const skip = new Set();

    // 1) 小学/初中/高中基础词
    words.forEach(w => { if (this.isBasic(w.w)) skip.add(w.w); });

    // 2) 四级核心词：词书里已收录的 → 跳过（学生已掌握）
    //    这是「跳过简单词」的主力
    const cet4InBook = words.filter(w => this.isCet4Core(w.w));
    // 保留一小部分高频四级词（用户要求"保留一定比例"）
    const keepRatio = o.keepCet4Ratio != null ? o.keepCet4Ratio : 0.18;
    const sortedCore = cet4InBook.slice().sort((a, b) => (b.freq || 0) - (a.freq || 0));
    const keepN = Math.round(sortedCore.length * keepRatio);
    sortedCore.slice(keepN).forEach(w => skip.add(w.w));

    // 3) 极低频长尾词（生僻词），按正确率决定跳过多少
    const tailLimit = o.tailSkip || 0;
    if (tailLimit > 0) {
      const tail = words.slice()
        .filter(w => !skip.has(w.w))
        .sort((a, b) => (a.freq || 0) - (b.freq || 0))
        .slice(0, tailLimit);
      tail.forEach(w => skip.add(w.w));
    }
    return skip;
  },

  /**
   * 生成学习队列：把四级核心词按比例混入目标词书
   *
   * @param {Array} targetWords 目标词书（如 cet6）
   * @param {Array} cet4Words 四级词书
   * @param {object} o { keepCet4Ratio, injectEvery }
   * @returns {Array} 学习队列
   *
   * 【比例控制】最终四级词占比要落在合理区间（约 10%~25%）。
   * 之前把所有保留词都append 到队列末尾，导致占比飙到 38%。
   * 现在改为：保留词也走注入通道，按目标比例投放。
   */
  buildQueue(targetWords, cet4Words, o = {}) {
    const keepRatio = o.keepCet4Ratio != null ? o.keepCet4Ratio : 0.18;
    const injectEvery = o.injectEvery || 30;
    const targetMix = o.targetMix != null ? o.targetMix : 0.18;   // 四级词目标占比

    // 1) 目标词书：剔除基础词 + 已掌握的四级词
    const skip = this.skipSetOf(targetWords, { keepCet4Ratio: keepRatio });
    const main = targetWords.filter(w => !skip.has(w.w));
    const M = main.length;
    if (!M) return [];

    // 2) 需要投放的四级词总量（按目标占比反推，避免超过主词数）
    //    实际四级占比 = 保留部分（keepCet4Ratio）+ 注入部分（targetMix）
    const wantTotal = Math.min(Math.round(M * targetMix / (1 - targetMix)), Math.floor(M * 0.20));
    const perWindow = Math.max(1, Math.round(injectEvery * targetMix * 0.6));

    // 3) 选池：优先「目标词书里没有」的四级核心词（这些才需要巩固）
    const mainSet = new Set(main.map(w => w.w));
    const cand = cet4Words.filter(w => !mainSet.has(w.w) && this.isCet4Core(w.w));
    const pool = cand.slice().sort((a, b) => (b.freq || 0) - (a.freq || 0));
    if (!pool.length) return main;

    // 4) 组装：每 injectEvery 个主词，插入 perWindow 个四级词
    const queue = [];
    let pi = 0;
    main.forEach((w, i) => {
      queue.push(w);
      if ((i + 1) % injectEvery === 0) {
        for (let k = 0; k < perWindow && pi < pool.length && queue.length < M + wantTotal; k++) {
          queue.push(pool[pi++]);
        }
      }
    });
    // 收尾：若仍未达目标，补充；池子耗尽则停止
    while (pi < pool.length && queue.length < M + wantTotal) queue.push(pool[pi++]);

    return queue;
  },

  /** 统计混入结果，用于展示 */
  mixStats(queue) {
    let cet4 = 0;
    queue.forEach(w => { if (this.isCet4Core(w.w)) cet4++; });
    return {
      total: queue.length,
      cet4,
      ratio: queue.length ? Math.round(cet4 / queue.length * 100) : 0,
    };
  },
};
window.WordLevel = WordLevel;
