import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import {
  ExpenseCategoryDto,
  ExpenseDto,
  ExpenseListDto,
  ExpenseListQuery,
  SaveExpenseDto,
} from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

@Injectable({ providedIn: 'root' })
export class ExpenseService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/expenses`;

  public getExpenses(query: ExpenseListQuery = {}): Observable<ExpenseListDto> {
    let params = new HttpParams();
    if (query.fromDate) {
      params = params.set('fromDate', query.fromDate);
    }

    if (query.toDate) {
      params = params.set('toDate', query.toDate);
    }

    if (query.category) {
      params = params.set('category', String(query.category));
    }

    if (query.includeDeleted) {
      params = params.set('includeDeleted', 'true');
    }

    return this.http
      .get<ExpenseListDto>(this.baseUrl, { params })
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the expenses.')));
  }

  public getCategories(): Observable<ExpenseCategoryDto[]> {
    return this.http
      .get<ExpenseCategoryDto[]>(`${this.baseUrl}/categories`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the expense categories.')));
  }

  public createExpense(dto: SaveExpenseDto): Observable<ExpenseDto> {
    return this.http
      .post<ExpenseDto>(this.baseUrl, dto)
      .pipe(catchError((error) => this.handleError(error, 'Unable to add the expense.')));
  }

  public updateExpense(id: string, dto: SaveExpenseDto): Observable<ExpenseDto> {
    return this.http
      .put<ExpenseDto>(`${this.baseUrl}/${id}`, dto)
      .pipe(catchError((error) => this.handleError(error, 'Unable to save the expense.')));
  }

  public deleteExpense(id: string): Observable<ExpenseDto> {
    return this.http
      .delete<ExpenseDto>(`${this.baseUrl}/${id}`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to delete the expense.')));
  }

  public restoreExpense(id: string): Observable<ExpenseDto> {
    return this.http
      .post<ExpenseDto>(`${this.baseUrl}/${id}/restore`, {})
      .pipe(catchError((error) => this.handleError(error, 'Unable to restore the expense.')));
  }

  private handleError(error: HttpErrorResponse, fallback: string): Observable<never> {
    const serverMessage = extractHttpErrorMessage(error);
    if (error.status === 0) {
      this.connectivity.checkNow();
    }

    const message =
      error.status === 0 ? HttpErrorMessages.NetworkUnavailable : serverMessage || fallback;
    return throwError(() => new Error(message));
  }
}
