/** Public promotion state. No commerce, quota or employer identity data. */
export type JobPromotion = {
  active: boolean;
  boostActive: boolean;
  revalidateAt: string | null;
};
export type JobPlacement = 'ORGANIC' | 'BOOST';
