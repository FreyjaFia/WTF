import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { AlertService, ModalStackService, ProductService } from '@core/services';
import { AvatarComponent } from '@shared/components/avatar/avatar';
import { IconComponent } from '@shared/components/icons/icon/icon';
import { AddOnTypeEnum, ProductDto } from '@shared/models';
import Sortable from 'sortablejs';

@Component({
  selector: 'app-addons-swapper',
  imports: [CommonModule, IconComponent, AvatarComponent],
  templateUrl: './addons-swapper.html',
  styleUrls: ['./addons-swapper.css'],
})
export class AddonsSwapperComponent implements AfterViewInit {
  private readonly modalStack = inject(ModalStackService);
  private readonly productService = inject(ProductService);
  private readonly alertService = inject(AlertService);

  private modalStackId: number | null = null;

  @ViewChild('availableList') private availableList!: ElementRef;
  @ViewChild('assignedList') private assignedList!: ElementRef;

  protected readonly isLoading = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly availableAddOns = signal<(ProductDto & { type: AddOnTypeEnum })[]>([]);
  protected readonly assignedAddOns = signal<(ProductDto & { type: AddOnTypeEnum })[]>([]);
  protected readonly searchTerm = signal('');

  protected readonly AddOnTypeEnum = AddOnTypeEnum;

  protected readonly addOnTypeOptions = [
    { value: AddOnTypeEnum.Size, label: 'Size' },
    { value: AddOnTypeEnum.Flavor, label: 'Flavor' },
    { value: AddOnTypeEnum.Topping, label: 'Topping' },
    { value: AddOnTypeEnum.Extra, label: 'Extra' },
    { value: AddOnTypeEnum.Sauce, label: 'Sauce' },
  ];

  protected readonly filteredAvailableAddOns = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();

    if (!term) {
      return this.availableAddOns();
    }

    return this.availableAddOns().filter((addon) => addon.name.toLowerCase().includes(term));
  });

  public productId = '';

  public ngAfterViewInit(): void {
    if (this.productId) {
      this.loadAddOns();
    }
  }

  private loadAddOns(): void {
    this.isLoading.set(true);

    // Load all available add-ons (products marked as add-ons)
    this.productService.getProducts({ isAddOn: true, isActive: true }).subscribe({
      next: (allAddOns) => {
        // Now get the currently assigned add-ons for this product (grouped by type)
        this.productService.getProductAddOns(this.productId).subscribe({
          next: (addOnGroups) => {
            // Flatten the groups into a list with type info
            const assignedFlat = addOnGroups.flatMap((group) =>
              group.options.map((option) => ({ ...option, type: group.type })),
            );

            const assignedIds = new Set(assignedFlat.map((addon) => addon.id));

            // Split: available (not assigned) on left, assigned on right
            const availableNotAssigned = allAddOns
              .filter((addon) => !assignedIds.has(addon.id))
              .map((addon) => ({ ...addon, type: AddOnTypeEnum.Size })); // Default type for available

            this.availableAddOns.set(this.sortByName(availableNotAssigned));
            this.assignedAddOns.set(this.sortByName(assignedFlat));
            this.isLoading.set(false);

            // Initialize Sortable after data is loaded and DOM is populated
            this.initializeSortable();
          },
          error: (err) => {
            this.alertService.error(err.message);
            this.isLoading.set(false);
          },
        });
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
      },
    });
  }

  private initializeSortable(): void {
    setTimeout(() => {
      if (!this.availableList || !this.assignedList) {
        return;
      }

      const options = {
        group: 'addons-swap',
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'opacity-50',
        dragClass: '!rounded-none',
        onEnd: () => {
          // Sync signals with current DOM state after drag completes
          this.syncSignalsWithDOM();
        },
      };

      new Sortable(this.availableList.nativeElement, options);
      new Sortable(this.assignedList.nativeElement, options);
    }, 100);
  }

  private syncSignalsWithDOM(): void {
    if (!this.availableList || !this.assignedList) {
      return;
    }

    // Get all item IDs currently in the assigned list DOM
    const assignedIds = new Set(
      Array.from(this.assignedList.nativeElement.querySelectorAll('[data-id]')).map(
        (el) => (el as HTMLElement).getAttribute('data-id') || '',
      ),
    );

    // Build a lookup of all known add-ons
    const allAddOns = [...this.availableAddOns(), ...this.assignedAddOns()];
    const addOnById = new Map(allAddOns.map((addon) => [addon.id, addon]));

    // Available = everything not assigned (includes filtered-out items)
    this.availableAddOns.set(
      this.sortByName(allAddOns.filter((addon) => !assignedIds.has(addon.id))),
    );

    // Assigned = items in the assigned DOM, preserving order
    const assignedIdsArray = Array.from(
      this.assignedList.nativeElement.querySelectorAll('[data-id]'),
    ).map((el) => (el as HTMLElement).getAttribute('data-id') || '');

    this.assignedAddOns.set(
      assignedIdsArray
        .map((id) => addOnById.get(id))
        .filter((addon): addon is ProductDto & { type: AddOnTypeEnum } => !!addon),
    );
  }

  protected saveAddOns(): void {
    if (!this.assignedList) {
      return;
    }

    // Get the current assigned add-ons with their type info
    const addOns = this.assignedAddOns().map((addon) => ({
      addOnId: addon.id,
      addOnType: addon.type,
    }));

    this.isSaving.set(true);

    this.productService.assignProductAddOns(this.productId, addOns).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.alertService.successSaved('Product add-ons');
        this.closeModal();
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isSaving.set(false);
      },
    });
  }

  protected closeModal(): void {
    // Close the modal - implementation depends on how parent handles this
    const modal = document.querySelector('#addons-swapper-modal') as HTMLDialogElement;

    if (modal) {
      modal.close();
    }

    if (this.modalStackId !== null) {
      this.modalStack.remove(this.modalStackId);
      this.modalStackId = null;
    }
  }

  public registerOnStack(): void {
    this.modalStackId = this.modalStack.push(() => this.closeModal());
  }

  protected onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchTerm.set(input.value);
  }

  protected changeAddOnType(addonId: string, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const newType = Number(select.value) as AddOnTypeEnum;

    this.assignedAddOns.set(
      this.assignedAddOns().map((a) => (a.id === addonId ? { ...a, type: newType } : a)),
    );
  }

  private sortByName<T extends { name: string }>(items: T[]): T[] {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }
}
