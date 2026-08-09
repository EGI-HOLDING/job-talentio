/**
 * Restore recruiter dashboard from pre-corruption commit and re-apply
 * Find-talent removal + tab URL sync (UTF-8 safe).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'apps/web/src/app/dashboard/recruiter/page.tsx');
let src = execSync('git show 621bc88:apps/web/src/app/dashboard/recruiter/page.tsx', {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});

// --- imports ---
src = src.replace(
  `import { FilterFieldset, FormAlert, LabelText } from '@/components/ui/Field';
import { NumberInput } from '@/components/ui/NumberInput';
import { ExpandableList } from '@/components/ui/ExpandableList';
import { AdvancedFiltersPanel } from '@/components/ui/AdvancedFiltersPanel';
import { SkillCombobox } from '@/components/ui/SkillCombobox';
import { LookupCombobox } from '@/components/ui/LookupCombobox';
import { JobTitleInput } from '@/components/ui/JobTitleInput';
import { CandidateListSkeleton } from '@/components/ui/Skeleton';
import { Pagination } from '@/components/ui/Pagination';
import { MatchRing } from '@/components/ui/MatchRing';
import { BulkCommsPanel } from '@/components/bulk/BulkCommsPanel';`,
  `import { FormAlert, LabelText } from '@/components/ui/Field';
import { NumberInput } from '@/components/ui/NumberInput';
import { SkillCombobox } from '@/components/ui/SkillCombobox';
import { LookupCombobox } from '@/components/ui/LookupCombobox';
import { JobTitleInput } from '@/components/ui/JobTitleInput';
import { MatchRing } from '@/components/ui/MatchRing';
import { BulkCommsPanel } from '@/components/bulk/BulkCommsPanel';`,
);

src = src.replace(
  `type Tab = 'jobs' | 'pipeline' | 'candidates' | 'bulk' | 'analytics' | 'billing' | 'company';`,
  `type Tab = 'jobs' | 'pipeline' | 'bulk' | 'analytics' | 'billing' | 'company';`,
);

// Remove CandFilters helpers
src = src.replace(
  /const CAND_PAGE_SIZES[\s\S]*?function toggleCsv\(csv: string, value: string\) \{\n  const set = new Set\(csv\.split\(','\)\.map\(\(s\) => s\.trim\(\)\)\.filter\(Boolean\)\);\n  if \(set\.has\(value\)\) set\.delete\(value\);\n  else set\.add\(value\);\n  return Array\.from\(set\)\.join\(',',\);\n\}\n\n/,
  '',
);

// Use ASCII separator in jobSelectLabel (encoding-safe)
src = src.replace(
  'return `${j.title} — ${location}${status}`;',
  "return `${j.title} - ${location}${status}`;",
);

// Tab init
src = src.replace(
  `  const jobFromUrl = searchParams.get('job') || '';
  const tabFromUrl = searchParams.get('tab') || '';
  const [tab, setTab] = useState<Tab>(() => {
    if (tabFromUrl === 'billing') return 'billing';
    if (jobFromUrl) return 'pipeline';
    return 'jobs';
  });`,
  `  const jobFromUrl = searchParams.get('job') || '';
  const tabFromUrl = searchParams.get('tab') || '';
  const focusFromUrl = searchParams.get('focus') || '';
  const [tab, setTab] = useState<Tab>(() => {
    if (tabFromUrl === 'candidates') return 'jobs';
    if (
      tabFromUrl === 'billing' ||
      tabFromUrl === 'pipeline' ||
      tabFromUrl === 'bulk' ||
      tabFromUrl === 'analytics' ||
      tabFromUrl === 'company' ||
      tabFromUrl === 'jobs'
    ) {
      return tabFromUrl as Tab;
    }
    if (jobFromUrl) return 'pipeline';
    return 'jobs';
  });`,
);

// Remove candidates state
src = src.replace(
  `  const [candidates, setCandidates] = useState<any>(null);
  const [candFilters, setCandFilters] = useState<CandFilters>(DEFAULT_CAND_FILTERS);
  const [candLoading, setCandLoading] = useState(false);
  const [skillQ, setSkillQ] = useState('');
  const [draftJobSkills, setDraftJobSkills] = useState<Array<{ slug: string; name: string }>>([]);`,
  `  const [draftJobSkills, setDraftJobSkills] = useState<Array<{ slug: string; name: string }>>([]);`,
);

// Remove applyCand
src = src.replace(
  /  function applyCand\(patch: Partial<CandFilters>\) \{[\s\S]*?\n  \}\n\n  async function bootstrap/,
  '  async function bootstrap',
);

// Remove fetchCandidates + effects + facet memos before return
src = src.replace(
  /  async function fetchCandidates\(f: CandFilters = candFilters\) \{[\s\S]*?const candTotalPages =\n    candidates\?\.totalPages \|\| Math\.max\(1, Math\.ceil\(\(candidates\?\.total \|\| 0\) \/ candFilters\.limit\)\);\n\n  return \(/,
  `  const byStage = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const s of STAGES) map[s] = [];
    for (const a of applicants) {
      (map[a.status] || (map[a.status] = [])).push(a);
    }
    return map;
  }, [applicants]);

  return (`,
);

// If byStage was duplicated, collapse later — first remove old byStage if still preceding fetch
src = src.replace(
  /  const byStage = useMemo\(\(\) => \{[\s\S]*?\}, \[applicants\]\);\n\n  const byStage = useMemo/,
  '  const byStage = useMemo',
);

// Nav tabs
src = src.replace(
  `            ['jobs', 'Jobs'],
            ['pipeline', 'Pipeline & match'],
            ['candidates', 'Find talent'],
            ['bulk', 'Bulk comms'],`,
  `            ['jobs', 'Jobs'],
            ['pipeline', 'Pipeline & match'],
            ['bulk', 'Bulk comms'],`,
);

// Remove candidates UI block
src = src.replace(
  /\n        \{tab === 'candidates' && \([\s\S]*?\n        \)\}(\n\n        \{tab === 'bulk')/,
  '$1',
);

// tabFromUrl effect + focus
src = src.replace(
  `  useEffect(() => {
    if (tabFromUrl === 'billing') setTab('billing');
  }, [tabFromUrl]);`,
  `  useEffect(() => {
    if (tabFromUrl === 'candidates') {
      window.location.replace('/talent');
      return;
    }
    if (
      tabFromUrl === 'billing' ||
      tabFromUrl === 'pipeline' ||
      tabFromUrl === 'bulk' ||
      tabFromUrl === 'analytics' ||
      tabFromUrl === 'company' ||
      tabFromUrl === 'jobs'
    ) {
      setTab(tabFromUrl as Tab);
    }
  }, [tabFromUrl]);

  useEffect(() => {
    if (tab === 'jobs' && focusFromUrl === 'create') {
      document.getElementById('create-job-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [tab, focusFromUrl]);`,
);

// create job card id
src = src.replace(
  `<div className="card">
              <h3>Create job</h3>`,
  `<div className="card" id="create-job-form">
              <h3>Create job</h3>`,
);

// Replace remaining unicode dashes/ellipsis in UI strings with ASCII-safe variants for this file
src = src
  .replace(/\u2014/g, '-')
  .replace(/\u2013/g, '-')
  .replace(/\u2026/g, '...')
  .replace(/\u00d7/g, 'x');

fs.writeFileSync(out, src, { encoding: 'utf8' });
console.log('Wrote', out, 'bytes', Buffer.byteLength(src, 'utf8'));
console.log('has candidates tab string', src.includes("['candidates'"));
console.log('has Find talent nav', src.includes("'Find talent'"));
console.log('has mojibake', src.includes('â€'));
console.log('has create-job-form', src.includes('create-job-form'));
