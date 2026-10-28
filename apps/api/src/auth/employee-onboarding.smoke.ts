import "reflect-metadata";
import assert from "node:assert/strict";
import { ConfigService } from "@nestjs/config";
import { AuthService } from "./auth.service";
async function main() {
  for (const status of ["IN_PROGRESS", "NOT_REQUIRED", "COMPLETED"]) {
    let refreshTokens = 0;
    const user = {
      id: "synthetic",
      fullName: "Synthetic Employee",
      email: "synthetic@example.test",
      role: "EMPLOYEE",
      tokenVersion: 0,
      memberships: [],
      employeeProfile: {
        id: "profile",
        onboardingStatus: status,
        onboardingStep: 3,
      },
    };
    const db = {
      user: { findUniqueOrThrow: async () => user },
      refreshToken: {
        create: async () => {
          refreshTokens++;
        },
        deleteMany: async () => ({ count: 0 }),
      },
    };
    const service = new AuthService(
      db as never,
      { signAsync: async () => "synthetic-token" } as never,
      new ConfigService({}),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const login = await service.sessionForUser(user.id);
    assert.deepEqual(login.user.employeeOnboarding, { status, step: 3 });
    assert.equal(refreshTokens, 1);
    const refreshed = await service.me(user.id);
    assert.equal(refreshed.user.employeeOnboarding?.status, status);
    assert.equal(refreshTokens, 1);
  }
  console.log(
    "Employee auth metadata: new, existing, completed and refreshed sessions passed",
  );
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
