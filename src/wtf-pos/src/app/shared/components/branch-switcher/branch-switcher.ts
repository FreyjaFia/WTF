import { Component, inject, input } from '@angular/core';
import { BranchService } from '@core/services/branch.service';
import { ConnectivityService } from '@core/services/connectivity.service';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { ALL_BRANCHES } from '@shared/models';

@Component({
  selector: 'app-branch-switcher',
  imports: [IconComponent],
  templateUrl: './branch-switcher.html',
})
export class BranchSwitcherComponent {
  public readonly align = input<'start' | 'end'>('end');
  public readonly compact = input(false);

  protected readonly branchService = inject(BranchService);
  private readonly connectivity = inject(ConnectivityService);
  protected readonly allBranches = ALL_BRANCHES;

  protected readonly isOffline = (): boolean => !this.connectivity.isOnline();

  // Offline there is no menu to load for another branch, so only the branch whose menu is saved on this device can be opened.
  protected canChoose(id: string): boolean {
    return this.connectivity.isOnline() || this.branchService.menuBranchId() === id;
  }

  protected choose(id: string): void {
    if (!this.canChoose(id)) {
      return;
    }

    if (id === this.branchService.activeId()) {
      return;
    }

    // Only the saved choice changes before the reload, so screens never show the new branch over the old data.
    this.branchService.switchTo(id);
    window.location.reload();
  }
}
