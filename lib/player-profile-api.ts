import { request } from "./workflow-api";

export type PlayerProfileInput = {
  playerName?: string;
  teamName?: string;
  shirtNumber?: number;
};

export const savePlayerProfile = async (
  jobId: string,
  profile: PlayerProfileInput,
  expectedAnalysisAttemptId?: string | null
): Promise<void> => {
  const payload = {
    player_name: profile.playerName?.trim() || null,
    team_name: profile.teamName?.trim() || null,
    shirt_number: profile.shirtNumber ?? null
  };

  await request(
    `/jobs/${encodeURIComponent(jobId)}/player-profile`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(expectedAnalysisAttemptId
          ? { "X-Analysis-Attempt-Id": expectedAnalysisAttemptId }
          : {})
      },
      body: JSON.stringify(payload)
    }
  );
};
