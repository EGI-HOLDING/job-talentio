import { Global, Injectable, Module } from '@nestjs/common';

export type LiveResource = 'chat' | 'applications' | 'notifications';

/** Invalidation hints only. Clients always re-read authorized HTTP resources. */
@Injectable()
export class LiveUpdates {
  private listeners = new Set<(users: string[], resource: LiveResource) => void>();
  subscribe(listener: (users: string[], resource: LiveResource) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  publish(users: string[], resource: LiveResource) {
    for (const listener of this.listeners) {
      try { listener([...new Set(users)], resource); } catch { /* Polling recovers missed hints. */ }
    }
  }
}

@Global()
@Module({providers:[LiveUpdates],exports:[LiveUpdates]})
export class LiveUpdatesModule {}
