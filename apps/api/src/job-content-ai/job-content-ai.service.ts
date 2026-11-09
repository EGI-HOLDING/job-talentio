import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Company } from '@prisma/client';
import { OpenAiClient } from '../common/openai/openai.client';
import { AuthUser } from '../common/auth.decorators';
import { CompaniesService } from '../companies/companies.service';
import { extractCvText } from '../profiles/parse/cv-text-extract';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { composeJobContentPrompt } from './prompts/compose';
import { GenerateJobContentInput, JobContentTarget, validateJobContentSuggestion } from './job-content-ai.schema';

export const JOB_CONTENT_AI_CLIENT = Symbol('JOB_CONTENT_AI_CLIENT');

const COMPANY_SIZE_LABELS: Record<string, Record<string, string>> = {
  SIZE_1_10: { id: '1–10 karyawan', en: '1–10 employees', ru: '1–10 сотрудников', uz: '1–10 xodim' },
  SIZE_11_50: { id: '11–50 karyawan', en: '11–50 employees', ru: '11–50 сотрудников', uz: '11–50 xodim' },
  SIZE_51_200: { id: '51–200 karyawan', en: '51–200 employees', ru: '51–200 сотрудников', uz: '51–200 xodim' },
  SIZE_201_1000: { id: '201–1.000 karyawan', en: '201–1,000 employees', ru: '201–1 000 сотрудников', uz: '201–1 000 xodim' },
  SIZE_1000_PLUS: { id: 'lebih dari 1.000 karyawan', en: 'more than 1,000 employees', ru: 'более 1 000 сотрудников', uz: '1 000 dan ortiq xodim' },
};
const COMPANY_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_COMPANY_CONTEXT = 12_000;

@Injectable()
export class JobContentAiService {
  private readonly logger = new Logger(JobContentAiService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompaniesService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    @Inject(JOB_CONTENT_AI_CLIENT) private readonly client: OpenAiClient,
  ) {}

  async generate(user: AuthUser, input: GenerateJobContentInput) {
    if (!this.client.enabled) throw new ServiceUnavailableException('AI sedang tidak tersedia. Coba lagi nanti.');

    await this.companies.assertMember(user, input.companyId);
    const company = await this.db.company.findUnique({
      where: { id: input.companyId },
      include: {
        industry: { select: { name: true, nameId: true, nameRu: true, nameUz: true } },
        industryGroup: { select: { name: true, nameId: true, nameRu: true, nameUz: true } },
      },
    });
    if (!company || company.anonymizedAt || company.isBanned) throw new BadRequestException('Profil perusahaan tidak tersedia.');

    const companyProfile = await this.companyContext(company, input.locale);
    const industry = company.industry
      ? this.localized(company.industry, input.locale)
      : company.industryGroup ? this.localized(company.industryGroup, input.locale) : null;
    const context = {
      target: input.target,
      locale: input.locale,
      company: {
        name: company.name,
        size: company.size ? COMPANY_SIZE_LABELS[company.size]?.[input.locale] ?? null : null,
        industry,
        companyProfile,
      },
      job: input.job,
    };
    const prompt = composeJobContentPrompt(input.target, context);

    try {
      const raw = await this.client.chatJson<unknown>({
        system: prompt.system,
        user: prompt.user,
        maxTokens: prompt.maxTokens,
      });
      const suggestion = validateJobContentSuggestion(input.target, raw);
      return { target: input.target, suggestion, promptVersion: prompt.version };
    } catch (error) {
      this.logger.warn('Job content generation failed for company ' + input.companyId + ', target ' + input.target + ': ' + (error instanceof Error ? error.message : 'unknown error'));
      throw new ServiceUnavailableException('Hasil AI belum tersedia. Isi lowongan tetap aman; silakan coba lagi.');
    }
  }

  private localized(value: { name: string; nameId?: string | null; nameRu?: string | null; nameUz?: string | null }, locale: string) {
    return (locale === 'id' ? value.nameId : locale === 'ru' ? value.nameRu : locale === 'uz' ? value.nameUz : null) || value.name;
  }

  private async companyContext(company: Company, locale: string): Promise<string> {
    if (company.profileSource === 'DOCUMENT' && company.profileDocumentId) {
      const doc = await this.db.companyProfileDocument.findFirst({
        where: { id: company.profileDocumentId, companyId: company.id, kind: 'DOCUMENT', retiredAt: null },
      });
      if (doc) {
        try {
          const buffer = await this.storage.getObjectBuffer(doc.fileKey, COMPANY_DOCUMENT_MAX_BYTES);
          const noOcrConfig = { get: (key: string) => key === 'CV_PARSE_OCR' ? 'false' : undefined } as ConfigService;
          const extracted = await extractCvText({ buffer, filename: doc.filename, mimeType: doc.contentType }, noOcrConfig);
          if (extracted.text.trim()) return this.limitContext(extracted.text);
        } catch (error) {
          this.logger.warn('Company profile text unavailable for company ' + company.id + ': ' + (error instanceof Error ? error.message : 'unknown error'));
        }
      }
    }

    const description = company.description?.trim();
    if (description) return this.limitContext(description);
    throw new BadRequestException(locale === 'id'
      ? 'Profil perusahaan belum memiliki deskripsi yang dapat dibaca. Lengkapi deskripsi perusahaan atau gunakan dokumen profil yang berisi teks.'
      : 'The company profile has no readable description. Add a company description or use a text-readable profile document.');
  }

  private limitContext(value: string) {
    return value.replace(/\s+/g, ' ').slice(0, MAX_COMPANY_CONTEXT);
  }
}
