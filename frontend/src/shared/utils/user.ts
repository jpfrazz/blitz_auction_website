export type SerializedUser =
  | { GuestUser: { user_id: string; user_name: string } }
  | { DiscordUser: {
    id?: string | null;
    user_id?: string;
    user_name?: string;
    username?: string;
    global_name?: string | null;
    roles?: Array<{ role_id: string; role_name: string }>;
} };

export function getUserLabel(user: string | SerializedUser | null | undefined): string {
  if (!user) {
    return '';
  }
  if (typeof user === 'string') {
    return user;
  }
  if ('GuestUser' in user) {
    return user.GuestUser.user_name || user.GuestUser.user_id;
  }
  if ('DiscordUser' in user) {
    return (
      user.DiscordUser.global_name
      || user.DiscordUser.user_name
      || user.DiscordUser.username
      || user.DiscordUser.user_id
      || user.DiscordUser.id
      || ''
    );
  }
  return '';
}

export function getUserId(user: string | SerializedUser | null | undefined): string | null {
  if (!user) {
    return null;
  }
  if (typeof user === 'string') {
    return user;
  }
  if ('GuestUser' in user) {
    return user.GuestUser.user_id;
  }
  if ('DiscordUser' in user) {
    return user.DiscordUser.user_id ?? user.DiscordUser.id ?? null;
  }
  return null;
}

export function getDiscordAvatarUrl(userId: string, hash: string): string {
  const ext = hash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.${ext}`;
}

export function getCachedAvatarUrl(userId: string, hash?: string | null): string {
  return hash ? `/api/avatar/${userId}?v=${hash}` : `/api/avatar/${userId}`;
}

/**
 * Fallback chain for avatar <img> tags: the live Discord CDN URL first, then
 * the cached copy served by /api/avatar/{user_id}, and finally the placeholder.
 */
export function onAvatarError(
  e: { currentTarget: HTMLImageElement },
  userId: string,
  hash?: string | null,
): void {
  const img = e.currentTarget;
  if (!img.dataset.fallback) {
    img.dataset.fallback = 'cached';
    img.src = getCachedAvatarUrl(userId, hash);
  } else {
    img.src = '/generic/DiscordAvatar.png';
  }
}
