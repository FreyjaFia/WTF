import { Component, inject } from '@angular/core';
import { BranchService } from '@core/services/branch.service';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { ALL_BRANCHES } from '@shared/models';

@Component({
  selector: 'app-branch-switcher',
  imports: [IconComponent],
  templateUrl: './branch-switcher.html',
})
export class BranchSwitcherComponent {
  protected readonly branchService = inject(BranchService);
  protected readonly allBranches = ALL_BRANCHES;

  protected choose(id: string): void {
    if (id === this.branchService.activeId()) {
      return;
    }

    this.branchService.select(id);
    // Every open screen holds one branch's data, so the app starts over on the new branch.
    window.location.reload();
  }
}
