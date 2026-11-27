import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AchievementUpdatePayload,
  BlitzUpdate,
  DraftFinishedUpdatePayload,
  HallOfFameUpdatePayload,
  MatchRequestUpdatePayload,
  RankingMoveUpdatePayload,
} from '../../types';
import { deleteMatchRequest } from '../../shared/api/matchRequests';
import { fetchBlitzUpdates } from '../../shared/api/updates';
import { fetchCurrentUser } from '../../shared/api/draftData';
import { getAvatarUrl } from '../../shared/utils/user';
import MatchFinder from './MatchFinder';
import './BlitzUpdatesTicker.scss';

const DISCORD_INVITE = 'https://discord.com/invite/CsUSZ5UhzW';

const formatDraftType = (draftType: string): string => {
  switch (draftType) {
    case '1v1':
      return '1v1';
    case 'booster':
      return 'Booster';
    default:
      return 'Auction';
  }
};

const formatRelativeTime = (isoDate: string): string => {
  const elapsedSeconds = (Date.now() - new Date(isoDate).getTime()) / 1000;

  if (elapsedSeconds < -60) {
    const minutes = Math.ceil(-elapsedSeconds / 60);
    if (minutes < 60) return `in ${minutes}m`;
    const hours = Math.ceil(minutes / 60);
    if (hours < 48) return `in ${hours}h`;
    return `in ${Math.ceil(hours / 24)}d`;
  }

  if (elapsedSeconds < 60) return 'just now';
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

// Existing posts use "Draft"; the dropdown now shows that mode as "Auction".
const formatRaceMode = (mode: string): string => (mode === 'Draft' ? 'Auction' : mode);

const formatMatchTime = (isoDate: string): string =>
  new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(isoDate));

const formatPokemonName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/ /g, '-')
    .replace(/[.:']/g, '')
    .replace(/♀/g, '-f')
    .replace(/♂/g, '-m');

const getHref = (update: BlitzUpdate): string => {
  switch (update.event_type) {
    case 'draft_finished': {
      const payload = update.payload as DraftFinishedUpdatePayload;
      return `/Spectate/${encodeURIComponent(payload.draft_id)}`;
    }
    case 'achievement': {
      const payload = update.payload as AchievementUpdatePayload;
      return `/Stats/PlayerProfiles/${encodeURIComponent(payload.user_name)}?userId=${encodeURIComponent(payload.user_id)}`;
    }
    case 'hall_of_fame':
      return '/Stats/HallOfFame';
    case 'ranking_move':
      return '/Stats/Pokemon';
    case 'match_request':
      return DISCORD_INVITE;
    default:
      return '/';
  }
};

const getAvatarUserId = (update: BlitzUpdate): string | null => {
  switch (update.event_type) {
    case 'draft_finished':
      return (update.payload as DraftFinishedUpdatePayload).user_id ?? null;
    case 'achievement':
    case 'hall_of_fame':
      return (update.payload as AchievementUpdatePayload | HallOfFameUpdatePayload).user_id;
    case 'match_request': {
      const payload = update.payload as MatchRequestUpdatePayload;
      return payload.mode === 'Draft' ? payload.user_id : null;
    }
    default:
      return null;
  }
};

const UpdateAvatar: React.FC<{ userId: string }> = ({ userId }) => {
  const [failed, setFailed] = useState(false);

  return (
    <img
      className="blitz-update-avatar"
      src={failed ? '/generic/DiscordAvatar.png' : getAvatarUrl(userId)}
      alt=""
      onError={() => setFailed(true)}
    />
  );
};

const UpdateMiniIcon: React.FC<{ name: string }> = ({ name }) => (
  <img
    className="blitz-update-mini-icon"
    src={`/MiniIcons/${formatPokemonName(name)}.png`}
    alt=""
    onError={(event) => {
      // Keep the space reserved so the sentence doesn't jump around if an
      // icon is missing for a newly added form.
      event.currentTarget.style.visibility = 'hidden';
    }}
  />
);

const TrashIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
    <path d="M10 11v5M14 11v5" />
  </svg>
);

const UpdateText: React.FC<{ update: BlitzUpdate }> = ({ update }) => {
  switch (update.event_type) {
    case 'draft_finished': {
      const payload = update.payload as DraftFinishedUpdatePayload;
      const userName = payload.user_name || payload.draft_name;
      return (
        <>
          <span className="blitz-update-name">
            <strong>{userName}</strong>&apos;s
          </span>{' '}
          {formatDraftType(payload.draft_type)} Draft just finished.{' '}
          <span className="blitz-update-emphasis">Spectate now!</span>
        </>
      );
    }
    case 'achievement': {
      const payload = update.payload as AchievementUpdatePayload;
      return (
        <>
          <strong>{payload.user_name}</strong> earned{' '}
          <span className="blitz-update-emphasis">{payload.achievement_name}!</span>
        </>
      );
    }
    case 'hall_of_fame': {
      const payload = update.payload as HallOfFameUpdatePayload;
      return (
        <>
          <strong>{payload.user_name}</strong> entered the{' '}
          <span className="blitz-update-emphasis">Hall of Fame!</span>
        </>
      );
    }
    case 'ranking_move': {
      const payload = update.payload as RankingMoveUpdatePayload;
      return (
        <>
          <UpdateMiniIcon name={payload.name} />
          <strong>{payload.name}</strong> moved from <strong>#{payload.from_rank}</strong> to{' '}
          <strong>#{payload.to_rank}</strong> in all time cost rankings!{' '}
          <span className="blitz-update-emphasis">View the chart!</span>
        </>
      );
    }
    case 'match_request': {
      const payload = update.payload as MatchRequestUpdatePayload;
      return (
        <>
          <strong>{payload.user_name}</strong> is looking to play{' '}
          <span className="blitz-update-emphasis">{formatRaceMode(payload.mode)}</span> at{' '}
          <span className="blitz-update-emphasis blitz-update-match-time">
            {formatMatchTime(payload.requested_at)}
          </span>
          {'! Ping them in the discord for more info!'}
        </>
      );
    }
    default:
      return null;
  }
};

const UpdateRow: React.FC<{
  update: BlitzUpdate;
  currentUserId: string | null;
  deleting: boolean;
  onDelete: (id: number) => void;
}> = ({ update, currentUserId, deleting, onDelete }) => {
  const avatarUserId = getAvatarUserId(update);
  const matchPayload =
    update.event_type === 'match_request'
      ? (update.payload as MatchRequestUpdatePayload)
      : null;
  const canDeleteMatch =
    !!matchPayload && !!currentUserId && matchPayload.user_id === currentUserId;
  const isPastMatch =
    update.event_type === 'match_request' &&
    new Date(update.created_at).getTime() < Date.now();
  const className = [
    'blitz-update-row',
    `blitz-update-${update.event_type}`,
    isPastMatch ? 'blitz-update-past' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <tr className={className}>
      <td className="blitz-update-main">
        <div className="blitz-update-row-content">
          <a
            className="blitz-update-link"
            href={getHref(update)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {avatarUserId && <UpdateAvatar userId={avatarUserId} />}
            <span className="blitz-update-text">
              <UpdateText update={update} />
            </span>
          </a>
          <span className="blitz-update-time">{formatRelativeTime(update.created_at)}</span>
          {canDeleteMatch && matchPayload && (
            <button
              type="button"
              className="blitz-update-delete"
              aria-label="Delete this race request"
              title="Delete this race request"
              disabled={deleting}
              onClick={() => onDelete(matchPayload.id)}
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};

const BlitzUpdatesTicker: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: updates = [] } = useQuery({
    queryKey: ['blitz-updates'],
    queryFn: () => fetchBlitzUpdates(30),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
  const { data: currentUser } = useQuery({
    queryKey: ['current-user'],
    queryFn: fetchCurrentUser,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMatchRequest,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['blitz-updates'] });
    },
  });

  const currentUserId = currentUser && !currentUser.is_guest ? currentUser.user_id : null;

  return (
    <section className="blitz-updates" aria-labelledby="blitz-updates-title">
      <h2 id="blitz-updates-title">Blitz Updates</h2>
      <div className="blitz-updates-viewport">
        {updates.length === 0 ? (
          <div className="blitz-updates-empty">No recent Blitz updates yet.</div>
        ) : (
          <table className="blitz-updates-table">
            <tbody>
              {updates.map((update) => (
                <UpdateRow
                  key={update.id}
                  update={update}
                  currentUserId={currentUserId}
                  deleting={deleteMutation.isPending}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
      <MatchFinder />
    </section>
  );
};

export default BlitzUpdatesTicker;
