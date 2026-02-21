import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { environment } from '@environments/environment.development';
import {
  AddOnGroupDto,
  AddOnProductAssignmentDto,
  CreateProductAddOnPriceOverrideDto,
  CreateProductDto,
  ProductAddOnAssignmentDto,
  ProductAddOnPriceOverrideDto,
  ProductCategoryEnum,
  ProductDto,
  UpdateProductAddOnPriceOverrideDto,
  UpdateProductDto,
} from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/products`;

  public getProducts(query?: {
    searchTerm?: string | null;
    category?: ProductCategoryEnum | null;
    isAddOn?: boolean | null;
    isActive?: boolean | null;
  }): Observable<ProductDto[]> {
    let params = new HttpParams();

    if (query?.searchTerm) {
      params = params.set('searchTerm', query.searchTerm);
    }

    if (query?.category !== undefined && query?.category !== null) {
      params = params.set('category', String(query.category));
    }

    if (query?.isAddOn !== undefined && query?.isAddOn !== null) {
      params = params.set('isAddOn', String(query.isAddOn));
    }

    if (query?.isActive !== undefined && query?.isActive !== null) {
      params = params.set('isActive', String(query.isActive));
    }

    return this.http.get<ProductDto[]>(this.baseUrl, { params }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching products:', error);

        const errorMessage =
          error.status === 0
            ? 'Unable to connect to server. Please check your connection.'
            : 'Failed to fetch products. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public getProduct(id: string): Observable<ProductDto> {
    return this.http.get<ProductDto>(`${this.baseUrl}/${id}`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching product:', error);

        const errorMessage =
          error.status === 404
            ? 'Product not found.'
            : error.status === 0
              ? 'Unable to connect to server. Please check your connection.'
              : 'Failed to fetch product. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public createProduct(product: CreateProductDto): Observable<ProductDto> {
    return this.http.post<ProductDto>(this.baseUrl, product).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error creating product:', error);

        const errorMessage =
          error.status === 0
            ? 'Unable to connect to server. Please check your connection.'
            : 'Failed to create product. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public updateProduct(product: UpdateProductDto): Observable<ProductDto> {
    return this.http.put<ProductDto>(`${this.baseUrl}/${product.id}`, product).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error updating product:', error);

        const errorMessage =
          error.status === 404
            ? 'Product not found.'
            : error.status === 0
              ? 'Unable to connect to server. Please check your connection.'
              : 'Failed to update product. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public deleteProduct(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error deleting product:', error);

        const errorMessage =
          error.status === 404
            ? 'Product not found.'
            : error.status === 0
              ? 'Unable to connect to server. Please check your connection.'
              : 'Failed to delete product. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public uploadProductImage(productId: string, file: File): Observable<ProductDto> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<ProductDto>(`${this.baseUrl}/${productId}/images`, formData).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error uploading product image:', error);

        let errorMessage = 'Failed to upload image. Please try again later.';

        if (error.status === 400) {
          errorMessage = error.error || 'Invalid file. Please check file type and size.';
        } else if (error.status === 404) {
          errorMessage = 'Product not found.';
        } else if (error.status === 0) {
          errorMessage = 'Unable to connect to server. Please check your connection.';
        }

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public deleteProductImage(productId: string): Observable<ProductDto> {
    return this.http.delete<ProductDto>(`${this.baseUrl}/${productId}/images`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error deleting product image:', error);

        let errorMessage = 'Failed to delete image. Please try again later.';

        if (error.status === 404) {
          errorMessage = 'Product or image not found.';
        } else if (error.status === 0) {
          errorMessage = 'Unable to connect to server. Please check your connection.';
        }

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public getProductAddOns(productId: string): Observable<AddOnGroupDto[]> {
    return this.http.get<AddOnGroupDto[]>(`${this.baseUrl}/${productId}/addons`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching product add-ons:', error);

        const errorMessage =
          error.status === 404
            ? 'Product not found.'
            : error.status === 0
              ? 'Unable to connect to server. Please check your connection.'
              : 'Failed to fetch product add-ons. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public getLinkedProducts(addOnId: string): Observable<AddOnGroupDto[]> {
    return this.http.get<AddOnGroupDto[]>(`${this.baseUrl}/addons/${addOnId}/products`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching linked products:', error);

        const errorMessage =
          error.status === 404
            ? 'Product not found.'
            : error.status === 0
              ? 'Unable to connect to server. Please check your connection.'
              : 'Failed to fetch linked products. Please try again later.';

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public assignProductAddOns(productId: string, addOns: ProductAddOnAssignmentDto[]): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/${productId}/addons`, { productId, addOns }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error assigning product add-ons:', error);

        let errorMessage = 'Failed to assign add-ons. Please try again later.';

        if (error.status === 400) {
          errorMessage =
            error.error?.message || 'Invalid request. Please check the selected add-ons.';
        } else if (error.status === 404) {
          errorMessage = 'Product not found.';
        } else if (error.status === 0) {
          errorMessage = 'Unable to connect to server. Please check your connection.';
        }

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public assignLinkedProducts(addOnId: string, products: AddOnProductAssignmentDto[]): Observable<void> {
    return this.http
      .post<void>(`${this.baseUrl}/addons/${addOnId}/products`, { addOnId, products })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('Error assigning linked products:', error);

          let errorMessage = 'Failed to assign products. Please try again later.';

          if (error.status === 400) {
            errorMessage =
              error.error?.message || 'Invalid request. Please check the selected products.';
          } else if (error.status === 404) {
            errorMessage = 'Add-on not found.';
          } else if (error.status === 0) {
            errorMessage = 'Unable to connect to server. Please check your connection.';
          }

          return throwError(() => new Error(errorMessage));
        }),
      );
  }

  public getProductAddOnPriceOverrides(productId: string): Observable<ProductAddOnPriceOverrideDto[]> {
    return this.http.get<ProductAddOnPriceOverrideDto[]>(
      `${this.baseUrl}/${productId}/addon-price-overrides`,
    );
  }

  public createProductAddOnPriceOverride(
    payload: CreateProductAddOnPriceOverrideDto,
  ): Observable<ProductAddOnPriceOverrideDto> {
    return this.http
      .post<ProductAddOnPriceOverrideDto>(
        `${this.baseUrl}/${payload.productId}/addon-price-overrides`,
        payload,
      )
      .pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('Error creating add-on price override:', error);

          let errorMessage = 'Failed to create add-on price override. Please try again later.';

          if (error.status === 400) {
            errorMessage = error.error?.message || 'Invalid price override request.';
          } else if (error.status === 404) {
            errorMessage = 'Product or add-on not found.';
          } else if (error.status === 0) {
            errorMessage = 'Unable to connect to server. Please check your connection.';
          }

          return throwError(() => new Error(errorMessage));
        }),
      );
  }

  public updateProductAddOnPriceOverride(
    payload: UpdateProductAddOnPriceOverrideDto,
  ): Observable<ProductAddOnPriceOverrideDto> {
    return this.http
      .put<ProductAddOnPriceOverrideDto>(
        `${this.baseUrl}/${payload.productId}/addon-price-overrides/${payload.addOnId}`,
        payload,
      )
      .pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('Error updating add-on price override:', error);

          let errorMessage = 'Failed to update add-on price override. Please try again later.';

          if (error.status === 400) {
            errorMessage = error.error?.message || 'Invalid price override request.';
          } else if (error.status === 404) {
            errorMessage = 'Price override not found.';
          } else if (error.status === 0) {
            errorMessage = 'Unable to connect to server. Please check your connection.';
          }

          return throwError(() => new Error(errorMessage));
        }),
      );
  }

  public deleteProductAddOnPriceOverride(productId: string, addOnId: string): Observable<void> {
    return this.http
      .delete<void>(`${this.baseUrl}/${productId}/addon-price-overrides/${addOnId}`)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('Error deleting add-on price override:', error);

          let errorMessage = 'Failed to delete add-on price override. Please try again later.';

          if (error.status === 404) {
            errorMessage = 'Price override not found.';
          } else if (error.status === 0) {
            errorMessage = 'Unable to connect to server. Please check your connection.';
          }

          return throwError(() => new Error(errorMessage));
        }),
      );
  }
}
