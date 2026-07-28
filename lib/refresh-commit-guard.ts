export type RefreshCommitToken = {
  epoch: number;
  sequence: number;
};

export const mayCommitRefresh = (
  token: RefreshCommitToken,
  currentEpoch: number,
  currentSequence: number
) =>
  token.epoch === currentEpoch && token.sequence === currentSequence;
