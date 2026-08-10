import { isCatalogTechIdentity } from './catalog-tech-identity';

/** Labels that read the same in every language and should skip the review queue. */
const TECH = [
  'React',
  'TypeScript',
  'C++',
  'C#',
  'Node.js',
  'PostgreSQL',
  'Kubernetes',
  'CI/CD',
  'SQL',
  'AWS',
  'SEO',
  'HTML5',
  'Java 17',
  'React Native',
  'Spring Boot',
  'Figma',
  // Plain lowercase product names, the case the seeded catalog exposed.
  'Angular',
  'Cypress',
  'Go',
  'Java',
  'Selenium',
];

/** Ordinary phrases a reader expects in their own language. */
const NATURAL = [
  'Sales Manager',
  'Accounting',
  'Paid vacation',
  'Health insurance',
  'Customer Support Specialist',
  'Project Management',
  'Team leadership',
  'Excel reporting',
  'Sotuv menejeri',
  "O'qituvchi",
  'Менеджер по продажам',
  'Remote work',
  'Business Analyst',
];

let failed = 0;

for (const label of TECH) {
  if (!isCatalogTechIdentity(label)) {
    console.error(`expected tech identity: ${label}`);
    failed += 1;
  }
}

for (const label of NATURAL) {
  if (isCatalogTechIdentity(label)) {
    console.error(`expected natural language: ${label}`);
    failed += 1;
  }
}

if (failed) {
  process.exit(1);
}
console.log('api: catalog tech identity smoke ok');
