"use client";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "@/lib/navigation";
import { api, getSession } from "@/lib/api";
import { safeAuthNext } from "@/lib/authReturn";
import { useI18n } from "@/lib/i18n";
import { WorkspaceLoading } from "@/components/employee/WorkspacePrimitives";
import { normalizeE164Phone } from "@job-talentio/shared";
export function EmployeeOnboardingGate({ children }: { children: ReactNode }) {
  const pathname = usePathname(),
    router = useRouter(),
    { t } = useI18n();
  const [verified, setVerified] = useState(""),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const protectedPage = /^\/(dashboard\/employee|settings|messages)(\/|$)/.test(
    pathname,
  );
  useEffect(() => {
    if (!protectedPage) {
      setVerified(pathname);
      return;
    }
    const session = getSession();
    if (session?.user.role !== "EMPLOYEE") {
      setVerified(pathname);
      return;
    }
    const controller = new AbortController();
    setError("");
    api<{ status: string; profile?: { phone?: string | null } }>("/profiles/me/onboarding", {
      signal: controller.signal,
    })
      .then((state) => {
        if (controller.signal.aborted) return;
        if (state.status === "IN_PROGRESS") {
          const next =
            safeAuthNext(
              window.location.pathname +
                window.location.search +
                window.location.hash,
            ) || "/jobs?mode=for-you";
          router.replace(
            "/onboarding/employee?next=" + encodeURIComponent(next),
          );
        } else if (!normalizeE164Phone(state.profile?.phone)) {
          const next =
            safeAuthNext(
              window.location.pathname +
                window.location.search +
                window.location.hash,
            ) || "/dashboard/employee";
          router.replace(
            "/onboarding/employee/phone?next=" + encodeURIComponent(next),
          );
        } else setVerified(pathname);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [pathname, protectedPage, retry, router]);
  if (protectedPage && verified !== pathname)
    return error ? (
      <div role="alert" style={{ padding: 32 }}>
        <p>{error}</p>
        <button onClick={() => setRetry((n) => n + 1)}>
          {t("workspace.retry")}
        </button>
      </div>
    ) : (
      <WorkspaceLoading />
    );
  return <>{children}</>;
}
