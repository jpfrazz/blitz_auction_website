import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MatchRequest } from '../../types';
import { createMatchRequest } from '../../shared/api/matchRequests';
import { fetchCurrentUser } from '../../shared/api/draftData';
import './MatchFinder.scss';

// "Auction" is the user-facing name for the Draft race mode. The stored value
// stays "Draft" so existing posts and the backend check constraint keep working.
const MODES: Array<{ value: MatchRequest['mode']; label: string }> = [
  { value: '1v1', label: '1v1' },
  { value: 'Booster', label: 'Booster' },
  { value: 'Draft', label: 'Auction' },
];
const MAX_REQUEST_HOURS = 48;

const pad = (value: number): string => String(value).padStart(2, '0');

const toLocalInputValue = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

const defaultTimeValue = (): string => {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15);
  return toLocalInputValue(date);
};

const minTimeValue = (now: number): string =>
  toLocalInputValue(new Date(Math.ceil(now / 60_000) * 60_000));

const maxTimeValue = (now: number): string =>
  toLocalInputValue(new Date(Math.floor((now + MAX_REQUEST_HOURS * 3_600_000) / 60_000) * 60_000));

const isTimeAllowed = (value: string, now: number): boolean => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= now && time <= now + MAX_REQUEST_HOURS * 3_600_000;
};

const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data;
    if (typeof detail === 'string' && detail.trim()) return detail;
  }
  return 'Could not post your race request. Please try again.';
};

const MatchFinder: React.FC = () => {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<MatchRequest['mode']>('1v1');
  const [timeValue, setTimeValue] = useState(defaultTimeValue);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const { data: user, isLoading: isUserLoading } = useQuery({
    queryKey: ['current-user'],
    queryFn: fetchCurrentUser,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const canPost = !!user && !user.is_guest;
  const timeAllowed = isTimeAllowed(timeValue, now);
  const showTimeError = !error && !timeAllowed && !!timeValue;
  const hasStatus = !!error || showTimeError;

  const mutation = useMutation({
    mutationFn: createMatchRequest,
    onSuccess: () => {
      setError(null);
      setTimeValue(defaultTimeValue());
      void queryClient.invalidateQueries({ queryKey: ['blitz-updates'] });
    },
    onError: (submitError) => setError(getErrorMessage(submitError)),
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canPost || !timeAllowed || mutation.isPending) return;

    setError(null);
    mutation.mutate({
      mode,
      requested_at: new Date(timeValue).toISOString(),
    });
  };

  if (isUserLoading || !user) {
    return (
      <div className="match-finder-row">
        <span className="match-finder-label">Looking for a Race?</span>
        <span className="match-finder-hint">Checking login…</span>
      </div>
    );
  }

  if (user.is_guest) {
    return (
      <div className="match-finder-row">
        <span className="match-finder-label">Looking for a Race?</span>
        <span className="match-finder-hint">
          <a href="/api/login">Log in with Discord</a> to post a race request.
        </span>
      </div>
    );
  }

  return (
    <>
      <form className="match-finder-row" onSubmit={handleSubmit}>
        <span className="match-finder-label">Looking for a Race?</span>

        <label className="match-finder-field">
          <span>Mode</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as MatchRequest['mode'])}
          >
            {MODES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="match-finder-field">
          <span>Time</span>
          <input
            type="datetime-local"
            value={timeValue}
            min={minTimeValue(now)}
            max={maxTimeValue(now)}
            title="Your local time, up to 48 hours from now"
            onChange={(event) => setTimeValue(event.target.value)}
          />
        </label>

        <button type="submit" disabled={!timeAllowed || mutation.isPending}>
          {mutation.isPending ? 'Sending…' : 'Send'}
        </button>
      </form>

      {hasStatus && (
        <div className="match-finder-status" aria-live="polite">
          {error && <span className="match-finder-error">{error}</span>}
          {showTimeError && (
            <span className="match-finder-error">
              Choose a time from now through {MAX_REQUEST_HOURS} hours ahead.
            </span>
          )}
        </div>
      )}
    </>
  );
};

export default MatchFinder;
