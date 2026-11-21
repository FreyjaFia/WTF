import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpErrorMessages } from '@core/messages';
import { ConnectivityService } from '@core/services/connectivity.service';
import { environment } from '@environments/environment.development';
import {
  ALL_BRANCHES,
  BranchCloseCheckDto,
  BranchDto,
  MyBranchDto,
  MyBranchesDto,
  SaveBranchDto,
  UserBranchAccessDto,
} from '@shared/models';
import { Observable, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { extractHttpErrorMessage } from './http-error-message';

const STORAGE_KEY = 'wtf_active_branch';

@Injectable({ providedIn: 'root' })
export class BranchService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly baseUrl = `${environment.apiUrl}/branches`;

  private readonly _mine = signal<MyBranchesDto | null>(null);
  private readonly _activeId = signal<string | null>(readStored());

  public readonly mine = this._mine.asReadonly();
  public readonly activeId = this._activeId.asReadonly();
  public readonly branches = computed<MyBranchDto[]>(() => this._mine()?.branches ?? []);
  public readonly isMultiBranch = computed(() => this._mine()?.isMultiBranch ?? false);
  public readonly canSeeAll = computed(() => this._mine()?.canSeeAll ?? false);
  public readonly isAllSelected = computed(() => this._activeId() === ALL_BRANCHES);
  public readonly activeBranch = computed<MyBranchDto | null>(
    () => this.branches().find((b) => b.id === this._activeId()) ?? null,
  );
  public readonly activeCode = computed(() =>
    this.isAllSelected() ? 'All' : (this.activeBranch()?.code ?? ""),
  );
  public readonly activeLabel = computed(() =>
    this.isAllSelected() ? 'All branches' : (this.activeBranch()?.name ?? ''),
  );

  public loadMine(): void {
    this.http.get<MyBranchesDto>(`${this.baseUrl}/mine`).subscribe({
      next: (mine) => this.apply(mine),
      error: () => undefined,
    });
  }

  public recover(): Observable<string | null> {
    return this.http.get<MyBranchesDto>(`${this.baseUrl}/mine`).pipe(
      tap((mine) => this.apply(mine)),
      map(() => this._activeId()),
    );
  }

  public switchTo(id: string): void {
    writeStored(id);
  }

  public select(id: string): void {
    this._activeId.set(id);
    writeStored(id);
  }

  public clear(): void {
    this._mine.set(null);
    this._activeId.set(null);
    writeStored(null);
  }

  public getBranches(): Observable<BranchDto[]> {
    return this.http
      .get<BranchDto[]>(this.baseUrl)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the branches.')));
  }

  public createBranch(dto: SaveBranchDto): Observable<BranchDto> {
    return this.http
      .post<BranchDto>(this.baseUrl, dto)
      .pipe(
        tap(() => this.loadMine()),
        catchError((error) => this.handleError(error, 'Unable to add the branch.')),
      );
  }

  public updateBranch(id: string, dto: SaveBranchDto): Observable<BranchDto> {
    return this.http
      .put<BranchDto>(`${this.baseUrl}/${id}`, dto)
      .pipe(
        tap(() => this.loadMine()),
        catchError((error) => this.handleError(error, 'Unable to save the branch.')),
      );
  }

  public getCloseCheck(id: string): Observable<BranchCloseCheckDto> {
    return this.http
      .get<BranchCloseCheckDto>(`${this.baseUrl}/${id}/close-check`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to check the branch.')));
  }

  public closeBranch(id: string, moveStaffToBranchId: string | null): Observable<BranchDto> {
    return this.http
      .post<BranchDto>(`${this.baseUrl}/${id}/close`, { moveStaffToBranchId })
      .pipe(
        tap(() => this.loadMine()),
        catchError((error) => this.handleError(error, 'Unable to close the branch.')),
      );
  }

  public reopenBranch(id: string): Observable<BranchDto> {
    return this.http
      .post<BranchDto>(`${this.baseUrl}/${id}/reopen`, {})
      .pipe(
        tap(() => this.loadMine()),
        catchError((error) => this.handleError(error, 'Unable to reopen the branch.')),
      );
  }

  public makeMain(id: string): Observable<BranchDto> {
    return this.http
      .post<BranchDto>(`${this.baseUrl}/${id}/make-main`, {})
      .pipe(
        tap(() => this.loadMine()),
        catchError((error) => this.handleError(error, 'Unable to change the main branch.')),
      );
  }

  public getUserAccess(userId: string): Observable<UserBranchAccessDto> {
    return this.http
      .get<UserBranchAccessDto>(`${environment.apiUrl}/users/${userId}/branch-access`)
      .pipe(catchError((error) => this.handleError(error, 'Unable to fetch the branch access.')));
  }

  public saveUserAccess(userId: string, dto: Omit<UserBranchAccessDto, 'userId'>): Observable<UserBranchAccessDto> {
    return this.http
      .put<UserBranchAccessDto>(`${environment.apiUrl}/users/${userId}/branch-access`, dto)
      .pipe(catchError((error) => this.handleError(error, 'Unable to save the branch access.')));
  }

  private apply(mine: MyBranchesDto): void {
    this._mine.set(mine);

    const stored = this._activeId();
    const allowed = new Set(mine.branches.map((b) => b.id));
    const storedStillValid =
      stored !== null && ((stored === ALL_BRANCHES && mine.canSeeAll) || allowed.has(stored));
    if (storedStillValid) {
      return;
    }

    const fallback =
      mine.defaultBranchId && allowed.has(mine.defaultBranchId)
        ? mine.defaultBranchId
        : (mine.branches.find((b) => b.isActive)?.id ?? null);
    this._activeId.set(fallback);
    writeStored(fallback);
  }

  private handleError(error: HttpErrorResponse, fallback: string): Observable<never> {
    if (error.status === 0) {
      this.connectivity.checkNow();
    }

    const message =
      error.status === 0 ? HttpErrorMessages.NetworkUnavailable : extractHttpErrorMessage(error) || fallback;
    return throwError(() => new Error(message));
  }
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, value);
    }
  } catch {
    // Storage can be blocked; the choice then lasts until the page closes.
  }
}
