'use client';

import { useI18n } from '@/lib/i18n';
import { sanitizeMojibake } from '@/lib/text';
import { isLocale, type Locale } from '@/lib/locale';
import { BusyOverlay } from '@/components/ui/BusyOverlay';

const LOCALE_LABEL_KEY: Record<Locale, string> = {
  uz: 'ui.localeUz',
  ru: 'ui.localeRu',
  en: 'ui.localeEn',
  id: 'ui.localeId',
};

type Props = {
  text: string;
  /** Language the text is actually written in, as reported by the API. */
  contentLocale?: string | null;
  isMachineTranslated?: boolean;
  /** Keep author line breaks (job descriptions, article bodies). */
  preserveLineBreaks?: boolean;
  className?: string;
  /** Offered only when the server says machine translation is available. */
  onTranslate?: () => void;
  translating?: boolean;
  /** Reading layout; keeps all original words and punctuation. */
  paragraphs?: boolean;
};

/**
 * Renders author-written content and tells the reader when it is not in the
 * language they picked, so a posting written in Uzbek never looks like a bug
 * on the Russian site.
 */
export function UgcText({
  text,
  contentLocale,
  isMachineTranslated = false,
  preserveLineBreaks = false,
  className,
  onTranslate,
  translating = false,
  paragraphs = false,
}: Props) {
  const { t, locale } = useI18n();
  const clean = sanitizeMojibake(text);
  const showNotice = Boolean(contentLocale) && contentLocale !== locale;
  const blocks = paragraphs ? clean.split(/\n+/).flatMap((block) => {
    if (block.length < 650) return block.trim() ? [block] : [];
    const sentences = block.split(/(?<=[.!?])\s+(?=[A-ZА-ЯЁ])/u);
    const chunks: string[] = [];
    for (let index = 0; index < sentences.length; index += 3) chunks.push(sentences.slice(index, index + 3).join(' '));
    return chunks;
  }) : [];

  return (
    <BusyOverlay active={translating} label={t('ui.translating')} className={className}>
      {showNotice && (
        <p className="ugc-notice muted">
          {isMachineTranslated
            ? t('ui.autoTranslated')
            : t('ui.writtenInLanguage').replace(
                '{language}',
                isLocale(contentLocale) ? t(LOCALE_LABEL_KEY[contentLocale]) : String(contentLocale),
              )}
          {onTranslate && !isMachineTranslated && (
            <button
              type="button"
              className="ghost ugc-notice-action"
              onClick={onTranslate}
              disabled={translating}
            >
              {translating ? t('ui.translating') : t('ui.translateThis')}
            </button>
          )}
        </p>
      )}
      <div style={preserveLineBreaks && !paragraphs ? { whiteSpace: 'pre-wrap' } : undefined}>{paragraphs ? blocks.map((block, index) => <p key={index}>{block}</p>) : clean}</div>
    </BusyOverlay>
  );
}
