/** Access JWTs signed before tokenVersion existed omit `tv`; treat that as 0. */
export function accessTokenIsCurrent(payloadTv: number | undefined, tokenVersion: number): boolean {
  return (payloadTv ?? 0) === tokenVersion;
}
