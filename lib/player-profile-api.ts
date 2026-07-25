export type PlayerProfileInput = {
  playerName?: string;
  teamName?: string;
  shirtNumber?: number;
};

const API_PREFIX = "/api/backend";

const readMessage = async (response: Response) => {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string };
      message?: string;
    };
    return payload.error?.message ?? payload.message ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
};

export const savePlayerProfile = async (
  jobId: string,
  profile: PlayerProfileInput
): Promise<void> => {
  const payload: Record<string, unknown> = {};
  const playerName = profile.playerName?.trim();
  const teamName = profile.teamName?.trim();

  if (playerName) payload.player_name = playerName;
  if (teamName) payload.team_name = teamName;
  if (profile.shirtNumber !== undefined) payload.shirt_number = profile.shirtNumber;

  if (Object.keys(payload).length === 0) return;

  const response = await fetch(
    `${API_PREFIX}/jobs/${encodeURIComponent(jobId)}/player-profile`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    throw new Error(await readMessage(response));
  }
};
