import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ConnectivityService } from '@core/services/connectivity.service';
import { HttpErrorMessages, ServiceErrorMessages } from '@core/messages';
import { CreateUserDto, GetUsersQuery, UpdateUserDto, UserDto } from '@shared/models';
import { environment } from '@environments/environment.development';
import { Observable, catchError, throwError } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class UserService {
  private static readonly MSG_NETWORK_UNAVAILABLE = HttpErrorMessages.NetworkUnavailable;
  private static readonly MSG_USER_NOT_FOUND = ServiceErrorMessages.User.UserNotFound;
  private static readonly MSG_USER_OR_IMAGE_NOT_FOUND = ServiceErrorMessages.User.UserOrImageNotFound;
  private static readonly MSG_INVALID_FILE = HttpErrorMessages.InvalidFile;
  private static readonly MSG_FETCH_USERS_FAILED = ServiceErrorMessages.User.FetchUsersFailed;
  private static readonly MSG_FETCH_USER_FAILED = ServiceErrorMessages.User.FetchUserFailed;
  private static readonly MSG_CREATE_USER_FAILED = ServiceErrorMessages.User.CreateUserFailed;
  private static readonly MSG_UPDATE_USER_FAILED = ServiceErrorMessages.User.UpdateUserFailed;
  private static readonly MSG_DELETE_USER_FAILED = ServiceErrorMessages.User.DeleteUserFailed;
  private static readonly MSG_UPLOAD_IMAGE_FAILED = ServiceErrorMessages.User.UploadImageFailed;
  private static readonly MSG_DELETE_IMAGE_FAILED = ServiceErrorMessages.User.DeleteImageFailed;

  private readonly baseUrl = `${environment.apiUrl}/users`;

  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);

  public getUsers(query?: GetUsersQuery): Observable<UserDto[]> {
    let params = new HttpParams();

    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params = params.set(key, String(value));
        }
      });
    }

    return this.http.get<UserDto[]>(this.baseUrl, { params }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching users:', error);
        return throwError(() => new Error(this.getErrorMessage(error, UserService.MSG_FETCH_USERS_FAILED)));
      }),
    );
  }

  public getUserById(id: string): Observable<UserDto> {
    return this.http.get<UserDto>(`${this.baseUrl}/${id}`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching user:', error);
        return throwError(() =>
          new Error(
            this.getErrorMessage(error, UserService.MSG_FETCH_USER_FAILED, {
              notFound: UserService.MSG_USER_NOT_FOUND,
            }),
          ),
        );
      }),
    );
  }

  public createUser(dto: CreateUserDto): Observable<UserDto> {
    return this.http.post<UserDto>(this.baseUrl, dto).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error creating user:', error);
        return throwError(() => new Error(this.getErrorMessage(error, UserService.MSG_CREATE_USER_FAILED)));
      }),
    );
  }

  public updateUser(dto: UpdateUserDto): Observable<UserDto> {
    return this.http.put<UserDto>(`${this.baseUrl}/${dto.id}`, dto).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error updating user:', error);
        return throwError(() =>
          new Error(
            this.getErrorMessage(error, UserService.MSG_UPDATE_USER_FAILED, {
              notFound: UserService.MSG_USER_NOT_FOUND,
            }),
          ),
        );
      }),
    );
  }

  public deleteUser(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error deleting user:', error);
        return throwError(() =>
          new Error(
            this.getErrorMessage(error, UserService.MSG_DELETE_USER_FAILED, {
              notFound: UserService.MSG_USER_NOT_FOUND,
            }),
          ),
        );
      }),
    );
  }

  public uploadUserImage(id: string, file: File): Observable<UserDto> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<UserDto>(`${this.baseUrl}/${id}/images`, formData).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error uploading user image:', error);

        let errorMessage: string = UserService.MSG_UPLOAD_IMAGE_FAILED;

        if (error.status === 400) {
          errorMessage = error.error || UserService.MSG_INVALID_FILE;
        } else if (error.status === 404) {
          errorMessage = UserService.MSG_USER_NOT_FOUND;
        } else if (error.status === 0) {
          this.connectivity.checkNow();
          errorMessage = UserService.MSG_NETWORK_UNAVAILABLE;
        }

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  public deleteUserImage(id: string): Observable<UserDto> {
    return this.http.delete<UserDto>(`${this.baseUrl}/${id}/images`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error deleting user image:', error);

        let errorMessage: string = UserService.MSG_DELETE_IMAGE_FAILED;

        if (error.status === 404) {
          errorMessage = UserService.MSG_USER_OR_IMAGE_NOT_FOUND;
        } else if (error.status === 0) {
          this.connectivity.checkNow();
          errorMessage = UserService.MSG_NETWORK_UNAVAILABLE;
        }

        return throwError(() => new Error(errorMessage));
      }),
    );
  }

  private getErrorMessage(
    error: HttpErrorResponse,
    fallback: string,
    options?: { notFound?: string },
  ): string {
    if (error.status === 0) {
      this.connectivity.checkNow();
      return UserService.MSG_NETWORK_UNAVAILABLE;
    }

    if (error.status === 404 && options?.notFound) {
      return options.notFound;
    }

    return fallback;
  }
}
