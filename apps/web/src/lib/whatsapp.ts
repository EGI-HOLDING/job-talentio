/** Convert a validated E.164 phone number into WhatsApp's public chat URL. */
export function whatsAppChatUrl(phone: string | null | undefined) {
  if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) return null;
  return 'https://wa.me/' + phone.slice(1);
}
