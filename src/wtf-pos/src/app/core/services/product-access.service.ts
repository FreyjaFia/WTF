import { inject, Injectable } from '@angular/core';
import { mayBranchEdit } from '@shared/calculations/product-availability';
import { ProductDto } from '@shared/models';
import { AuthService } from './auth.service';
import { BranchService } from './branch.service';

// Who may change which product. Mirrors the API: a person who works in every branch and holds products.write changes any
// product; a person limited to some branches changes only the products limited to their branches (products.write.branch).
@Injectable({ providedIn: 'root' })
export class ProductAccessService {
  private readonly auth = inject(AuthService);
  private readonly branches = inject(BranchService);

  public canAdd(): boolean {
    return this.auth.canAddProducts();
  }

  public canChange(product: Pick<ProductDto, 'soldAtBranchIds'>): boolean {
    if (this.auth.canWriteProducts() && (!this.branches.isMultiBranch() || this.branches.canSeeAll())) {
      return true;
    }

    return (
      this.auth.canWriteBranchProducts() &&
      mayBranchEdit(
        product.soldAtBranchIds,
        this.branches.branches().map((branch) => branch.id),
      )
    );
  }
}
