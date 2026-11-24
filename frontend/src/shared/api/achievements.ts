import axios from 'axios';

export interface ManualAchievementOverride {
  achievement_id: string;
  earned: boolean;
}

export async function fetchManualAchievements(
  userId: string,
): Promise<ManualAchievementOverride[]> {
  const response = await axios.get(`/api/achievements/manual/${encodeURIComponent(userId)}`);
  return response.data;
}

export async function setManualAchievement(
  userId: string,
  achievementId: string,
  earned: boolean,
): Promise<void> {
  await axios.post(`/api/admin/achievements/${encodeURIComponent(userId)}`, {
    achievement_id: achievementId,
    earned,
  });
}
