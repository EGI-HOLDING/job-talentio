-- Bound the same-member active-delivery lookup as post history grows.
CREATE INDEX "LinkedInSocialPost_authorUrnSnapshot_status_leaseUntil_idx"
ON "LinkedInSocialPost"("authorUrnSnapshot", "status", "leaseUntil");
