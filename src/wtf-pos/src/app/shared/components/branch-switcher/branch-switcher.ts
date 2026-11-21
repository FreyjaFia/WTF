import { Component, inject, input } from '@angular/core';
import { BranchService } from '@core/services/branch.service';
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
  protected readonly allBranches = ALL_BRANCHES;

  protected choose(id: string): void {
    if (id === this.branchService.activeId()) {
      return;
    }

    // Only the saved choice changes before the reload, so screens never show the new branch over the old data.
    this.branchService.switchTo(id);
    window.location.reload();
  }
}
