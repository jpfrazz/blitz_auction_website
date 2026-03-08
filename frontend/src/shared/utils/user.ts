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
