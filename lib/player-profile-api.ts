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
  const payload = {
    player_name: profile.playerName?.trim() || null,
    team_name: profile.teamName?.trim() || null,
    shirt_number: profile.shirtNumber ?? null
  };

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
