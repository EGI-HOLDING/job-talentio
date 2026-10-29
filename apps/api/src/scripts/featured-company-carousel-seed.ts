/**
 * Opt-in seed for the 21 fictional Indonesian homepage companies.
 * Never imported by application startup or the shared Prisma seed.
 *
 * Commands:
 *   seed:featured-companies dry-run [--target local|indonesia-vps]
 *   seed:featured-companies apply --target ... --manifest-hash ... --expected-fingerprint ...
 *   seed:featured-companies verify [--target local|indonesia-vps]
 *
 * `apply` requires FEATURED_COMPANY_SEED_PASSWORD in the environment when new
 * recruiter accounts need to be created. Secret values are never printed.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import {
  CompanySize,
  ExperienceLevel,
  JobPackageCode,
  JobStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import type { AuthUser } from '../common/auth.decorators';
import { contentHash, jobFingerprint } from '../common/dedupe';
import {
  FEATURED_COMPANIES,
  FEATURED_COMPANY_CAROUSEL_VERSION,
  FEATURED_PACKAGES,
  type FeaturedCompany,
  type FeaturedRole,
} from './featured-company-carousel-manifest';
import {
  assertFeaturedCompanySeedTarget,
  type ResolvedFeaturedCompanySeedTarget,
} from './featured-company-seed-target';

const ORIGINAL_COMPANY_NAMES = ['Arunika Dataworks', 'Lintas Awan Teknologi', 'Nusarintis Digital'];
const SEED_PREFIX = `featured-carousel-v${FEATURED_COMPANY_CAROUSEL_VERSION}`;
const FREE_PLAN_CODE: JobPackageCode = 'FREE';

type ResolvedCatalog = {
  cities: Map<string, { id: string; name: string; countryId: string }>;
  industries: Map<string, { id: string; slug: string; name: string }>;
  skillsByJob: Map<string, Array<{ id: string; name: string }>>;
  usedSkills: Array<{ id: string; name: string; slug: string; normalizedKey: string | null }>;
  skillAliases: Array<{ id: string; skillId: string; aliasKey: string }>;
  policies: Map<JobPackageCode, { version: number; settings: Prisma.JsonValue }>;
  superAdmin: { id: string; email: string | null; role: 'SUPER_ADMIN'; isBanned: false; fullName: string };
};

function stable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function hashValue(value: unknown) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function normalKey(value: string) {
  return value.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
}

function skillSlug(value: string) {
  return value.trim().toLowerCase().replace(/c\+\+/g, 'cplusplus').replace(/c#/g, 'csharp')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}

// Curated Indonesian seed labels mapped to canonical skills already present in the
// VPS catalog. These are lookup aliases only: they never create or edit catalog rows.
const SKILL_CATALOG_EQUIVALENTS: Record<string, string> = {
  komunikasi: 'Communication',
  kerjatim: 'Teamwork',
  microsoftexcel: 'Excel',
  pemecahanmasalah: 'Problem Solving',
  manajemenwaktu: 'Planning',
  supervisiproduksi: 'Operations Management',
  manajemenoperasional: 'Operations Management',
  keamananpangan: 'Food Safety',
  haccp: 'Food Safety',
  pengadaan: 'Supply Chain',
  manajemenrantaipasok: 'Supply Chain',
  negosiasi: 'Negotiation',
  evaluasipemasok: 'Supply Chain',
  operasiritel: 'Retail Operations',
  layananpelanggan: 'Customer Support',
  manajemenpersediaan: 'Inventory Management',
  supervisitim: 'Team Leadership',
  merchandising: 'Retail Operations',
  perencanaanpenjualan: 'Sales',
  analisispenjualan: 'Data Analysis',
  penjualan: 'Sales',
  manajemenarea: 'Operations Management',
  coaching: 'Leadership',
  manajemenrestoran: 'Hospitality Management',
  hospitality: 'Hospitality Management',
  operasidapur: 'Operations Management',
  perencanaanproduksi: 'Operations Management',
  kepemimpinan: 'Leadership',
  koordinasiacara: 'Project Management',
  perencanaan: 'Planning',
  kemitraan: 'Customer Relationship Management',
  komunikasilapangan: 'Communication',
  pascapanen: 'Supply Chain',
  keperawatan: 'Nursing',
  perawatanpasien: 'Patient Care',
  keselamatanpasien: 'Patient Care',
  pencegahaninfeksi: 'Nursing',
  layananpasien: 'Patient Care',
  farmasi: 'Pharmacy',
  pelayanankefarmasian: 'Pharmacy',
  pengembangankurikulum: 'Curriculum Design',
  desainpembelajaran: 'Curriculum Design',
  evaluasipendidikan: 'Data Analysis',
  fasilitasi: 'Communication',
  mengajar: 'Teaching',
  pengelolaankelas: 'Teaching',
  pendidikandasar: 'Teaching',
  komunikasidenganorangtua: 'Communication',
  konselingpendidikan: 'Communication',
  penerimaansiswa: 'Customer Support',
  administrasipendidikan: 'Excel',
  operasiarmada: 'Logistics',
  logistik: 'Logistics',
  perencanaanrute: 'Logistics',
  manajemengudang: 'Inventory Management',
  koordinasipengiriman: 'Logistics',
  manufaktur: 'Operations Management',
  gambarteknik: 'AutoCAD',
  pelatihan: 'Teaching',
  manajemenproyek: 'Project Management',
  manajemenkontraktor: 'Project Management',
  pemeliharaanfasilitas: 'Operations Management',
  tekniklistrik: 'Electrical Engineering',
  hubungmasyarakat: 'Communication',
  fasilitasikomunitas: 'Communication',
  manajemenpemangkukepentingan: 'Project Management',
  penjualanproperti: 'Sales',
  administrasipenjualan: 'Excel',
  manajemenproperti: 'Operations Management',
  operasifasilitas: 'Operations Management',
  manajemenvendor: 'Project Management',
  layananpenghuni: 'Customer Support',
  pengelolaandokumen: 'Excel',
  manajemenjadwal: 'Planning',
  manajemenrelasinasabah: 'Customer Relationship Management',
  pembiayaanusaha: 'Financial Analysis',
  analisiskredit: 'Financial Analysis',
  analisiskeuangan: 'Financial Analysis',
  auditinternal: 'Accounting',
  produksitekstil: 'Operations Management',
  kemitraanperajin: 'Customer Relationship Management',
  pembuatanpola: 'desain',
  konstruksibusana: 'desain',
  produksigarmen: 'Operations Management',
  penjualanekspor: 'Sales',
  administrasiekspor: 'Excel',
  operasiresepsionis: 'Hospitality Management',
  layanantamu: 'Customer Support',
  manajemenreservasi: 'Hospitality Management',
  operasiwisata: 'Hospitality Management',
  perencanaanperjalanan: 'Planning',
  manajemenmitra: 'Customer Relationship Management',
  pengalamantamu: 'Hospitality Management',
  pariwisata: 'Hospitality Management',
  perencanaanpermintaan: 'Planning',
  distribusi: 'Logistics',
  perencanaanpasokan: 'Supply Chain',
  rantaidingin: 'Supply Chain',
  manajemenakun: 'Customer Relationship Management',
  penjualanb2b: 'Sales',
  kemitraannelayan: 'Customer Relationship Management',
  mutuhasillaut: 'Food Safety',
  pendidikananakusiadini: 'Teaching',
  manajemenpusat: 'Operations Management',
  komunikasidengankeluarga: 'Communication',
  kemitraankeluarga: 'Customer Relationship Management',
  farmasiindustri: 'Pharmacy',
  manufakturfarmasi: 'Operations Management',
  farmakovigilans: 'Clinical Research',
  keamananobat: 'Pharmacy',
  urusanregulatori: 'Contract Law',
  energisurya: 'Electrical Engineering',
  instalasilistrik: 'Electrical Engineering',
  supervisilapangan: 'Operations Management',
  pemberdayaankomunitas: 'Communication',
  edukasipublik: 'Teaching',
  produkkriya: 'desain',
  pengemasan: 'Operations Management',
  administrasipesanan: 'Excel',
  pemeliharaanarmada: 'Logistics',
  perencanaanpemeliharaan: 'Planning',
  otomotif: 'Mechanical Design',
  layananotomotif: 'Customer Support',
  manajemenkeluhan: 'Customer Support',
  penjualanarmada: 'Sales',
  operasiperkebunan: 'Operations Management',
  agribisnis: 'Supply Chain',
  penangananhasilpertanian: 'Supply Chain',
};

function companyId(company: FeaturedCompany) { return `${SEED_PREFIX}-company-${company.slug}`; }
function userId(company: FeaturedCompany) { return `${SEED_PREFIX}-user-${company.slug}`; }
function userEmail(company: FeaturedCompany) { return `hr-${company.slug}@example.test`; }
function jobId(company: FeaturedCompany, index: number) {
  return `${SEED_PREFIX}-job-${company.slug}-${FEATURED_PACKAGES[index].toLowerCase()}`;
}

function descriptionFor(company: FeaturedCompany, role: FeaturedRole) {
  const [minimum, maximum] = role.salary;
  return [
    `Tentang tim dan konteks kerja\n${company.workContext} ${company.description}`,
    `Tujuan jabatan\nSebagai ${role.title}, Anda akan ${role.mission} Keputusan dan hasil kerja Anda dibahas bersama atasan langsung agar standar keselamatan, mutu, dan layanan tetap terjaga.`,
    `Tanggung jawab utama\n${role.duties.map((item) => `• ${item}`).join('\n')}`,
    `Persyaratan wajib\n${role.requirements.map((item) => `• ${item}`).join('\n')}`,
    `Nilai tambah\n${role.preferred.map((item) => `• ${item}`).join('\n')}`,
    `Kompensasi dan cara kerja\nPosisi ini adalah pekerjaan penuh waktu, bekerja langsung dari ${company.cityName.replace(/^Kota Administrasi /, '').replace(/^Kota /, '')}. Kisaran gaji yang ditawarkan adalah Rp${minimum.toLocaleString('id-ID')}–Rp${maximum.toLocaleString('id-ID')} bruto per bulan; penempatan akhir mengikuti pengalaman serta tanggung jawab kandidat. Fasilitas mencakup BPJS sesuai ketentuan, THR, cuti tahunan, orientasi kerja, dan dukungan pengembangan sesuai kebijakan perusahaan. Rincian tertulis akan disampaikan sebelum kandidat mengambil keputusan menerima penawaran.`,
    `Proses seleksi\nSeleksi terdiri dari peninjauan lamaran, percakapan awal dengan HR, wawancara bersama calon atasan, dan pembahasan ruang lingkup serta kompensasi. Kami mengabari kandidat mengenai tahapan berikutnya melalui email. Perusahaan ini adalah contoh fiktif untuk demonstrasi produk; tidak ada biaya yang diminta kepada pelamar.`,
  ].join('\n\n');
}

function validateManifest(checkLocalLogos = true) {
  if (FEATURED_COMPANIES.length !== 21) throw new Error(`Manifest must contain exactly 21 companies; found ${FEATURED_COMPANIES.length}`);
  const slugs = new Set<string>();
  const emails = new Set<string>();
  let jobs = 0;
  for (const company of FEATURED_COMPANIES) {
    if (slugs.has(company.slug)) throw new Error(`Duplicate company slug: ${company.slug}`);
    slugs.add(company.slug);
    const email = userEmail(company);
    if (emails.has(email)) throw new Error(`Duplicate recruiter email in manifest: ${email}`);
    emails.add(email);
    if (!company.description.toLowerCase().includes('fiktif')) throw new Error(`Company must be identified as fictional: ${company.slug}`);
    if (checkLocalLogos) {
      const logoPath = path.resolve(__dirname, '../../../../apps/web/public/images/featured-companies', `${company.slug}.svg`);
      if (!fs.existsSync(logoPath)) throw new Error(`Local SVG logo is missing for ${company.slug}`);
    }
    if (company.roles.length !== 3) throw new Error(`Each company must have three job posts: ${company.slug}`);
    for (const role of company.roles) {
      jobs += 1;
      if (role.skills.length < 5) throw new Error(`At least five catalog skill candidates required for ${company.slug}/${role.title}`);
      if (role.questions.length !== 2) throw new Error(`Exactly two screening questions required for ${company.slug}/${role.title}`);
      if (role.salary[0] <= 0 || role.salary[1] < role.salary[0]) throw new Error(`Invalid monthly IDR salary for ${role.title}`);
      if (descriptionFor(company, role).split(/\s+/).filter(Boolean).length < 110) throw new Error(`Job description is too short for ${role.title}`);
      if (/\b(software|developer|programmer|artificial intelligence|machine learning|web developer|it support|system administrator)\b/i.test(role.title)) {
        throw new Error(`IT position is not allowed in this manifest: ${role.title}`);
      }
    }
  }
  if (jobs !== 63) throw new Error(`Manifest must contain exactly 63 jobs; found ${jobs}`);
  const fingerprints = new Set<string>();
  for (const company of FEATURED_COMPANIES) {
    for (const role of company.roles) {
      const fingerprint = contentHash(descriptionFor(company, role));
      if (fingerprints.has(fingerprint)) throw new Error(`Duplicate job description found for ${role.title}`);
      fingerprints.add(fingerprint);
    }
  }
  return { companies: FEATURED_COMPANIES.length, jobs };
}

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const rootEnv = path.resolve(__dirname, '../../../../.env');
  if (!fs.existsSync(rootEnv)) throw new Error('DATABASE_URL is not set and the workspace .env file is missing');
  const content = fs.readFileSync(rootEnv, 'utf8');
  const match = content.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/m);
  if (!match) throw new Error('DATABASE_URL is missing from the workspace .env file');
  const value = match[1].trim().replace(/^(["'])(.*)\1$/, '$2');
  process.env.DATABASE_URL = value;
  return value;
}

async function verifyVpsLogoAssets() {
  const origin = 'https://cari-kerja.co.id';
  const results = await Promise.all(FEATURED_COMPANIES.map(async (company) => {
    const url = `${origin}/images/featured-companies/${encodeURIComponent(company.slug)}.svg`;
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    const body = await response.text();
    if (!response.ok || body.length > 500_000 || !/<svg\b/i.test(body)) {
      throw new Error(`Published company logo is unavailable or invalid: ${company.slug} (HTTP ${response.status})`);
    }
    return company.slug;
  }));
  if (results.length !== 21) throw new Error('All 21 published company logos must be verified before the VPS seed');
}

function targetFingerprintCompanyIds() {
  return FEATURED_COMPANIES.map(companyId);
}

async function resolveCatalog(db: PrismaClient): Promise<ResolvedCatalog> {
  const cityNames = [...new Set(FEATURED_COMPANIES.map((company) => company.cityName))];
  const industrySlugs = [...new Set(FEATURED_COMPANIES.map((company) => company.industrySlug))];
  const skillLabels = [...new Set(FEATURED_COMPANIES.flatMap((company) => company.roles.flatMap((role) => role.skills)))];
  const catalogSkillLabels = [...new Set(skillLabels.flatMap((label) => [label, SKILL_CATALOG_EQUIVALENTS[normalKey(label)] ?? label]))];
  const skillKeys = catalogSkillLabels.map(normalKey);
  const skillSlugs = catalogSkillLabels.map(skillSlug);

  const cityRows = await db.city.findMany({
    where: {
      archivedAt: null,
      // Prefix candidates include catalog labels with accidental surrounding whitespace;
      // the exact trimmed comparison below remains the only accepted identity match.
      OR: [
        { name: { in: cityNames } },
        { nameId: { in: cityNames } },
        ...cityNames.flatMap((name) => [{ name: { startsWith: name } }, { nameId: { startsWith: name } }]),
      ],
      province: { archivedAt: null, country: { iso2: 'ID', isActive: true, archivedAt: null } },
    },
    include: { province: { select: { countryId: true, country: { select: { iso2: true } } } } },
  });
  const cities = new Map<string, { id: string; name: string; countryId: string }>();
  for (const name of cityNames) {
    const matches = cityRows.filter((row) => row.name.trim() === name || row.nameId?.trim() === name);
    if (matches.length !== 1) throw new Error(`City catalog must contain exactly one active Indonesian match for "${name}"; found ${matches.length}`);
    if (matches[0].province.country.iso2 !== 'ID') throw new Error(`City is outside Indonesia: ${name}`);
    cities.set(name, { id: matches[0].id, name, countryId: matches[0].province.countryId });
  }

  const industryRows = await db.industry.findMany({
    where: { slug: { in: industrySlugs }, archivedAt: null },
    select: { id: true, slug: true, name: true },
  });
  const industries = new Map(industryRows.map((row) => [row.slug, row]));
  const missingIndustries = industrySlugs.filter((slug) => !industries.has(slug));
  if (missingIndustries.length) throw new Error(`Required active industry catalog entries are missing: ${missingIndustries.join(', ')}`);
  if (industryRows.some((row) => ['it', 'information-technology', 'software'].includes(row.slug))) {
    throw new Error('IT industry is not allowed for the Indonesian showcase seed');
  }

  const skillRows = await db.skill.findMany({
    where: {
      archivedAt: null,
      OR: [
        { name: { in: catalogSkillLabels, mode: 'insensitive' } },
        { slug: { in: skillSlugs } },
        { normalizedKey: { in: skillKeys } },
      ],
    },
    select: { id: true, name: true, slug: true, normalizedKey: true },
  });
  const aliasRows = await db.skillAlias.findMany({
    where: { aliasKey: { in: skillKeys }, skill: { archivedAt: null } },
    select: { id: true, skillId: true, aliasKey: true, skill: { select: { id: true, name: true, slug: true, normalizedKey: true } } },
  });
  const skillsByJob = new Map<string, Array<{ id: string; name: string }>>();
  const selectedSkillIds = new Set<string>();
  const missingByJob: string[] = [];
  for (const company of FEATURED_COMPANIES) {
    for (let index = 0; index < company.roles.length; index += 1) {
      const role = company.roles[index];
      const picked: Array<{ id: string; name: string }> = [];
      const pickedIds = new Set<string>();
      for (const label of role.skills) {
        const catalogLabel = SKILL_CATALOG_EQUIVALENTS[normalKey(label)] ?? label;
        const key = normalKey(catalogLabel);
        const slug = skillSlug(catalogLabel);
        const exactRows = [
          ...skillRows.filter((skill) => skill.slug === slug || skill.normalizedKey === key || normalKey(skill.name) === key),
          ...aliasRows.filter((alias) => alias.aliasKey === key).map((alias) => alias.skill),
        ];
        const matches = [...new Map(exactRows.map((row) => [row.id, row])).values()];
        if (matches.length > 1) throw new Error(`Ambiguous skill catalog match for "${label}"; no fuzzy match was attempted`);
        const row = matches[0];
        if (row && !pickedIds.has(row.id)) {
          picked.push({ id: row.id, name: row.name });
          pickedIds.add(row.id);
          selectedSkillIds.add(row.id);
        }
        if (picked.length === 8) break;
      }
      if (picked.length < 5) missingByJob.push(`${company.slug}/${role.title}: ${picked.length} catalog skills resolved`);
      skillsByJob.set(jobId(company, index), picked);
    }
  }
  if (missingByJob.length) throw new Error(`Each job needs 5–8 existing active catalog skills:\n${missingByJob.join('\n')}`);

  const skillRowsById = new Map([...skillRows, ...aliasRows.map((alias) => alias.skill)].map((row) => [row.id, row]));
  const usedSkills = [...selectedSkillIds].map((id) => skillRowsById.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const skillAliases = aliasRows.filter((row) => selectedSkillIds.has(row.skillId)).map(({ id, skillId, aliasKey }) => ({ id, skillId, aliasKey }));
  const policies = new Map<JobPackageCode, { version: number; settings: Prisma.JsonValue }>();
  for (const code of ['FREE', 'STANDARD', 'PREMIUM'] as const) {
    const policy = await db.packagePolicy.findFirst({ where: { code }, orderBy: { version: 'desc' }, select: { version: true, settings: true } });
    if (!policy) throw new Error(`Package policy is missing: ${code}`);
    policies.set(code, policy);
  }
  const packagesEnabled = await db.featureFlag.findUnique({ where: { key: 'hr_packages' }, select: { enabled: true } });
  if (!packagesEnabled?.enabled) throw new Error('hr_packages must be enabled to grant Standard and Premium through the existing package service');
  const superAdmin = await db.user.findFirst({ where: { role: 'SUPER_ADMIN', isBanned: false }, orderBy: { id: 'asc' }, select: { id: true, email: true, role: true, isBanned: true, fullName: true } });
  if (!superAdmin) throw new Error('A non-banned SUPER_ADMIN account is required to record Standard and Premium package grants');

  return {
    cities,
    industries,
    skillsByJob,
    usedSkills,
    skillAliases,
    policies,
    superAdmin: { ...superAdmin, role: 'SUPER_ADMIN', isBanned: false },
  };
}

async function baselineSnapshot(db: PrismaClient, catalog: ResolvedCatalog) {
  const seedIds = targetFingerprintCompanyIds();
  const companies = await db.company.findMany({ where: { id: { notIn: seedIds } }, orderBy: { slug: 'asc' } });
  const baselineNames = companies.map((company) => company.name).sort((a, b) => a.localeCompare(b));
  if (companies.length !== 3 || JSON.stringify(baselineNames) !== JSON.stringify(ORIGINAL_COMPANY_NAMES)) {
    throw new Error(`Local baseline mismatch: expected only the three existing showcase companies (${ORIGINAL_COMPANY_NAMES.join(', ')}); found ${companies.length} non-seed companies`);
  }
  const companyIds = companies.map((company) => company.id);
  const [jobs, memberships, liveCounts] = await Promise.all([
    db.jobPost.findMany({ where: { companyId: { in: companyIds } }, orderBy: { id: 'asc' } }),
    db.companyMember.findMany({ where: { companyId: { in: companyIds } }, orderBy: { id: 'asc' } }),
    db.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, slug: true, _count: { select: { jobPosts: { where: { status: 'PUBLISHED', isAnonymous: false, OR: [{ benefit: { is: null } }, { benefit: { expiresAt: null } }, { benefit: { expiresAt: { gt: new Date() } } }] } } } } },
    }),
  ]);
  const liveCountById = new Map(liveCounts.map((company) => [company.id, company._count.jobPosts]));
  const notHiring = companies.filter((company) => company.isBanned || company.anonymizedAt || (liveCountById.get(company.id) ?? 0) === 0).map((company) => company.slug);
  if (notHiring.length) throw new Error(`Existing companies must keep at least one active public job for the planned 24-company carousel: ${notHiring.join(', ')}`);
  const cities = [...catalog.cities.values()].sort((a, b) => a.name.localeCompare(b.name));
  const industries = [...catalog.industries.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  const packagePolicies = [...catalog.policies.entries()].sort(([a], [b]) => a.localeCompare(b));
  const featureFlag = await db.featureFlag.findUnique({ where: { key: 'hr_packages' } });
  const superAdmin = catalog.superAdmin;
  return {
    companies,
    jobs,
    memberships,
    cities,
    industries,
    skills: catalog.usedSkills.sort((a, b) => a.id.localeCompare(b.id)),
    skillAliases: catalog.skillAliases.sort((a, b) => a.id.localeCompare(b.id)),
    packagePolicies,
    featureFlag,
    superAdmin,
  };
}

async function inspectBatch(db: PrismaClient, catalog: ResolvedCatalog) {
  const issues: string[] = [];
  const seedCompanyIds = targetFingerprintCompanyIds();
  const companiesById = new Map((await db.company.findMany({ where: { id: { in: seedCompanyIds } } })).map((row) => [row.id, row]));
  let companiesToCreate = 0;
  let accountsToCreate = 0;
  let jobsToCreate = 0;
  let jobsToGrantOrPublish = 0;
  for (const company of FEATURED_COMPANIES) {
    const id = companyId(company);
    const email = userEmail(company);
    const companyRow = companiesById.get(id);
    const slugRow = await db.company.findUnique({ where: { slug: company.slug }, select: { id: true } });
    if (slugRow && slugRow.id !== id) issues.push(`Company slug collision: ${company.slug}`);
    if (companyRow && companyRow.slug !== company.slug) issues.push(`Seed company ID is owned by another slug: ${id}`);
    if (!companyRow) companiesToCreate += 1;

    const account = await db.user.findUnique({ where: { email }, select: { id: true, role: true, email: true } });
    const accountById = await db.user.findUnique({ where: { id: userId(company) }, select: { id: true, email: true, role: true } });
    if (account && account.id !== userId(company)) issues.push(`Recruiter email collision: ${email}`);
    if (accountById && (accountById.email !== email || accountById.role !== 'RECRUITER')) issues.push(`Seed recruiter identity conflicts with existing user: ${email}`);
    if (!accountById) accountsToCreate += 1;

    const membership = companyRow && accountById
      ? await db.companyMember.findUnique({ where: { companyId_userId: { companyId: id, userId: userId(company) } }, select: { role: true } })
      : null;
    const onboarding = accountById ? await db.recruiterOnboarding.findUnique({ where: { userId: userId(company) }, select: { companyId: true, status: true } }) : null;
    if ((companyRow || accountById) && (!companyRow || !accountById || !membership || !onboarding)) {
      issues.push(`Seed company/account group is partial and will not be repaired automatically: ${company.slug}`);
    }
    if (membership && membership.role !== 'OWNER') issues.push(`Seed recruiter is not the company owner: ${company.slug}`);
    if (onboarding && (onboarding.companyId !== id || onboarding.status !== 'COMPLETED')) issues.push(`Recruiter onboarding differs from seed expectation: ${company.slug}`);

    for (let index = 0; index < company.roles.length; index += 1) {
      const role = company.roles[index];
      const expectedJobId = jobId(company, index);
      const existing = await db.jobPost.findUnique({ where: { id: expectedJobId }, include: { benefit: true } });
      const collision = await db.jobPost.findFirst({ where: { companyId: id, title: role.title, status: { in: ['DRAFT', 'PUBLISHED', 'PAUSED'] }, id: { not: expectedJobId } }, select: { id: true } });
      if (collision) issues.push(`Active job title collision in ${company.slug}: ${role.title}`);
      if (!existing) jobsToCreate += 1;
      else {
        const expectedCityId = catalog.cities.get(company.cityName)?.id;
        const expectedContentHash = contentHash(descriptionFor(company, role));
        const expectedFingerprint = jobFingerprint({ title: role.title, workMode: 'ONSITE', cityId: expectedCityId });
        if (
          existing.companyId !== id || existing.title !== role.title || existing.cityId !== expectedCityId ||
          existing.contentHash !== expectedContentHash || existing.currency !== 'IDR' || existing.locale !== 'id' ||
          existing.countryId !== catalog.cities.get(company.cityName)?.countryId || existing.employmentType !== 'FULL_TIME' ||
          existing.workMode !== 'ONSITE' || existing.salaryPeriod !== 'MONTHLY' || existing.salaryMin !== role.salary[0] ||
          existing.salaryMax !== role.salary[1] || existing.experienceYearsMin !== role.years ||
          existing.experienceLevel !== role.level || existing.isAnonymous || existing.fingerprint !== expectedFingerprint
        ) {
          issues.push(`Existing seed job was changed; it will not be overwritten: ${expectedJobId}`);
        }
        const packageCode = FEATURED_PACKAGES[index];
        if (existing.status === 'PUBLISHED') {
          if (existing.benefit?.code !== packageCode || !existing.benefit.startsAt || !existing.benefit.expiresAt || existing.benefit.expiresAt <= new Date()) {
            issues.push(`Published seed job has an unexpected or expired package period: ${expectedJobId}`);
          }
        } else if (existing.status === 'DRAFT') {
          if (existing.benefit && existing.benefit.code !== 'FREE' && existing.benefit.code !== packageCode) issues.push(`Draft seed job has an unexpected package: ${expectedJobId}`);
          jobsToGrantOrPublish += 1;
        } else {
          issues.push(`Seed job status was changed and will not be reset: ${expectedJobId} (${existing.status})`);
        }
        const [skillRows, questions] = await Promise.all([
          db.jobPostSkill.findMany({ where: { jobPostId: expectedJobId }, select: { skillId: true } }),
          db.jobQuestion.findMany({ where: { jobPostId: expectedJobId, archivedAt: null }, orderBy: { sortOrder: 'asc' }, select: { question: true } }),
        ]);
        const expectedSkills = (catalog.skillsByJob.get(expectedJobId) || []).map((skill) => skill.id).sort();
        const actualSkills = skillRows.map((skill) => skill.skillId).sort();
        if (JSON.stringify(actualSkills) !== JSON.stringify(expectedSkills) || questions.length !== 2 ||
          questions.some((question, questionIndex) => question.question !== role.questions[questionIndex])) {
          issues.push(`Seed job associations were changed and will not be repaired: ${expectedJobId}`);
        }
      }
    }
  }
  if (issues.length) throw new Error(`Dry-run found conflicts; no writes were made:\n- ${issues.join('\n- ')}`);
  return { companiesToCreate, accountsToCreate, jobsToCreate, jobsToGrantOrPublish };
}

async function makeDryRunReport(db: PrismaClient, target: ResolvedFeaturedCompanySeedTarget) {
  const manifest = validateManifest(target.target === 'local');
  const catalog = await resolveCatalog(db);
  const baseline = await baselineSnapshot(db, catalog);
  const plan = await inspectBatch(db, catalog);
  const manifestHash = hashValue({ version: FEATURED_COMPANY_CAROUSEL_VERSION, companies: FEATURED_COMPANIES });
  const targetFingerprint = hashValue({ target: target.target, database: target.database, baseline });
  return {
    operation: 'dry-run',
    target: target.target,
    targetDatabase: target.database,
    manifestVersion: FEATURED_COMPANY_CAROUSEL_VERSION,
    manifestHash,
    targetFingerprint,
    baselineCompanies: 3,
    seedCompanies: manifest.companies,
    seedJobs: manifest.jobs,
    packageDistribution: { FREE: 21, STANDARD: 21, PREMIUM: 21 },
    plan,
    resolvedCatalog: {
      cities: catalog.cities.size,
      industries: catalog.industries.size,
      skillsLinked: [...catalog.skillsByJob.values()].reduce((sum, skills) => sum + skills.length, 0),
      packagePolicies: catalog.policies.size,
    },
  };
}

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function createCompaniesAndAccounts(db: PrismaClient, catalog: ResolvedCatalog, passwordHash: string) {
  const missing = [] as Array<{ company: FeaturedCompany; cityId: string; countryId: string; industryId: string }>;
  for (const company of FEATURED_COMPANIES) {
    const id = companyId(company);
    const [existing, existingUser] = await Promise.all([
      db.company.findUnique({ where: { id }, select: { id: true } }),
      db.user.findUnique({ where: { id: userId(company) }, select: { id: true } }),
    ]);
    if (!existing && !existingUser) {
      const city = catalog.cities.get(company.cityName)!;
      const industry = catalog.industries.get(company.industrySlug)!;
      missing.push({ company, cityId: city.id, countryId: city.countryId, industryId: industry.id });
    }
  }
  if (!missing.length) return 0;
  await db.$transaction(async (tx) => {
    for (const entry of missing) {
      const { company } = entry;
      const accountId = userId(company);
      const createdUser = await tx.user.create({
        data: {
          id: accountId,
          email: userEmail(company),
          passwordHash,
          fullName: company.hrName,
          role: 'RECRUITER',
          locale: 'id',
          emailVerified: true,
        },
      });
      const createdCompany = await tx.company.create({
        data: {
          id: companyId(company),
          slug: company.slug,
          name: company.name,
          description: company.description,
          locale: 'id',
          website: company.website,
          cityId: entry.cityId,
          industryId: entry.industryId,
          size: company.size as CompanySize,
          logoUrl: `/images/featured-companies/${company.slug}.svg`,
          isVerified: false,
        },
      });
      await tx.companyMember.create({ data: { companyId: createdCompany.id, userId: createdUser.id, role: 'OWNER' } });
      await tx.recruiterOnboarding.create({
        data: { userId: createdUser.id, status: 'COMPLETED', step: 4, companyId: createdCompany.id, completedAt: new Date() },
      });
    }
  }, { timeout: 30000 });
  return missing.length;
}

async function createMissingJobs(db: PrismaClient, catalog: ResolvedCatalog) {
  const missing: Array<{
    company: FeaturedCompany;
    index: number;
    role: FeaturedRole;
    companyId: string;
    cityId: string;
    countryId: string;
    skills: Array<{ id: string; name: string }>;
  }> = [];
  for (const company of FEATURED_COMPANIES) {
    const city = catalog.cities.get(company.cityName)!;
    for (let index = 0; index < company.roles.length; index += 1) {
      const id = jobId(company, index);
      if (await db.jobPost.findUnique({ where: { id }, select: { id: true } })) continue;
      missing.push({
        company,
        index,
        role: company.roles[index],
        companyId: companyId(company),
        cityId: city.id,
        countryId: city.countryId,
        skills: catalog.skillsByJob.get(id)!,
      });
    }
  }
  if (!missing.length) return 0;
  await db.$transaction(async (tx) => {
    for (const entry of missing) {
      const id = jobId(entry.company, entry.index);
      const description = descriptionFor(entry.company, entry.role);
      await tx.jobPost.create({
        data: {
          id,
          companyId: entry.companyId,
          title: entry.role.title,
          description,
          cityId: entry.cityId,
          countryId: entry.countryId,
          employmentType: 'FULL_TIME',
          workMode: 'ONSITE',
          salaryMin: entry.role.salary[0],
          salaryMax: entry.role.salary[1],
          salaryPeriod: 'MONTHLY',
          currency: 'IDR',
          experienceYearsMin: entry.role.years,
          experienceLevel: entry.role.level as ExperienceLevel,
          isAnonymous: false,
          locale: 'id',
          status: 'DRAFT',
          fingerprint: jobFingerprint({ title: entry.role.title, workMode: 'ONSITE', cityId: entry.cityId }),
          contentHash: contentHash(description),
        },
      });
      await tx.jobPostSkill.createMany({
        data: entry.skills.map((skill) => ({ jobPostId: id, skillId: skill.id, isRequired: true, weight: 1 })),
      });
      for (let questionIndex = 0; questionIndex < entry.role.questions.length; questionIndex += 1) {
        const question = await tx.jobQuestion.create({
          data: {
            id: `${SEED_PREFIX}-question-${entry.company.slug}-${entry.index}-${questionIndex + 1}`,
            jobPostId: id,
            question: entry.role.questions[questionIndex],
            type: 'TEXT',
            isRequired: true,
            sortOrder: questionIndex,
          },
        });
        await tx.jobQuestionVersion.create({
          data: { questionId: question.id, revision: 1, snapshot: JSON.parse(JSON.stringify(question)) as Prisma.InputJsonValue },
        });
      }
      if (FEATURED_PACKAGES[entry.index] === FREE_PLAN_CODE) {
        const policy = catalog.policies.get('FREE')!;
        await tx.jobBenefit.create({
          data: {
            id: `${SEED_PREFIX}-benefit-${entry.company.slug}-free`,
            jobId: id,
            companyId: entry.companyId,
            code: 'FREE',
            highestCode: 'FREE',
            policyVersion: policy.version,
            policySnapshot: policy.settings as Prisma.InputJsonValue,
            selectionConfirmedAt: new Date(),
          },
        });
      }
    }
  }, { timeout: 60000 });
  return missing.length;
}

async function verifySeed(db: PrismaClient, catalog: ResolvedCatalog) {
  const companyIds = targetFingerprintCompanyIds();
  const userIds = FEATURED_COMPANIES.map(userId);
  const jobIds = FEATURED_COMPANIES.flatMap((company) => company.roles.map((_, index) => jobId(company, index)));
  const [companies, users, memberships, onboardings, jobs, benefits, grants, applications, profiles, payments, orders] = await Promise.all([
    db.company.findMany({ where: { id: { in: companyIds } }, include: { city: { include: { province: { include: { country: true } } } } } }),
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, role: true, emailVerified: true } }),
    db.companyMember.findMany({ where: { companyId: { in: companyIds }, userId: { in: userIds } } }),
    db.recruiterOnboarding.findMany({ where: { userId: { in: userIds } } }),
    db.jobPost.findMany({ where: { id: { in: jobIds } }, include: { city: { include: { province: { include: { country: true } } } }, benefit: true, jobSkills: true, questions: { where: { archivedAt: null } } } }),
    db.jobBenefit.findMany({ where: { jobId: { in: jobIds } } }),
    db.jobPackageGrant.count({ where: { benefit: { jobId: { in: jobIds } }, code: { in: ['STANDARD', 'PREMIUM'] } } }),
    db.application.count({ where: { jobPostId: { in: jobIds } } }),
    db.employeeProfile.count({ where: { userId: { in: userIds } } }),
    db.payment.count({ where: { companyId: { in: companyIds } } }),
    db.jobPurchaseOrder.count({ where: { companyId: { in: companyIds } } }),
  ]);
  assert.equal(companies.length, 21, 'expected exactly 21 seed companies');
  assert.equal(users.length, 21, 'expected exactly 21 recruiter accounts');
  assert.equal(memberships.length, 21, 'expected one owner membership per seed company');
  assert.equal(onboardings.length, 21, 'expected completed recruiter onboarding');
  assert.equal(jobs.length, 63, 'expected exactly 63 seed jobs');
  assert.equal(benefits.length, 63, 'expected a benefit allocation for every job');
  assert.equal(grants, 42, 'expected an audited grant for every Standard and Premium job');
  assert.equal(applications, 0, 'seed jobs must not have applications');
  assert.equal(profiles, 0, 'seed recruiter accounts must not have employee profiles');
  assert.equal(payments, 0, 'seed companies must not have payment rows');
  assert.equal(orders, 0, 'seed companies must not have purchase orders');
  const packageCounts = { FREE: 0, STANDARD: 0, PREMIUM: 0 };
  const now = new Date();
  for (const company of companies) {
    assert.equal(company.isBanned, false);
    assert.equal(company.anonymizedAt, null);
    assert.equal(company.city?.province.country.iso2, 'ID', `company location must be in Indonesia: ${company.slug}`);
  }
  for (const account of users) assert.equal(account.role, 'RECRUITER');
  for (const membership of memberships) assert.equal(membership.role, 'OWNER');
  for (const onboarding of onboardings) assert.equal(onboarding.status, 'COMPLETED');
  for (const job of jobs) {
    assert.equal(job.status, 'PUBLISHED', `job must be published: ${job.id}`);
    assert.equal(job.locale, 'id');
    assert.equal(job.currency, 'IDR');
    assert.equal(job.salaryPeriod, 'MONTHLY');
    assert.equal(job.isAnonymous, false);
    assert.equal(job.city?.province.country.iso2, 'ID');
    assert.ok(job.jobSkills.length >= 5 && job.jobSkills.length <= 8, `job must have 5–8 catalog skills: ${job.id}`);
    assert.equal(job.questions.length, 2, `job must have two screening questions: ${job.id}`);
    const code = job.benefit?.code;
    assert.ok(code && code in packageCounts, `job package missing: ${job.id}`);
    packageCounts[code as keyof typeof packageCounts] += 1;
    assert.ok(job.benefit?.startsAt && job.benefit.expiresAt && job.benefit.expiresAt > now, `job publication period must be active: ${job.id}`);
  }
  assert.deepEqual(packageCounts, { FREE: 21, STANDARD: 21, PREMIUM: 21 });
  const baseline = await baselineSnapshot(db, catalog);
  return {
    operation: 'verify',
    ok: true,
    baselineFingerprint: hashValue(baseline),
    companies: companies.length,
    recruiterAccounts: users.length,
    publishedJobs: jobs.length,
    packages: packageCounts,
    standardAndPremiumGrants: grants,
    payments: 0,
    purchaseOrders: 0,
    applications: 0,
    employeeProfiles: 0,
  };
}

async function executeApply(
  db: PrismaClient,
  catalog: ResolvedCatalog,
  password: string,
  benefits: import('../benefits/benefits.service').BenefitsService,
  jobs: import('../jobs/jobs.service').JobsService,
  search: import('../search/jobs-search.service').JobsSearchService,
) {
  const passwordHash = await bcrypt.hash(password, 12);
  const companiesCreated = await createCompaniesAndAccounts(db, catalog, passwordHash);
  const jobsCreated = await createMissingJobs(db, catalog);
  const actor = {
    id: catalog.superAdmin.id,
    email: catalog.superAdmin.email,
    role: 'SUPER_ADMIN' as const,
    fullName: catalog.superAdmin.fullName,
    isBanned: false,
  } satisfies AuthUser;
  let grantsCreated = 0;
  let jobsPublished = 0;
  for (const company of FEATURED_COMPANIES) {
    const recruiter = {
      id: userId(company),
      email: userEmail(company),
      role: 'RECRUITER' as const,
      fullName: company.hrName,
      isBanned: false,
      memberships: [{ companyId: companyId(company), role: 'OWNER' as const }],
    } satisfies AuthUser;
    for (let index = 0; index < company.roles.length; index += 1) {
      const id = jobId(company, index);
      const job = await db.jobPost.findUniqueOrThrow({ where: { id }, select: { status: true } });
      if (job.status === 'PUBLISHED') {
        await search.syncJob(id);
        continue;
      }
      const packageCode = FEATURED_PACKAGES[index];
      const currentBenefit = await db.jobBenefit.findUnique({ where: { jobId: id } });
      if (packageCode !== 'FREE' && currentBenefit?.code !== packageCode) {
        await benefits.grant(
          actor,
          id,
          packageCode,
          `Fictional homepage showcase allocation v${FEATURED_COMPANY_CAROUSEL_VERSION}; no payment taken`,
          `${SEED_PREFIX}-grant-${id}`,
        );
        grantsCreated += 1;
      }
      if (packageCode === 'FREE' && (!currentBenefit || !currentBenefit.selectionConfirmedAt)) {
        throw new Error(`Free package selection is missing; refusing to alter an existing job: ${id}`);
      }
      await jobs.changeStatus(recruiter, id, 'PUBLISHED' as JobStatus);
      jobsPublished += 1;
      await search.syncJob(id);
    }
  }
  return { companiesCreated, jobsCreated, grantsCreated, jobsPublished };
}

async function main() {
  const command = process.argv[2];
  if (!['dry-run', 'apply', 'verify'].includes(command)) {
    throw new Error('Usage: seed:featured-companies <dry-run|apply|verify> [--manifest-hash SHA256 --expected-fingerprint SHA256]');
  }
  const databaseUrl = loadDatabaseUrl();
  const targetValue = getArg('--target') ?? 'local';
  const target = assertFeaturedCompanySeedTarget(databaseUrl, targetValue);
  validateManifest(target.target === 'local');
  if (target.target === 'indonesia-vps') await verifyVpsLogoAssets();

  if (command === 'dry-run' || command === 'verify') {
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    try {
      const catalog = await resolveCatalog(db);
      if (command === 'dry-run') {
        process.stdout.write(`${JSON.stringify(await makeDryRunReport(db, target), null, 2)}\n`);
      } else {
        process.stdout.write(`${JSON.stringify(await verifySeed(db, catalog), null, 2)}\n`);
      }
    } finally {
      await db.$disconnect();
    }
    return;
  }

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module');
  const { PrismaService } = await import('../prisma/prisma.service');
  const { BenefitsService } = await import('../benefits/benefits.service');
  const { JobsService } = await import('../jobs/jobs.service');
  const { JobsSearchService } = await import('../search/jobs-search.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const db = app.get(PrismaService);
    const catalog = await resolveCatalog(db);
    const report = await makeDryRunReport(db, target);
    const suppliedManifestHash = getArg('--manifest-hash');
    const expectedFingerprint = getArg('--expected-fingerprint');
    if (!suppliedManifestHash || !expectedFingerprint) throw new Error('Apply requires --manifest-hash and --expected-fingerprint from the reviewed dry-run');
    if (suppliedManifestHash !== report.manifestHash) throw new Error('Manifest hash differs from the reviewed dry-run; no writes were made');
    if (expectedFingerprint !== report.targetFingerprint) throw new Error('Target fingerprint differs from the reviewed dry-run; no writes were made');
    const missingAccounts = report.plan.accountsToCreate;
    const password = process.env.FEATURED_COMPANY_SEED_PASSWORD;
    if (missingAccounts && !password) throw new Error('FEATURED_COMPANY_SEED_PASSWORD is required to create recruiter accounts; no password is printed or stored in the manifest');
    const result = await executeApply(
      db,
      catalog,
      password || 'unused-existing-seed-account',
      app.get(BenefitsService),
      app.get(JobsService),
      app.get(JobsSearchService),
    );
    const verification = await verifySeed(db, catalog);
    process.stdout.write(`${JSON.stringify({ operation: 'apply', ...result, verification }, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unexpected seed failure';
  process.stderr.write(`featured company carousel seed failed: ${message}\n`);
  process.exitCode = 1;
});
