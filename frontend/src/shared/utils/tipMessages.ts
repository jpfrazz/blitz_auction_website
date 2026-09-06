export const TIP_MESSAGES_KEY = 'eb-tip-messages';

export function getTipMessagesEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = localStorage.getItem(TIP_MESSAGES_KEY);
  return stored === null ? true : stored === 'true';
}