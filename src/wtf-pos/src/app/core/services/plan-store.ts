import { Injectable, computed, signal } from '@angular/core';
import { CORE_FEATURE } from '@shared/calculations/plan-features';
import { SubscriptionDto } from '@shared/models/subscription.models';
import { currentTenantId } from './tenant-context';

const PLAN_STORAGE_KEY = 'wtf-plan-snapshot';

export interface PlanSnapshot {
  tenantId: string;
  planName: string | null;
  features: string[] | null;
  plansByFeature: Record<string, string[]>;
}

function readSnapshot(): PlanSnapshot | null {
  try {
    const raw = localStorage.getItem(PLAN_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<PlanSnapshot>) : null;

    if (parsed && parsed.tenantId === currentTenantId() && typeof parsed.plansByFeature === 'object') {
      return parsed as PlanSnapshot;
    }
  } catch {
    // An unreadable snapshot is the same as none.
  }

  return null;
}

@Injectable({ providedIn: 'root' })
export class PlanStore {
  private readonly snapshot = signal<PlanSnapshot | null>(readSnapshot());

  public readonly isKnown = computed(() => this.snapshot()?.features != null);
  public readonly planName = computed(() => this.snapshot()?.planName ?? null);

  public hasFeature(key: string): boolean {
    const features = this.snapshot()?.features;

    // Until the plan is known (or when the shop has no subscription row) the permission list is the only gate.
    if (key === CORE_FEATURE || features == null) {
      return true;
    }

    return features.includes(key);
  }

  public plansHaving(key: string): string[] {
    return this.snapshot()?.plansByFeature[key] ?? [];
  }

  public apply(dto: SubscriptionDto): void {
    const next: PlanSnapshot = {
      tenantId: currentTenantId(),
      planName: dto.planName,
      features: dto.managed ? dto.features : null,
      plansByFeature: dto.plansByFeature ?? {},
    };

    this.snapshot.set(next);

    try {
      localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage can be full or blocked; the plan is then known until the app is closed.
    }
  }

  public clear(): void {
    this.snapshot.set(null);
    localStorage.removeItem(PLAN_STORAGE_KEY);
  }
}
