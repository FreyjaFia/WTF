import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '@core/services';
import { HubGroup, visibleGroups, managementGroups } from '@shared/navigation/hub-groups';

@Component({
  selector: 'app-management-hub',
  imports: [RouterLink],
  templateUrl: './management-hub.html',
  host: { class: 'flex-1 min-h-0' },
})
export class ManagementHubComponent {
  private readonly authService = inject(AuthService);

  protected readonly groups = computed<HubGroup[]>(() =>
    visibleGroups(managementGroups(this.authService)),
  );
}
