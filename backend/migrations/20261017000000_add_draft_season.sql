-- Season tracking for Ever Grande Prix races.
-- drafts.season = 1 is the default (Season One); drafts marked 2 are
-- "Season2" races: they earn points on the Season 2 Standings leaderboard
-- and never contribute ELO / win-loss.
ALTER TABLE drafts ADD COLUMN season INT NOT NULL DEFAULT 1;
