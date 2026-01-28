const LEGACY_FRAME_HOSTNAME = "46.224.249.136";
const LEGACY_FRAME_PORT = "9000";
const PUBLIC_FRAME_HOST = "https://s3.nextgroupintl.com";

export function normalizeFrameUrl(url: string): string {
  if (!url) {
    return url;
  }
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname === LEGACY_FRAME_HOSTNAME &&
      (parsed.port === LEGACY_FRAME_PORT || parsed.port === "")
    ) {
      return new URL(
        `${parsed.pathname}${parsed.search}${parsed.hash}`,
        PUBLIC_FRAME_HOST
      ).toString();
    }
  } catch {
    return url;
  }
  return url;
}
