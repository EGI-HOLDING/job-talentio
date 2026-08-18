import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ApplicationStatus, BulkDeliveryStatus } from '@prisma/client';
import { translateMessage } from '@job-talentio/shared';
import type { MessageLocale } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { ApplicationsService } from '../applications/applications.service';
import { ChatService } from '../chat/chat.service';
import { TelegramService } from '../telegram/telegram.service';
import { MailService } from '../mail/mail.service';
import { AuthUser } from '../common/auth.decorators';
import { emailLocale } from '../common/i18n/email-locale';
import { formatTelegramChatText } from '../telegram/telegram.chat';

type CampaignInput = {
  companyId: string;
  jobPostId: string;
  applicationIds: string[];
  fromStatus?: ApplicationStatus;
  toStatus?: ApplicationStatus;
  templateId?: string;
  messageBody?: string;
  note?: string;
  channels?: { app?: boolean; email?: boolean; telegram?: boolean };
};

function resolveBulkChannels(
  raw: CampaignInput['channels'] | undefined,
  wantsMessage: boolean,
): { app: boolean; email: boolean; telegram: boolean } {
  if (!wantsMessage) return { app: false, email: false, telegram: false };
  const app = raw?.app !== false;
  const email = Boolean(raw?.email);
  const telegram = Boolean(raw?.telegram);
  if (!app && !email && !telegram) return { app: true, email: false, telegram: false };
  return { app, email, telegram };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

@Injectable()
export class BulkCommsService {
  constructor(
    private prisma: PrismaService,
    private companies: CompaniesService,
    private applications: ApplicationsService,
    private chat: ChatService,
    private telegram: TelegramService,
    private mail: MailService,
  ) {}

  private async assertCompany(user: AuthUser, companyId: string) {
    await this.companies.assertMember(user, companyId, ['OWNER', 'ADMIN', 'RECRUITER']);
  }

  renderTemplate(
    body: string,
    vars: { name: string; jobTitle: string; companyName: string; status?: string },
  ) {
    return body
      .replace(/\{\{\s*name\s*\}\}/gi, vars.name)
      .replace(/\{\{\s*jobTitle\s*\}\}/gi, vars.jobTitle)
      .replace(/\{\{\s*companyName\s*\}\}/gi, vars.companyName)
      .replace(/\{\{\s*status\s*\}\}/gi, vars.status ?? '');
  }

  // ── Templates ──────────────────────────────────────────────

  async listTemplates(user: AuthUser, companyId: string) {
    await this.assertCompany(user, companyId);
    return this.prisma.messageTemplate.findMany({
      where: { companyId },
      orderBy: { updatedAt: 'desc' },
      include: {
        author: { select: { id: true, fullName: true } },
      },
    });
  }

  async createTemplate(
    user: AuthUser,
    data: { companyId: string; name: string; body: string },
  ) {
    await this.assertCompany(user, data.companyId);
    return this.prisma.messageTemplate.create({
      data: {
        companyId: data.companyId,
        createdBy: user.id,
        name: data.name,
        body: data.body,
      },
    });
  }

  async updateTemplate(
    user: AuthUser,
    id: string,
    data: { name?: string; body?: string },
  ) {
    const tpl = await this.prisma.messageTemplate.findUnique({ where: { id } });
    if (!tpl) throw new NotFoundException('Template not found');
    await this.assertCompany(user, tpl.companyId);
    if (!data.name && !data.body) {
      throw new BadRequestException('Nothing to update');
    }
    return this.prisma.messageTemplate.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.body ? { body: data.body } : {}),
      },
    });
  }

  async deleteTemplate(user: AuthUser, id: string) {
    const tpl = await this.prisma.messageTemplate.findUnique({ where: { id } });
    if (!tpl) throw new NotFoundException('Template not found');
    await this.assertCompany(user, tpl.companyId);
    await this.prisma.messageTemplate.delete({ where: { id } });
    return { ok: true };
  }

  // ── Campaigns / history ────────────────────────────────────

  async listCampaigns(user: AuthUser, companyId: string, jobPostId?: string) {
    await this.assertCompany(user, companyId);
    return this.prisma.bulkCampaign.findMany({
      where: {
        companyId,
        ...(jobPostId ? { jobPostId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        createdBy: { select: { id: true, fullName: true } },
        jobPost: { select: { id: true, title: true } },
        template: { select: { id: true, name: true } },
        recipients: {
          select: {
            id: true,
            candidateName: true,
            deliveryStatus: true,
            statusMoved: true,
            sentAt: true,
            errorMessage: true,
          },
        },
        _count: { select: { recipients: true } },
      },
    });
  }

  async getCampaign(user: AuthUser, id: string) {
    const campaign = await this.prisma.bulkCampaign.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
        jobPost: { select: { id: true, title: true } },
        template: { select: { id: true, name: true, body: true } },
        recipients: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    await this.assertCompany(user, campaign.companyId);
    return campaign;
  }

  async runCampaign(user: AuthUser, input: CampaignInput) {
    await this.assertCompany(user, input.companyId);

    const job = await this.prisma.jobPost.findUnique({
      where: { id: input.jobPostId },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!job || job.companyId !== input.companyId) {
      throw new NotFoundException('Job not found for this company');
    }

    let templateBody: string | null = null;
    if (input.templateId) {
      const tpl = await this.prisma.messageTemplate.findFirst({
        where: { id: input.templateId, companyId: input.companyId },
      });
      if (!tpl) throw new NotFoundException('Template not found');
      templateBody = tpl.body;
    }

    const wantsMessage = Boolean(templateBody || input.messageBody);
    if (!input.toStatus && !wantsMessage) {
      throw new BadRequestException('Provide toStatus and/or a message');
    }

    const apps = await this.prisma.application.findMany({
      where: {
        id: { in: input.applicationIds },
        jobPostId: input.jobPostId,
      },
      include: {
        profile: {
          select: {
            id: true,
            userId: true,
            bulkCommsOptOut: true,
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                emailVerified: true,
                telegramId: true,
                locale: true,
              },
            },
          },
        },
      },
    });

    if (apps.length === 0) {
      throw new BadRequestException('No matching applications for this job');
    }
    if (apps.length !== input.applicationIds.length) {
      throw new BadRequestException(
        'Some application IDs are invalid or do not belong to this job',
      );
    }

    if (input.fromStatus) {
      const wrong = apps.filter((a) => a.status !== input.fromStatus);
      if (wrong.length) {
        throw new BadRequestException(
          `${wrong.length} candidate(s) are not in stage ${input.fromStatus}`,
        );
      }
    }

    const channels = resolveBulkChannels(input.channels, wantsMessage);

    const campaign = await this.prisma.bulkCampaign.create({
      data: {
        companyId: input.companyId,
        jobPostId: input.jobPostId,
        createdById: user.id,
        templateId: input.templateId ?? null,
        messageBody: input.messageBody ?? templateBody,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        note: input.note ?? null,
        recipients: {
          create: apps.map((a) => ({
            applicationId: a.id,
            userId: a.profile.userId,
            candidateName: a.profile.user.fullName,
            deliveryStatus: 'PENDING' as BulkDeliveryStatus,
          })),
        },
      },
      include: { recipients: true },
    });

    for (const app of apps) {
      const recipient = campaign.recipients.find((r) => r.applicationId === app.id)!;
      let deliveryStatus: BulkDeliveryStatus = 'PENDING';
      let errorMessage: string | null = null;
      let conversationId: string | null = null;
      let messageId: string | null = null;
      let statusMoved = false;
      let sentAt: Date | null = null;

      try {
        if (input.toStatus && app.status !== input.toStatus) {
          await this.applications.updateStatus(
            user,
            app.id,
            input.toStatus,
            input.note ?? 'Bulk pipeline update',
            { skipStatusEmail: wantsMessage && channels.email },
          );
          statusMoved = true;
        }

        if (wantsMessage) {
          if (app.profile.bulkCommsOptOut) {
            deliveryStatus = 'SKIPPED_OPTED_OUT';
            errorMessage = 'Candidate opted out of bulk messaging (GDPR)';
          } else {
            const body = this.renderTemplate(input.messageBody ?? templateBody ?? '', {
              name: app.profile.user.fullName,
              jobTitle: job.title,
              companyName: job.company.name,
              status: input.toStatus ?? app.status,
            });
            const recipientUser = app.profile.user;
            let delivered = false;
            const skipped: string[] = [];

            if (channels.app) {
              const conversation = await this.chat.startConversation(
                user,
                recipientUser.id,
                { jobPostId: job.id, companyId: input.companyId },
              );
              const message = await this.chat.sendMessage(user, conversation.id, body, {
                telegram: 'never',
              });
              conversationId = conversation.id;
              messageId = message.id;
              delivered = true;
            }

            if (channels.email) {
              if (!recipientUser.emailVerified || !recipientUser.email) {
                skipped.push('email');
              } else {
                const sent = await this.sendOutreachEmail({
                  to: recipientUser.email,
                  locale: emailLocale(recipientUser.locale),
                  senderName: user.fullName || 'Job Talentio',
                  senderId: user.id,
                  body,
                });
                if (sent) delivered = true;
                else skipped.push('email');
              }
            }

            if (channels.telegram) {
              if (!recipientUser.telegramId) {
                skipped.push('telegram');
              } else {
                const locale = emailLocale(recipientUser.locale);
                const webUrl = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
                const text = formatTelegramChatText({
                  locale,
                  sender: user.fullName || 'Job Talentio',
                  message: body,
                  url: `${webUrl}/${locale}/messages?peer=${user.id}`,
                });
                const ok = await this.telegram.sendMessage(recipientUser.telegramId, text);
                if (ok) delivered = true;
                else skipped.push('telegram');
              }
            }

            if (!delivered) {
              deliveryStatus = 'FAILED';
              errorMessage = skipped.length
                ? `No available channels (${skipped.join(', ')})`
                : 'No delivery channels selected';
            } else {
              deliveryStatus = 'SENT';
              sentAt = new Date();
              if (skipped.length) errorMessage = `Skipped: ${skipped.join(', ')}`;
            }
          }
        } else {
          deliveryStatus = 'SENT';
          sentAt = new Date();
        }
      } catch (err) {
        deliveryStatus = 'FAILED';
        errorMessage = err instanceof Error ? err.message : 'Unknown error';
      }

      await this.prisma.bulkCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          deliveryStatus,
          errorMessage,
          conversationId,
          messageId,
          statusMoved,
          sentAt,
        },
      });
    }

    return this.getCampaign(user, campaign.id);
  }

  private async sendOutreachEmail(opts: {
    to: string;
    locale: MessageLocale;
    senderName: string;
    senderId: string;
    body: string;
  }) {
    const webUrl = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const t = (key: string, params?: Record<string, string | number>) =>
      translateMessage(key, opts.locale, params);
    const html = `<p>${t('email.greetingShort')}</p><p>${escapeHtml(opts.body).replace(/\n/g, '<br>')}</p><p><a href="${webUrl}/${opts.locale}/messages?peer=${opts.senderId}">${t(
      'email.chatMessage.cta',
    )}</a></p>
       <p style="color:#64748b;font-size:12px">${t('email.footer')}</p>`;
    const result = await this.mail.send(
      opts.to,
      t('email.chatMessage.subject', { name: opts.senderName }),
      html,
    );
    return Boolean(result) && !(result as { skipped?: boolean } | null)?.skipped;
  }

  // ── GDPR opt-out (candidate) ───────────────────────────────

  async getOptOut(user: AuthUser) {
    if (user.role !== 'EMPLOYEE' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only candidates can manage messaging preferences');
    }
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { userId: user.id },
      select: { bulkCommsOptOut: true, bulkCommsOptOutAt: true },
    });
    if (!profile) throw new NotFoundException('Complete your profile first');
    return {
      optedOut: profile.bulkCommsOptOut,
      optedOutAt: profile.bulkCommsOptOutAt,
    };
  }

  async setOptOut(user: AuthUser, optedOut: boolean) {
    if (user.role !== 'EMPLOYEE' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only candidates can manage messaging preferences');
    }
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) throw new NotFoundException('Complete your profile first');

    const updated = await this.prisma.employeeProfile.update({
      where: { id: profile.id },
      data: {
        bulkCommsOptOut: optedOut,
        bulkCommsOptOutAt: optedOut ? new Date() : null,
      },
      select: { bulkCommsOptOut: true, bulkCommsOptOutAt: true },
    });
    return {
      optedOut: updated.bulkCommsOptOut,
      optedOutAt: updated.bulkCommsOptOutAt,
    };
  }
}
