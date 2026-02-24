import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ConnectivityService } from '@core/services/connectivity.service';
import { HttpErrorMessages, ServiceErrorMessages } from '@core/services/http-error-messages';
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
  private static readonly MSG_NETWORK_UNAVAILABLE = HttpErrorMessages.NetworkUnavailable;
  private static readonly MSG_INVALID_FILE = HttpErrorMessages.InvalidFile;
  private static readonly MSG_PRODUCT_NOT_FOUND = ServiceErrorMessages.Product.ProductNotFound;
  private static readonly MSG_PRODUCT_OR_IMAGE_NOT_FOUND =
    ServiceErrorMessages.Product.ProductOrImageNotFound;
  private static readonly MSG_ADD_ON_NOT_FOUND = ServiceErrorMessages.Product.AddOnNotFound;
  private static readonly MSG_PRODUCT_OR_ADD_ON_NOT_FOUND =
    ServiceErrorMessages.Product.ProductOrAddOnNotFound;
  private static readonly MSG_PRICE_OVERRIDE_NOT_FOUND =
    ServiceErrorMessages.Product.PriceOverrideNotFound;
  private static readonly MSG_FETCH_PRODUCTS_FAILED = ServiceErrorMessages.Product.FetchProductsFailed;
  private static readonly MSG_FETCH_PRODUCT_FAILED = ServiceErrorMessages.Product.FetchProductFailed;
  private static readonly MSG_CREATE_PRODUCT_FAILED = ServiceErrorMessages.Product.CreateProductFailed;
  private static readonly MSG_UPDATE_PRODUCT_FAILED = ServiceErrorMessages.Product.UpdateProductFailed;
  private static readonly MSG_DELETE_PRODUCT_FAILED = ServiceErrorMessages.Product.DeleteProductFailed;
  private static readonly MSG_UPLOAD_IMAGE_FAILED = ServiceErrorMessages.Product.UploadImageFailed;
  private static readonly MSG_DELETE_IMAGE_FAILED = ServiceErrorMessages.Product.DeleteImageFailed;
  private static readonly MSG_FETCH_PRODUCT_ADDONS_FAILED =
    ServiceErrorMessages.Product.FetchProductAddOnsFailed;
  private static readonly MSG_FETCH_LINKED_PRODUCTS_FAILED =
    ServiceErrorMessages.Product.FetchLinkedProductsFailed;
  private static readonly MSG_ASSIGN_ADDONS_FAILED = ServiceErrorMessages.Product.AssignAddOnsFailed;
  private static readonly MSG_INVALID_ADDONS_REQUEST = ServiceErrorMessages.Product.InvalidAddOnsRequest;
  private static readonly MSG_ASSIGN_PRODUCTS_FAILED = ServiceErrorMessages.Product.AssignProductsFailed;
  private static readonly MSG_INVALID_PRODUCTS_REQUEST =
    ServiceErrorMessages.Product.InvalidProductsRequest;
  private static readonly MSG_CREATE_PRICE_OVERRIDE_FAILED =
    ServiceErrorMessages.Product.CreatePriceOverrideFailed;
  private static readonly MSG_UPDATE_PRICE_OVERRIDE_FAILED =
    ServiceErrorMessages.Product.UpdatePriceOverrideFailed;
  private static readonly MSG_DELETE_PRICE_OVERRIDE_FAILED =
    ServiceErrorMessages.Product.DeletePriceOverrideFailed;
  private static readonly MSG_INVALID_PRICE_OVERRIDE_REQUEST =
    ServiceErrorMessages.Product.InvalidPriceOverrideRequest;

  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
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
            ? this.getNetworkErrorMessage()
            : ProductService.MSG_FETCH_PRODUCTS_FAILED;

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
            ? ProductService.MSG_PRODUCT_NOT_FOUND
            : error.status === 0
              ? this.getNetworkErrorMessage()
              : ProductService.MSG_FETCH_PRODUCT_FAILED;

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
            ? this.getNetworkErrorMessage()
            : ProductService.MSG_CREATE_PRODUCT_FAILED;

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
            ? ProductService.MSG_PRODUCT_NOT_FOUND
            : error.status === 0
              ? this.getNetworkErrorMessage()
              : ProductService.MSG_UPDATE_PRODUCT_FAILED;

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
            ? ProductService.MSG_PRODUCT_NOT_FOUND
            : error.status === 0
              ? this.getNetworkErrorMessage()
              : ProductService.MSG_DELETE_PRODUCT_FAILED;

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

        let errorMessage: string = ProductService.MSG_UPLOAD_IMAGE_FAILED;

        if (error.status === 400) {
          errorMessage = error.error || ProductService.MSG_INVALID_FILE;
        } else if (error.status === 404) {
          errorMessage = ProductService.MSG_PRODUCT_NOT_FOUND;
        } else if (error.status === 0) {
          errorMessage = this.getNetworkErrorMessage();
        }

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public deleteProductImage(productId: string): Observable<ProductDto> {
    return this.http.delete<ProductDto>(`${this.baseUrl}/${productId}/images`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error deleting product image:', error);

        let errorMessage: string = ProductService.MSG_DELETE_IMAGE_FAILED;

        if (error.status === 404) {
          errorMessage = ProductService.MSG_PRODUCT_OR_IMAGE_NOT_FOUND;
        } else if (error.status === 0) {
          errorMessage = this.getNetworkErrorMessage();
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
            ? ProductService.MSG_PRODUCT_NOT_FOUND
            : error.status === 0
              ? this.getNetworkErrorMessage()
              : ProductService.MSG_FETCH_PRODUCT_ADDONS_FAILED;

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
            ? ProductService.MSG_PRODUCT_NOT_FOUND
            : error.status === 0
              ? this.getNetworkErrorMessage()
              : ProductService.MSG_FETCH_LINKED_PRODUCTS_FAILED;

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public assignProductAddOns(productId: string, addOns: ProductAddOnAssignmentDto[]): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/${productId}/addons`, { productId, addOns }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error assigning product add-ons:', error);

        let errorMessage: string = ProductService.MSG_ASSIGN_ADDONS_FAILED;

        if (error.status === 400) {
          errorMessage =
            error.error?.message || ProductService.MSG_INVALID_ADDONS_REQUEST;
        } else if (error.status === 404) {
          errorMessage = ProductService.MSG_PRODUCT_NOT_FOUND;
        } else if (error.status === 0) {
          errorMessage = this.getNetworkErrorMessage();
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

          let errorMessage: string = ProductService.MSG_ASSIGN_PRODUCTS_FAILED;

          if (error.status === 400) {
            errorMessage =
              error.error?.message || ProductService.MSG_INVALID_PRODUCTS_REQUEST;
          } else if (error.status === 404) {
            errorMessage = ProductService.MSG_ADD_ON_NOT_FOUND;
          } else if (error.status === 0) {
            errorMessage = this.getNetworkErrorMessage();
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

          let errorMessage: string = ProductService.MSG_CREATE_PRICE_OVERRIDE_FAILED;

          if (error.status === 400) {
            errorMessage = error.error?.message || ProductService.MSG_INVALID_PRICE_OVERRIDE_REQUEST;
          } else if (error.status === 404) {
            errorMessage = ProductService.MSG_PRODUCT_OR_ADD_ON_NOT_FOUND;
          } else if (error.status === 0) {
            errorMessage = this.getNetworkErrorMessage();
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

          let errorMessage: string = ProductService.MSG_UPDATE_PRICE_OVERRIDE_FAILED;

          if (error.status === 400) {
            errorMessage = error.error?.message || ProductService.MSG_INVALID_PRICE_OVERRIDE_REQUEST;
          } else if (error.status === 404) {
            errorMessage = ProductService.MSG_PRICE_OVERRIDE_NOT_FOUND;
          } else if (error.status === 0) {
            errorMessage = this.getNetworkErrorMessage();
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

          let errorMessage: string = ProductService.MSG_DELETE_PRICE_OVERRIDE_FAILED;

          if (error.status === 404) {
            errorMessage = ProductService.MSG_PRICE_OVERRIDE_NOT_FOUND;
          } else if (error.status === 0) {
            errorMessage = this.getNetworkErrorMessage();
          }

          return throwError(() => new Error(errorMessage));
        }),
      );
  }

  private getNetworkErrorMessage(): string {
    this.connectivity.checkNow();
    return ProductService.MSG_NETWORK_UNAVAILABLE;
  }
}
