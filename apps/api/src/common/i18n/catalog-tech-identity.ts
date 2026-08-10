/**
 * Decides whether a catalog label is a technology or brand identity, which reads
 * the same in Uzbek, Russian and English ("React", "C++", "PostgreSQL"), or an
 * ordinary phrase that a reader expects in their own language ("Sales Manager",
 * "Paid vacation").
 *
 * The cost of the two mistakes is asymmetric: a phrase wrongly marked as tech
 * silently stays English, while a brand wrongly queued only costs an admin one
 * click. So anything ambiguous is treated as ordinary language.
 */

const CYRILLIC = /[\u0400-\u04FF]/;

/** Uzbek-specific letter pairs; English and product names never contain them. */
const UZBEK_MARKERS = /(o['\u2018\u2019]|g['\u2018\u2019])/i;

/** Punctuation that only shows up in product names: C++, C#, Node.js, CI/CD. */
const TECH_PUNCTUATION = /[+#]|\.(js|ts|net|io|ai|sh)\b|\//i;

/** Version or release suffixes: "Java 17", "HTML5", "Vue 3". */
const VERSIONED = /^[a-z][a-z.+#-]*\s?\d{1,4}(\.\d+)*$/i;

/**
 * Everyday words that appear in skills and job titles. One of these anywhere in
 * the label means a reader in another language deserves a translation, even when
 * the rest looks like a product name ("Excel reporting" is still a phrase).
 */
const NATURAL_WORDS = new Set([
  'accounting', 'administration', 'administrative', 'advertising', 'analysis',
  'analyst', 'analytics', 'and', 'architect', 'assistant', 'associate', 'audit',
  'banking', 'bonus', 'brand', 'budget', 'business', 'care', 'career', 'cashier',
  'chef', 'chief', 'cleaning', 'client', 'clients', 'communication',
  'communications', 'construction', 'consultant', 'consulting', 'content',
  'contract', 'cook', 'coordinator', 'copywriter', 'creative', 'customer',
  'data', 'delivery', 'dentist', 'design', 'designer', 'developer',
  'development', 'digital', 'director', 'discount', 'doctor', 'driver',
  'economist', 'editor', 'education', 'electrician', 'engineer', 'engineering',
  'english', 'equipment', 'estate', 'event', 'executive', 'expert', 'finance',
  'financial', 'food', 'for', 'foreign', 'free', 'gym', 'head', 'health',
  'help', 'hotel', 'hours', 'human', 'industrial', 'insurance', 'internal',
  'international', 'internship', 'inventory', 'journalist', 'junior', 'key',
  'knowledge', 'language', 'lawyer', 'lead', 'leadership', 'learning', 'leave',
  'legal', 'lessons', 'level', 'logistics', 'maintenance', 'management',
  'manager', 'managing', 'marketing', 'meal', 'meals', 'mechanic', 'media',
  'medical', 'meeting', 'negotiation', 'negotiations', 'nurse', 'office',
  'officer', 'operator', 'operations', 'organization', 'packaging', 'paid',
  'partner', 'payment', 'people', 'performance', 'personal', 'pharmacist',
  'photographer', 'planning', 'presentation', 'pricing', 'process',
  'procurement', 'product', 'production', 'professional', 'programme',
  'programming', 'project', 'promotion', 'property', 'psychologist', 'public',
  'purchasing', 'quality', 'real', 'recruiter', 'recruitment', 'relations',
  'remote', 'reporting', 'reports', 'research', 'resources', 'restaurant',
  'retail', 'risk', 'safety', 'salary', 'sales', 'school', 'science',
  'secretary', 'security', 'senior', 'service', 'services', 'shift', 'skills',
  'social', 'solving', 'specialist', 'staff', 'strategy', 'supervisor',
  'supply', 'support', 'system', 'systems', 'teacher', 'teaching', 'team',
  'technician', 'technology', 'telephone', 'test', 'testing', 'thinking',
  'time', 'trade', 'trainer', 'training', 'translation', 'translator',
  'transport', 'travel', 'tutor', 'vacation', 'waiter', 'warehouse', 'web',
  'with', 'work', 'worker', 'writing',
]);

/**
 * Product names spelled as plain lowercase words, which nothing else in the
 * checks below can recognise. Names carrying their own signal (TypeScript,
 * PostgreSQL, C++, HTML5) do not need to be listed.
 */
const KNOWN_TECH = new Set([
  'android', 'angular', 'ansible', 'astro', 'azure', 'bitrix', 'confluence',
  'cypress', 'dart', 'django', 'docker', 'elasticsearch', 'excel', 'express',
  'fastapi', 'figma', 'firebase', 'flask', 'flutter', 'git', 'github',
  'gitlab', 'go', 'golang', 'grafana', 'hibernate', 'illustrator', 'java',
  'jenkins', 'jira', 'kafka', 'kotlin', 'kubernetes', 'laravel', 'linux',
  'magento', 'nginx', 'notion', 'numpy', 'nuxt', 'pandas', 'photoshop',
  'postman', 'powerpoint', 'prometheus', 'pytorch', 'python', 'rabbitmq',
  'react', 'redis', 'ruby', 'rust', 'sap', 'selenium', 'sketch', 'spring',
  'svelte', 'swift', 'symfony', 'tableau', 'terraform', 'trello', 'ubuntu',
  'unity', 'vue', 'windows', 'wordpress', 'zoom',
]);

const MAX_TECH_TOKENS = 2;

function tokenize(label: string): string[] {
  return label
    .split(/[\s_-]+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
}

/**
 * A token only counts as a product when it says so itself: an internal capital
 * (TypeScript, PostgreSQL), a digit, or a place in the known list. Unknown plain
 * words stay ambiguous, because "Sotuv" looks exactly like "Svelte" to a regex.
 */
function looksLikeProduct(token: string): boolean {
  if (KNOWN_TECH.has(token.toLowerCase())) return true;
  if (/\d/.test(token)) return true;
  return /^.[a-z]*[A-Z]/.test(token);
}

export function isCatalogTechIdentity(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return false;

  // Text already written in Russian or Uzbek is language, not an identity.
  if (CYRILLIC.test(trimmed) || UZBEK_MARKERS.test(trimmed)) return false;

  const tokens = tokenize(trimmed);
  if (!tokens.length) return false;

  const lowered = tokens.map((token) => token.toLowerCase());
  if (lowered.some((token) => NATURAL_WORDS.has(token) && !KNOWN_TECH.has(token))) {
    return false;
  }
  if (lowered.every((token) => KNOWN_TECH.has(token))) return true;

  if (TECH_PUNCTUATION.test(trimmed)) return true;
  if (VERSIONED.test(trimmed)) return true;

  // Acronyms such as SQL, AWS, SEO, HR.
  if (/^[A-Z0-9]{2,6}$/.test(trimmed)) return true;

  if (tokens.length > MAX_TECH_TOKENS) return false;
  return tokens.some(looksLikeProduct);
}

/** Status a newly created catalog row should start in. */
export function initialCatalogStatus(label: string): 'PENDING' | 'IGNORED' {
  return isCatalogTechIdentity(label) ? 'IGNORED' : 'PENDING';
}
