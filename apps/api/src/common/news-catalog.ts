import type { NewsCategory } from '@prisma/client';

/**
 * Curated editorial seed content for the News section.
 *
 * Editorial policy (see infra/README and JOBTALENTIO-DUMMY.md):
 * - Every article is an ORIGINAL short editorial written for Job Talentio,
 *   grounded in widely reported, stable facts about Uzbekistan's labor
 *   market. Nothing is scraped or copied from third-party articles.
 * - `sourceName`/`sourceUrl` point readers to the relevant publication or
 *   institution homepage for further reading (stable links, no deep links
 *   that rot).
 * - Covers are Unsplash CDN images (Unsplash license permits hotlinking and
 *   commercial use without attribution; we still credit the platform).
 */
export type NewsSeed = {
  slug: string;
  category: NewsCategory;
  title: string;
  excerpt: string;
  body: string;
  coverUrl: string;
  coverCredit: string;
  sourceName: string;
  sourceUrl: string;
  locale: string;
  publishedAt: string; // ISO date
};

const cover = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=60`;

const CREDIT = 'Photo: Unsplash';

export const NEWS_ARTICLES: NewsSeed[] = [
  // ---------------------------------------------------------------- CAREER
  {
    slug: 'it-park-residents-tech-hiring-tashkent',
    category: 'CAREER',
    title: 'Tech hiring keeps climbing as IT Park residents multiply',
    excerpt:
      'Resident companies of IT Park Uzbekistan continue to add developers, QA engineers, and product roles - and competition for experienced candidates is heating up in Tashkent and beyond.',
    body: [
      'IT Park Uzbekistan has grown from a handful of resident companies at launch into a national network spanning Tashkent and regional hubs. Residents get significant tax incentives on software exports, which keeps pulling both local startups and foreign service companies into the ecosystem - and each new resident is a new employer.',
      'For job seekers the practical effect is simple: demand for backend and frontend developers, QA engineers, DevOps specialists, and product managers keeps outpacing supply. Mid-level engineers with two to four years of experience are the most contested segment, and English proficiency remains the single biggest salary multiplier because so many residents serve foreign clients.',
      'If you are early in your career, target resident companies that run internal academies or internship-to-hire tracks. They exist precisely because seniors are scarce, and they are the fastest legitimate route from coursework to a production codebase.',
      'Recruiters, meanwhile, should expect counter-offers to become routine for anyone with a proven delivery record. Clear growth paths and remote-friendly policies now matter as much as the base salary figure.',
    ].join('\n\n'),
    coverUrl: cover('photo-1519389950473-47ba0277781c'),
    coverCredit: CREDIT,
    sourceName: 'IT Park Uzbekistan',
    sourceUrl: 'https://it-park.uz',
    locale: 'en',
    publishedAt: '2026-08-06T09:00:00.000Z',
  },
  {
    slug: 'remote-work-uzbek-developers-global-companies',
    category: 'CAREER',
    title: 'Remote-first: how Uzbek developers land global contracts',
    excerpt:
      'Export-oriented incentives, improving connectivity, and a maturing freelance culture are turning remote work for foreign companies into a mainstream career path.',
    body: [
      'A growing share of Uzbek software engineers now work for companies headquartered abroad without leaving home. The export-friendly regime around IT Park residency makes it straightforward for local entities to bill foreign clients, and individual specialists increasingly join global teams through service companies or direct contracts.',
      'The pattern that works: a public portfolio (GitHub plus one or two deployed projects), a focused CV in English, and consistent presence on the platforms where foreign employers actually search. Time-zone overlap with Europe is an underrated advantage - Tashkent mornings align neatly with EU standups.',
      'Compensation for remote roles is typically quoted in foreign currency, which is why remote-capable engineers anchor the top of local salary surveys. The trade-off is higher expectations around autonomous communication: written English, async updates, and honest estimation are screened as hard as algorithms.',
      'Start smaller if you need to: open-source contributions and paid pilot projects convert to long-term contracts far more often than cold applications.',
    ].join('\n\n'),
    coverUrl: cover('photo-1486312338219-ce68d2c6f44d'),
    coverCredit: CREDIT,
    sourceName: 'IT Park Uzbekistan',
    sourceUrl: 'https://it-park.uz',
    locale: 'en',
    publishedAt: '2026-07-28T09:00:00.000Z',
  },
  {
    slug: 'banking-digitalization-fintech-careers',
    category: 'CAREER',
    title: 'Fintech is quietly becoming one of the best-paying career tracks',
    excerpt:
      'Bank digitalization and the boom in mobile payments have created steady demand for product, security, and QA specialists - not just developers.',
    body: [
      'Uzbekistan\'s banks are racing to digitalize retail services, and homegrown payment apps have made cashless payments a daily habit for millions. Behind every wallet feature is a hiring pipeline: mobile developers, product managers, fraud and information-security analysts, QA automation engineers, and compliance specialists.',
      'Fintech employers tend to pay above the market median because mistakes are expensive and regulation is real. They also promote earlier: a QA engineer who understands payment flows end-to-end can reach lead level noticeably faster than in classic outsourcing.',
      'The entry advice is unglamorous but effective. Learn how card processing, P2P transfers, and KYC actually work; read the public documentation of local payment systems; and practice explaining a transaction lifecycle in an interview. Domain knowledge is the differentiator, because pure coding skill is easier to find than payments literacy.',
      'Watch the job boards for roles mentioning ISO 8583, anti-fraud, or mobile SDKs - those teams are usually the ones investing in people for the long term.',
    ].join('\n\n'),
    coverUrl: cover('photo-1556742049-0cfed4f6a45d'),
    coverCredit: CREDIT,
    sourceName: 'UzDaily',
    sourceUrl: 'https://uzdaily.uz',
    locale: 'en',
    publishedAt: '2026-07-15T09:00:00.000Z',
  },
  {
    slug: 'salary-negotiation-uzbekistan-guide',
    category: 'CAREER',
    title: 'How to talk about salary in an Uzbek interview',
    excerpt:
      'Salary conversations are becoming more transparent, but they still follow local norms. A short practical guide to anchoring, ranges, and counter-offers.',
    body: [
      'Salary transparency in Uzbekistan\'s private sector has improved: more vacancies publish ranges, and candidates increasingly ask about total compensation without embarrassment. Still, the negotiation itself follows patterns worth knowing.',
      'First, know the market before the interview, not after. Public salary surveys, community chats, and posted ranges on job boards give you a defensible corridor for your grade and stack. Quoting a number you can justify ("mid-level backend with production Go experience in Tashkent") reads as professionalism, not greed.',
      'Second, let the employer name the range where possible, and negotiate the whole package: probation terms, review timing, remote days, training budget, and bonuses often move more easily than base salary. A guaranteed review after three months with agreed criteria is frequently worth more than a small bump today.',
      'Finally, treat counter-offers with care. Accepting one from your current employer resolves the money question but rarely the reasons you interviewed elsewhere. Whatever you decide, close the loop politely with every company involved - the market is small and recruiters remember.',
    ].join('\n\n'),
    coverUrl: cover('photo-1521737604893-d14cc237f11d'),
    coverCredit: CREDIT,
    sourceName: 'Gazeta.uz',
    sourceUrl: 'https://www.gazeta.uz',
    locale: 'en',
    publishedAt: '2026-06-30T09:00:00.000Z',
  },

  // --------------------------------------------------------------- INSIGHT
  {
    slug: 'labor-market-youth-skills-gap',
    category: 'INSIGHT',
    title: 'Hundreds of thousands of new workers a year: inside the youth labor wave',
    excerpt:
      'Uzbekistan has one of the youngest populations in the region. That is a massive opportunity - and a skills-matching challenge for employers and educators alike.',
    body: [
      'Every year several hundred thousand young Uzbeks enter the labor market, one of the highest inflows in Central Asia. International development institutions consistently flag the same paradox: employers report unfilled vacancies while young graduates report difficulty finding first jobs.',
      'The gap is rarely about diplomas. It concentrates in applied skills - practical IT, technical English, modern sales, and the soft skills of teamwork and written communication. Sectors with structured on-the-job training (IT services, modern retail, logistics) absorb young talent far faster than sectors that expect ready-made specialists.',
      'For job seekers the takeaway is to treat the first job as an apprenticeship: optimize for learning density, not title. For employers, graduate programs and paid internships are no longer nice-to-have branding - they are the only reliable way to secure junior pipelines before competitors do.',
      'Platforms that make skills visible (portfolios, verified certificates, structured assessments) will matter more every year, because the raw volume of candidates makes manual screening impossible.',
    ].join('\n\n'),
    coverUrl: cover('photo-1529156069898-49953e39b3ac'),
    coverCredit: CREDIT,
    sourceName: 'World Bank',
    sourceUrl: 'https://www.worldbank.org',
    locale: 'en',
    publishedAt: '2026-08-02T09:00:00.000Z',
  },
  {
    slug: 'digital-uzbekistan-2030-jobs',
    category: 'INSIGHT',
    title: "What 'Digital Uzbekistan 2030' means for your next job",
    excerpt:
      'The national digitalization strategy is not just about e-government portals. It reshapes which skills are funded, taught, and hired for across the whole economy.',
    body: [
      'The Digital Uzbekistan 2030 strategy set an ambitious direction: digitalize public services, grow the IT sector\'s share of the economy, and push connectivity into every region. Strategies of this size move labor markets, because budgets follow them.',
      'Three hiring effects are already visible. Government and state-linked enterprises need product owners, analysts, and integration engineers who can modernize legacy processes. Telecom and infrastructure players keep hiring network and cloud specialists as coverage expands. And every traditional industry - banking, logistics, retail, agriculture - now runs digital transformation teams that blend domain veterans with young technologists.',
      'For candidates outside Tashkent this is the most important trend: regional IT hubs, digital literacy programs, and remote-friendly public projects are deliberately spreading opportunity beyond the capital.',
      'The strategic skill bets remain stable: data analysis, cybersecurity, cloud operations, and the ability to translate between business language and technical delivery. Those four travel well across any sector the strategy touches.',
    ].join('\n\n'),
    coverUrl: cover('photo-1451187580459-43490279c0fa'),
    coverCredit: CREDIT,
    sourceName: 'Kun.uz',
    sourceUrl: 'https://kun.uz',
    locale: 'en',
    publishedAt: '2026-07-21T09:00:00.000Z',
  },
  {
    slug: 'women-in-tech-uzbekistan',
    category: 'INSIGHT',
    title: "Women are claiming a bigger share of Uzbekistan's tech workforce",
    excerpt:
      'Scholarships, community programs, and visible role models are steadily raising female participation in IT - and employers are competing for the pipeline.',
    body: [
      'Female participation in Uzbekistan\'s IT sector has been rising steadily, supported by dedicated scholarships, coding bootcamps for girls, and community initiatives backed by international organizations. The change is visible at hiring events: teams that were uniformly male five years ago now interview mixed shortlists as standard.',
      'Programs matter, but so does economics. IT offers flexible formats - remote work, part-time contracts, project-based engagement - that fit a wider range of life situations than many traditional careers. QA, business analysis, design, and data roles have become common entry points, with engineering tracks following as confidence and community support grow.',
      'Employers that win this talent do three things consistently: publish salary ranges (which measurably increases female application rates), run structured interviews instead of stress tests, and show real women in senior technical roles rather than stock photos.',
      'The direction of travel is clear, and companies building inclusive pipelines now will simply have more candidates to choose from than those that wait.',
    ].join('\n\n'),
    coverUrl: cover('photo-1573164713988-8665fc963095'),
    coverCredit: CREDIT,
    sourceName: 'UNDP Uzbekistan',
    sourceUrl: 'https://www.undp.org',
    locale: 'en',
    publishedAt: '2026-07-08T09:00:00.000Z',
  },
  {
    slug: 'tashkent-regional-bpo-hub',
    category: 'INSIGHT',
    title: "Tashkent's bid to become Central Asia's outsourcing capital",
    excerpt:
      'Competitive costs, multilingual graduates, and targeted incentives are pulling BPO and IT-service contracts into Uzbekistan. Here is what that means for jobs.',
    body: [
      'Business-process outsourcing is one of the quietest but steadiest job creators in Uzbekistan. Service centers in Tashkent and regional cities handle software development, support, data operations, and back-office work for clients across Europe, the Gulf, and the CIS.',
      'The pitch to foreign clients is straightforward: competitive costs, a large multilingual graduate pool (Uzbek, Russian, English, and increasingly German and Korean), and government incentives aimed at IT service exports - including simplified regimes for foreign specialists and residents.',
      'For candidates, BPO is an underrated launchpad. Support and operations roles teach exactly the process discipline that product companies later pay for, and internal mobility from support to QA to engineering is a well-trodden path. Language skills convert directly into salary here more than in almost any other sector.',
      'The realistic caution: entry-level BPO pay is modest, and shift work is common on global accounts. Treat the first year as paid training, be deliberate about the second.',
    ].join('\n\n'),
    coverUrl: cover('photo-1497366216548-37526070297c'),
    coverCredit: CREDIT,
    sourceName: 'The Tashkent Times',
    sourceUrl: 'https://tashkenttimes.uz',
    locale: 'en',
    publishedAt: '2026-06-24T09:00:00.000Z',
  },

  // ----------------------------------------------------------------- EVENT
  {
    slug: 'ict-week-uzbekistan-tashkent',
    category: 'EVENT',
    title: 'ICT Week returns to Tashkent: what job seekers should actually do there',
    excerpt:
      "Uzbekistan's flagship technology week gathers startups, corporates, and government in one place. Treat it as a hiring event, because employers certainly do.",
    body: [
      'Every autumn, ICT Week turns Tashkent into the region\'s technology meeting point: exhibition halls of resident companies, startup competitions, government digitalization showcases, and side events from every major employer in the sector.',
      'Job seekers routinely underuse it. The booths are staffed not only by marketers but by team leads and CTOs who came to scout - a ten-minute conversation about a real project beats fifty online applications. Bring a short CV, a phone-readable portfolio link, and two or three sharp questions about the company\'s actual stack.',
      'The startup competitions deserve special attention. Teams that just raised or won are hiring within weeks, and they remember the people who approached them before the prize was announced.',
      'If you cannot attend in person, follow the program online: talks are recorded, winner lists are published, and a well-timed follow-up message referencing a specific talk lands noticeably better than a cold one.',
    ].join('\n\n'),
    coverUrl: cover('photo-1540575467063-178a50c2df87'),
    coverCredit: CREDIT,
    sourceName: 'IT Park Uzbekistan',
    sourceUrl: 'https://it-park.uz',
    locale: 'en',
    publishedAt: '2026-08-08T09:00:00.000Z',
  },
  {
    slug: 'regional-job-fairs-employment-ministry',
    category: 'EVENT',
    title: 'Regional job fairs bring thousands of vacancies offline',
    excerpt:
      'State-organized employment fairs run across all regions of Uzbekistan, connecting local employers with candidates in a single day. Preparation makes the difference.',
    body: [
      'Employment fairs organized with local authorities are a fixture across Uzbekistan\'s regions: hundreds of employers, thousands of vacancies, and same-day introductions between candidates and hiring managers - particularly valuable outside Tashkent, where online listings are thinner.',
      'The format rewards preparation. Vacancy lists are usually published in advance; shortlist ten employers, research their pay ranges, and print several CV copies (paper still works at fairs). Dress as you would for a first interview, because on-the-spot interviews are common.',
      'These fairs also concentrate practical services in one place: career counseling points, information on vocational retraining vouchers, and support programs for young specialists and women returning to work.',
      'A realistic strategy is to treat the fair as a first-contact tool. Collect names and phone numbers, send a short follow-up the next morning, and reference the exact conversation - most attendees never follow up, so the few who do stand out immediately.',
    ].join('\n\n'),
    coverUrl: cover('photo-1515187029135-18ee286d815b'),
    coverCredit: CREDIT,
    sourceName: 'Government of Uzbekistan',
    sourceUrl: 'https://gov.uz',
    locale: 'en',
    publishedAt: '2026-07-18T09:00:00.000Z',
  },
  {
    slug: 'startup-demo-days-it-park',
    category: 'EVENT',
    title: 'Demo days are the new recruiting ground for early hires',
    excerpt:
      'Accelerator demo days at IT Park and university incubators are where funded startups meet their first ten employees. Here is how to use them.',
    body: [
      'Accelerator batches, university incubators, and corporate innovation programs all end the same way: a demo day where teams pitch to investors and partners. What the agenda never says is that demo days are also hiring events - every team that raises starts recruiting the same month.',
      'Joining a startup at this stage is a specific trade: lower initial salary and higher chaos in exchange for compressed learning, real ownership, and equity or early-employee upside if things work. It suits people who want three years of experience in one.',
      'Practical approach: attend the pitches, note which teams have revenue or a signed pilot (not just a prototype), and talk to founders after the formal part. Offer a concrete skill for a concrete gap you noticed in their demo - founders remember specificity.',
      'Follow the ecosystem calendars of IT Park and the major universities; most demo days are open, free, and underattended by exactly the candidates who would benefit most.',
    ].join('\n\n'),
    coverUrl: cover('photo-1475721027785-f74eccf877e2'),
    coverCredit: CREDIT,
    sourceName: 'IT Park Uzbekistan',
    sourceUrl: 'https://it-park.uz',
    locale: 'en',
    publishedAt: '2026-06-16T09:00:00.000Z',
  },

  // ------------------------------------------------------------- EDUCATION
  {
    slug: 'it-education-expansion-tuit-schools',
    category: 'EDUCATION',
    title: 'From TUIT to specialized schools: IT education scales up',
    excerpt:
      'University quotas are growing, specialized IT schools are multiplying, and private academies fill the practical gap. A map of the routes into tech.',
    body: [
      'The core of Uzbekistan\'s formal IT education remains the Tashkent University of Information Technologies (TUIT) with its regional branches, joined by a fast-growing layer of specialized schools for gifted students and expanding IT faculties at general universities.',
      'Below the university layer, the private market has matured: coding academies teach job-focused tracks (web development, mobile, data analysis, design) in months rather than years, usually with evening and weekend formats that working students can combine with study or a first job.',
      'Employers in practice hire from all routes. A TUIT diploma signals fundamentals; an academy certificate plus a deployed project signals readiness; the strongest juniors typically combine both. What no route replaces is a portfolio - three finished projects with readable code beat any single credential.',
      'For parents and school students planning ahead: mathematics and English remain the two subjects with the highest career leverage, whatever the eventual specialization.',
    ].join('\n\n'),
    coverUrl: cover('photo-1523240795612-9a054b0db644'),
    coverCredit: CREDIT,
    sourceName: 'Tashkent University of Information Technologies',
    sourceUrl: 'https://tuit.uz',
    locale: 'en',
    publishedAt: '2026-07-25T09:00:00.000Z',
  },
  {
    slug: 'one-million-coders-free-courses',
    category: 'EDUCATION',
    title: 'Free national coding programs are still an open door into IT',
    excerpt:
      'Large-scale initiatives in the spirit of One Million Uzbek Coders keep offering free, self-paced tracks. Employers care about what you built with them.',
    body: [
      'Uzbekistan\'s push for mass digital skills - popularized by the One Million Uzbek Coders initiative and continued through IT Park education programs and regional digital literacy projects - keeps one promise alive: motivated learners can start IT training for free.',
      'The tracks typically cover web development, data analysis, and mobile basics in self-paced online formats with certificates on completion. Quality varies by track, but the price removes every excuse to postpone starting.',
      'The honest employer perspective: a certificate alone rarely gets an interview. A certificate plus a working project built during the course does. Treat each module as material for your portfolio - deploy the exercises, write a README in English, and push everything to a public repository.',
      'Graduates who then join community study groups or find a mentor convert to employment at visibly higher rates. Free education opens the door; consistent practice walks through it.',
    ].join('\n\n'),
    coverUrl: cover('photo-1434030216411-0b793f4b4173'),
    coverCredit: CREDIT,
    sourceName: 'IT Park Uzbekistan',
    sourceUrl: 'https://it-park.uz',
    locale: 'en',
    publishedAt: '2026-07-02T09:00:00.000Z',
  },
  {
    slug: 'international-university-branches-tashkent',
    category: 'EDUCATION',
    title: 'International university branches widen study options at home',
    excerpt:
      'Branch campuses of foreign universities keep opening in Tashkent, offering internationally recognized degrees in tech and business without leaving Uzbekistan.',
    body: [
      'Over the past decade Tashkent has accumulated one of the densest clusters of foreign university branches in Central Asia - campuses from the UK, US, Asia, and the region offering degrees in computer science, business, and engineering with international curricula.',
      'For students the calculus is practical: tuition below study-abroad costs, an English-language environment, and diplomas that employers recognize both locally and internationally. Many programs schedule evening or hybrid formats, which is why a growing share of students work part-time in IT from the second year.',
      'Employers report a consistent pattern: branch-campus graduates stand out in English and presentation skills, while strong technical depth still correlates with personal projects rather than the institution\'s name. The ideal CV combines both signals.',
      'Before enrolling, check three things: the accreditation of the specific program, where last year\'s graduates actually work, and whether the campus has an active career center with employer partnerships - the answer varies more than the brochures suggest.',
    ].join('\n\n'),
    coverUrl: cover('photo-1503676260728-1c00da094a0b'),
    coverCredit: CREDIT,
    sourceName: 'The Tashkent Times',
    sourceUrl: 'https://tashkenttimes.uz',
    locale: 'en',
    publishedAt: '2026-06-10T09:00:00.000Z',
  },
];
