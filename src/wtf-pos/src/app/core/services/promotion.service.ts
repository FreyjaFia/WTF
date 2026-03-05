import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services';
import { environment } from '@environments/environment.development';
import {
  EvaluatePromotionsRequestDto,
  EvaluatePromotionsResponseDto,
  FixedBundlePromotionDto,
  MixMatchPromotionDto,
  PromotionImageDto,
  PromotionListItemDto,
} from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class PromotionService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly fixedBundleBaseUrl = `${environment.apiUrl}/management/promotions/fixed-bundles`;
  private readonly mixMatchBaseUrl = `${environment.apiUrl}/management/promotions/mix-match`;
  private readonly posBaseUrl = `${environment.apiUrl}/pos/promotions`;

  public getFixedBundles(): Observable<PromotionListItemDto[]> {
    return this.http
      .get<PromotionListItemDto[]>(this.fixedBundleBaseUrl)
      .pipe(catchError((error) => this.handleError(error)));
  }

  public getFixedBundle(id: string): Observable<FixedBundlePromotionDto> {
    return this.http
      .get<FixedBundlePromotionDto>(`${this.fixedBundleBaseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error)));
  }

  public createFixedBundle(
    payload: Omit<FixedBundlePromotionDto, 'id'>,
  ): Observable<FixedBundlePromotionDto> {
    return this.http
      .post<FixedBundlePromotionDto>(this.fixedBundleBaseUrl, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  public updateFixedBundle(payload: FixedBundlePromotionDto): Observable<FixedBundlePromotionDto> {
    return this.http
      .put<FixedBundlePromotionDto>(`${this.fixedBundleBaseUrl}/${payload.id}`, {
        promotionId: payload.id,
        ...payload,
      })
      .pipe(catchError((error) => this.handleError(error)));
  }

  public deleteFixedBundle(id: string): Observable<void> {
    return this.http
      .delete<void>(`${this.fixedBundleBaseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error)));
  }

  public getMixMatchPromotions(): Observable<PromotionListItemDto[]> {
    return this.http
      .get<PromotionListItemDto[]>(this.mixMatchBaseUrl)
      .pipe(catchError((error) => this.handleError(error)));
  }

  public getMixMatchPromotion(id: string): Observable<MixMatchPromotionDto> {
    return this.http
      .get<MixMatchPromotionDto>(`${this.mixMatchBaseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error)));
  }

  public createMixMatch(
    payload: Omit<MixMatchPromotionDto, 'id'>,
  ): Observable<MixMatchPromotionDto> {
    return this.http
      .post<MixMatchPromotionDto>(this.mixMatchBaseUrl, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  public updateMixMatch(payload: MixMatchPromotionDto): Observable<MixMatchPromotionDto> {
    return this.http
      .put<MixMatchPromotionDto>(`${this.mixMatchBaseUrl}/${payload.id}`, {
        promotionId: payload.id,
        ...payload,
      })
      .pipe(catchError((error) => this.handleError(error)));
  }

  public deleteMixMatch(id: string): Observable<void> {
    return this.http
      .delete<void>(`${this.mixMatchBaseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error)));
  }

  public uploadPromotionImage(promotionId: string, file: File): Observable<PromotionImageDto> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http
      .post<PromotionImageDto>(
        `${environment.apiUrl}/management/promotions/${promotionId}/images`,
        formData,
      )
      .pipe(catchError((error) => this.handleError(error)));
  }

  public deletePromotionImage(promotionId: string): Observable<PromotionImageDto> {
    return this.http
      .delete<PromotionImageDto>(
        `${environment.apiUrl}/management/promotions/${promotionId}/images`,
      )
      .pipe(catchError((error) => this.handleError(error)));
  }

  public evaluateCart(
    request: EvaluatePromotionsRequestDto,
  ): Observable<EvaluatePromotionsResponseDto> {
    return this.http
      .post<EvaluatePromotionsResponseDto>(`${this.posBaseUrl}/evaluate`, request)
      .pipe(catchError((error) => this.handleError(error)));
  }

  private handleError(error: HttpErrorResponse) {
    if (error.status === 0) {
      this.connectivity.checkNow();
      return throwError(() => new Error(HttpErrorMessages.NetworkUnavailable));
    }

    const message = extractHttpErrorMessage(error);
    if (message) {
      return throwError(() => new Error(message));
    }

    return throwError(() => new Error('Promotion request failed.'));
  }
}
